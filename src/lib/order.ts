import type { Boss, VapiWebhookPayload, AIDecision, WorkOrder, PricingBreakdown } from "./types";
import {
  extractCallData,
  buildTranscript,
} from "./call-extraction";
import { getServiceClient } from "./supabase";
import { notifyBossOfNewOrder } from "./notify";
import { summarizeCall } from "./call-summary";
import { summarizeWithFallback, computeSummaryHash } from "./openai-summarize";
import { persistRecording, isPermanentRecording } from "./recording-storage";
import type { IssueType } from "./types";

type DataSource = "production" | "test" | "demo";

/**
 * Upsert a customer record (match by boss_id + phone).
 */
export async function upsertCustomer(
  bossId: string,
  phone: string,
  fields: { name?: string | null; address?: string | null; zipcode?: string | null },
): Promise<string> {
  const supabase = getServiceClient();

  // Try to find existing
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("boss_id", bossId)
    .eq("phone", phone)
    .single();

  if (existing) {
    await supabase
      .from("customers")
      .update({
        ...fields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  // Create new
  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      boss_id: bossId,
      phone,
      name: fields.name || null,
      address: fields.address || null,
      zipcode: fields.zipcode || null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create customer: ${error?.message}`);
  }
  return created.id;
}

/**
 * Get the default boss (for the demo, there's only one).
 * In production, you'd look up the boss by the Vapi assistant_id or phone number.
 */
export async function getDefaultBoss(): Promise<Boss | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("bosses").select("*").limit(1).single();

  if (error || !data) return null;
  return data as Boss;
}

/**
 * Look up the boss for a specific Vapi assistant ID.
 * This is the preferred lookup because it's exact (not dependent on caller phone country).
 *
 * Use case: when Vapi calls our tools endpoint, the payload includes the
 * assistantId. We look it up in the bosses table (vapi_assistant_id column)
 * to find the right boss for this call.
 */
export async function getBossByVapiAssistantId(assistantId: string | null | undefined): Promise<Boss | null> {
  if (!assistantId) return null;
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .eq("vapi_assistant_id", assistantId)
    .maybeSingle();
  if (error) {
    console.error(`[order] getBossByVapiAssistantId(${assistantId}) failed:`, error);
    return null;
  }
  return (data as Boss) || null;
}

/**
 * Look up the boss for a given country code (US / SG / MY / ID / ...).
 * Returns the first boss row matching the country. Falls back to
 * getDefaultBoss() (US) if no country-specific boss exists yet.
 *
 * Multi-region routing: when a Vapi call comes in, we detect the country
 * from the customer phone number prefix and use the matching boss. v1
 * supports 1 boss per country; future: load balance across multiple bosses
 * in the same country via boss_routing_rules.
 */
export async function getBossByCountry(country: string | null | undefined): Promise<Boss | null> {
  if (!country) return getDefaultBoss();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .eq("country", country)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[order] getBossByCountry(${country}) failed:`, error);
    return getDefaultBoss();
  }
  if (!data) {
    console.warn(`[order] No boss for country=${country}, falling back to default (US)`);
    return getDefaultBoss();
  }
  return data as Boss;
}

/**
 * Detect country from a phone number using the dial code prefix.
 * Returns 'US' | 'SG' | 'MY' | 'ID' | null.
 */
export function detectCountryFromPhone(phone: string | null | undefined): "US" | "SG" | "MY" | "ID" | null {
  if (!phone) return null;
  if (phone.startsWith("+1")) return "US";
  if (phone.startsWith("+65")) return "SG";
  if (phone.startsWith("+60")) return "MY";
  if (phone.startsWith("+62")) return "ID";
  return null;
}

/**
 * Create or update a work order from a Vapi end-of-call report.
 *
 * Strategy:
 * - If we already have a work_order with this vapi_call_id, update it.
 * - Otherwise, create a new one.
 */
export async function createOrUpdateWorkOrder(
  boss: Boss,
  callId: string,
  endOfCall: VapiWebhookPayload["message"],
  callStart?: string,
  dataSource: DataSource = "production",
): Promise<WorkOrder> {
  // Detect country by phone number prefix
  const customerNumber = endOfCall.call?.customer?.number;
  let country: string | null = null;
  if (customerNumber) {
    if (customerNumber.startsWith("+1")) country = "US";
    else if (customerNumber.startsWith("+65")) country = "SG";
    else if (customerNumber.startsWith("+60")) country = "MY";
    else if (customerNumber.startsWith("+62")) country = "ID";
  }
  if (!country && (endOfCall as { phoneNumber?: { number?: string } }).phoneNumber?.number) {
    const p = (endOfCall as { phoneNumber?: { number?: string } }).phoneNumber!.number!;
    if (p.startsWith("+1")) country = "US";
    else if (p.startsWith("+65")) country = "SG";
    else if (p.startsWith("+60")) country = "MY";
    else if (p.startsWith("+62")) country = "ID";
  }

  const supabase = getServiceClient();

  // Extract customer info from the call (customerNumber already declared above)
  const customerName = (endOfCall.call?.customer?.name as string | undefined) || null;

  // Extract AI decision from tool calls
  const { decision, reason, issueType, summary, quoteLow, quoteHigh, pricingBreakdown, customerAddress, customerZipcode, issueDetails, preferredTime, acceptedTopics: acceptedTopicsRaw, rejectedTopics: rejectedTopicsRaw } =
    extractCallData(boss, endOfCall);

  // Upsert customer
  let customerId: string | null = null;
  if (customerNumber) {
    try {
      customerId = await upsertCustomer(boss.id, customerNumber, {
        name: customerName,
        address: customerAddress,
        zipcode: customerZipcode,
      });
    } catch (err) {
      console.error("[order] upsertCustomer failed:", err);
    }
  }

  // Check if a work order already exists for this call
  const { data: existingRow } = await supabase
    .from("work_orders")
    .select(
      "id, recording_url, customer_name_extracted, intent_summary, customer_tendency, " +
        "mentioned_topics, follow_up_priority, follow_up_notes, follow_up_recommended",
    )
    .eq("vapi_call_id", callId)
    .single();
  const existing = (existingRow ?? null) as Record<string, unknown> | null;

  // Map decision to status
  const status = mapDecisionToStatus(decision);

  // Extract customer name from transcript (more reliable than caller ID)
  // and generate follow-up + intent summary. Uses LLM if OPENAI_API_KEY is
  // set, otherwise falls back to regex (call-summary.ts).
  const transcript = buildTranscript(endOfCall);
  const { summary: callSummary, source: summarySource } = await summarizeWithFallback(
    transcript,
    customerName,
    issueType,
    decision,
    [], // acceptedTopics / rejectedTopics are also extracted via LLM
    [],
    { callId },
  );
  // Compute summary hash for caching (skips duplicate LLM calls on re-import)
  const summaryHash = computeSummaryHash(transcript, decision, issueType);
  console.log(`[order] Call summary via ${summarySource} for call ${callId} (hash=${summaryHash.slice(0, 8)}…)`);

  // Copy the audio out of Vapi's presigned URL (expires in ~30 min) into our
  // own storage so the dashboard's play link keeps working. Never throws.
  //
  // IMPORTANT: the URL that actually works is `artifact.presignedMonoUrl`
  // (SigV4-signed query params). `artifact.recordingUrl` / `message.recordingUrl`
  // are raw bucket paths — a plain GET on them returns 400 "Authorization",
  // so handing those to persistRecording meant no AI call recording was ever
  // stored, and Vapi's 14-day retention then wiped them for good.
  const recordingUrl = await persistRecording(
    endOfCall.artifact?.presignedMonoUrl ||
      endOfCall.artifact?.presignedStereoUrl ||
      endOfCall.artifact?.presignedCustomerUrl ||
      endOfCall.artifact?.presignedAssistantUrl ||
      endOfCall.recordingUrl ||
      endOfCall.artifact?.recordingUrl ||
      endOfCall.call?.recordingUrl ||
      null,
    callId,
  );

  const orderData = {
    boss_id: boss.id,
    customer_id: customerId,
    customer_name: customerName,
    customer_name_extracted: callSummary.customerNameExtracted,
    customer_phone: customerNumber,
    customer_address: customerAddress || null,
    customer_zipcode: customerZipcode || null,
    issue_type: issueType,
    issue_details: issueDetails,
    preferred_time: preferredTime,
    ai_decision: decision,
    ai_decision_reason: reason,
    quote_low: quoteLow,
    quote_high: quoteHigh,
    pricing_breakdown: pricingBreakdown,
    intent_summary: callSummary.intentSummary,
    customer_tendency: callSummary.customerTendency,
    mentioned_topics: callSummary.mentionedTopics,
    accepted_topics: acceptedTopicsRaw,
    rejected_topics: rejectedTopicsRaw,
    follow_up_priority: callSummary.followUpPriority,
    follow_up_notes: callSummary.followUpNotes,
    follow_up_recommended: callSummary.followUpRecommended,
    transcript_coherence: callSummary.transcriptCoherence,
    summary_hash: summaryHash,
    // Records which path produced the LLM fields. Only "llm" may be reused as
    // a cache hit — a regex fallback can be empty, and caching one of those
    // would lock the gap in permanently.
    summary_source: summarySource === "llm" ? "llm" : summarySource,
    // Priority: the AI's own end_call summary → Vapi's free-form summary →
    // the LLM intent summary. Vapi sends `summary: ""` when no analysis plan
    // is configured, so an empty string must not win over the LLM text.
    summary:
      (summary && summary.trim()) ||
      (typeof endOfCall.summary === "string" && endOfCall.summary.trim()) ||
      (typeof endOfCall.analysis?.summary === "string" && endOfCall.analysis.summary.trim()) ||
      callSummary.intentSummary ||
      null,
    vapi_call_id: callId,
    data_source: dataSource,
    country: country,
    recording_url: recordingUrl,
    transcript: transcript,
    status,
    updated_at: new Date().toISOString(),
  };

  let order: WorkOrder | null = null;

  // Try writing all fields. If Supabase rejects (column doesn't exist —
  // migration 005/006 not yet run), fall back to legacy-only fields.
  const legacyFields = {
    boss_id: orderData.boss_id,
    customer_id: orderData.customer_id,
    customer_name: orderData.customer_name,
    customer_phone: orderData.customer_phone,
    customer_address: orderData.customer_address,
    customer_zipcode: orderData.customer_zipcode,
    issue_type: orderData.issue_type,
    issue_details: orderData.issue_details,
    preferred_time: orderData.preferred_time,
    ai_decision: orderData.ai_decision,
    ai_decision_reason: orderData.ai_decision_reason,
    quote_low: orderData.quote_low,
    quote_high: orderData.quote_high,
    pricing_breakdown: orderData.pricing_breakdown,
    summary: orderData.summary,
    vapi_call_id: orderData.vapi_call_id,
    data_source: orderData.data_source,
    recording_url: orderData.recording_url,
    transcript: orderData.transcript,
    status: orderData.status,
    updated_at: orderData.updated_at,
  };
  const newFields005 = {
    customer_name_extracted: orderData.customer_name_extracted,
    intent_summary: orderData.intent_summary,
    customer_tendency: orderData.customer_tendency,
    mentioned_topics: orderData.mentioned_topics,
    follow_up_priority: orderData.follow_up_priority,
    follow_up_notes: orderData.follow_up_notes,
    follow_up_recommended: orderData.follow_up_recommended,
  };
  const newFields006 = {
    accepted_topics: orderData.accepted_topics,
    rejected_topics: orderData.rejected_topics,
    transcript_coherence: orderData.transcript_coherence,
  };

  /**
   * Never replace a good value with a worse one on re-processing.
   *
   * Two cases bit us:
   *   1. `recording_url` — when the Vapi presigned URL has expired the
   *      download fails and persistRecording falls back to the ephemeral URL.
   *      Writing that over a permanent Supabase Storage link would kill a
   *      recording we already have.
   *   2. the LLM-derived fields — when the summariser falls back to regex it
   *      can produce nulls where the previous LLM run produced a real name.
   */
  if (existing) {
    const prior = existing as unknown as Record<string, unknown>;
    const priorRecording = prior.recording_url as string | null;
    if (
      priorRecording &&
      isPermanentRecording(priorRecording) &&
      (!orderData.recording_url || !isPermanentRecording(orderData.recording_url))
    ) {
      orderData.recording_url = priorRecording;
    }
    for (const key of Object.keys(newFields005)) {
      const next = (newFields005 as Record<string, unknown>)[key];
      const prev = (existing as unknown as Record<string, unknown>)[key];
      if (next === null || next === undefined) {
        if (prev !== null && prev !== undefined) {
          (newFields005 as Record<string, unknown>)[key] = prev;
        }
      }
    }
  }

  async function tryWrite(payload: Record<string, unknown>): Promise<WorkOrder> {
    if (existing) {
      const { data, error } = await supabase
        .from("work_orders")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as WorkOrder;
    } else {
      const { data, error } = await supabase
        .from("work_orders")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as WorkOrder;
    }
  }

  // Try writing all fields. Cascade down: all → 005+legacy → legacy only.
  try {
    order = await tryWrite(orderData);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[order] Full write failed (${msg.slice(0, 80)}) — trying 005 + legacy`);
    try {
      order = await tryWrite({ ...legacyFields, ...newFields005 });
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      console.warn(`[order] 005+legacy write failed (${msg2.slice(0, 80)}) — trying legacy only`);
      order = await tryWrite(legacyFields);
    }
  }

  // Notify the boss about the new work order
  await notifyBossOfNewOrder(boss, order);

  // For URGENT orders, fire an outbound call to the boss in addition to (or
  // instead of) the SMS so he can decide in real time.
  if (decision === "urgent") {
    try {
      const { placeEmergencyCall } = await import("./emergency-call");
      const result = await placeEmergencyCall(
        { phone: boss.phone, owner_name: boss.owner_name },
        order,
      );
      if (result.success && result.callId) {
        // Track the outbound call for retry logic
        await supabase
          .from("work_orders")
          .update({
            outbound_attempts: 1,
            last_outbound_at: new Date().toISOString(),
            outbound_call_id: result.callId,
          })
          .eq("id", order.id);
        order.outbound_call_id = result.callId;
        order.outbound_attempts = 1;
        console.log(`[order] Emergency call placed: ${result.callId}`);
      } else {
        console.warn(`[order] Emergency call failed: ${result.error}`);
        // Fall back to the SMS that notifyBossOfNewOrder already sent
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[order] Emergency call error: ${msg}`);
      // Don't fail the whole flow — SMS already went out
    }
  }

  return order;
}

function mapDecisionToStatus(decision: AIDecision): WorkOrder["status"] {
  switch (decision) {
    case "accepted":
      return "pending"; // Boss still needs to confirm
    case "urgent":
      return "urgent";
    case "unsure":
      return "callback";
    case "rejected":
      return "rejected";
  }
}

