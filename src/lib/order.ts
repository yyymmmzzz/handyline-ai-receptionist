import type { Boss, VapiWebhookPayload, AIDecision, WorkOrder, PricingBreakdown } from "./types";
import { getServiceClient } from "./supabase";
import { notifyBossOfNewOrder } from "./notify";
import { summarizeCall } from "./call-summary";
import { summarizeWithFallback, computeSummaryHash } from "./openai-summarize";
import { persistRecording } from "./recording-storage";
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
  const { data: existing } = await supabase
    .from("work_orders")
    .select("id")
    .eq("vapi_call_id", callId)
    .single();

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
  const recordingUrl = await persistRecording(endOfCall.call?.recordingUrl, callId);

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
    summary: summary || endOfCall.summary || endOfCall.analysis?.summary || null,
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

interface ExtractedCallData {
  decision: AIDecision;
  reason: string | null;
  issueType: IssueType | null;
  summary: string | null;
  quoteLow: number | null;
  quoteHigh: number | null;
  pricingBreakdown: PricingBreakdown | null;
  customerAddress: string | null;
  customerZipcode: string | null;
  issueDetails: string | null;
  preferredTime: string | null;
  acceptedTopics: string[];
  rejectedTopics: string[];
}

/**
 * Extract the AI's decision, customer info, and other details from a
 * Vapi end-of-call report.
 *
 * The data lives in:
 * - endOfCall.toolCallList (function calls made)
 * - endOfCall.analysis.structuredData (custom extraction if configured)
 * - endOfCall.summary (free-form summary)
 * - endOfCall.call.transcript (raw transcript)
 * - endOfCall.messages (full message history)
 */
function extractCallData(
  boss: Boss,
  endOfCall: VapiWebhookPayload["message"],
): ExtractedCallData {
  const toolCalls = (endOfCall.toolCallList || endOfCall.toolCalls || []) as Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: Record<string, unknown>;
      result?: string;
    };
  }>;
  const messages = endOfCall.messages || [];

  // Find the end_call tool invocation
  const endCall = toolCalls.find((t) => t.function.name === "end_call");
  const flagUrgent = toolCalls.find((t) => t.function.name === "flag_urgent");
  const flagUncertain = toolCalls.find((t) => t.function.name === "flag_uncertain");
  const validateService = toolCalls.find((t) => t.function.name === "validate_service");
  const getPriceQuote = toolCalls.find((t) => t.function.name === "get_price_quote");
  // Get ALL check_trade calls — when a customer gets rejected on one issue then
  // pivots to another, the conversation has 2+ check_trade calls. We want the
  // LAST one whose result was in_trade=true (the one that led to acceptance),
  // falling back to the first one if none succeeded.
  const allCheckTrades = toolCalls.filter((t) => t.function.name === "check_trade");
  const acceptedCheckTrade = [...allCheckTrades].reverse().find((t) => {
    try {
      const r = typeof t.function.result === "string" ? JSON.parse(t.function.result) : t.function.result;
      return r?.in_trade === true;
    } catch {
      return false;
    }
  });
  const checkTrade = acceptedCheckTrade || allCheckTrades[0];

  // Decision
  let decision: AIDecision = "unsure";
  let reason: string | null = null;

  if (endCall) {
    const outcome = endCall.function.arguments?.outcome as AIDecision | undefined;
    if (outcome && ["accepted", "urgent", "unsure", "rejected"].includes(outcome)) {
      decision = outcome;
    }
  } else if (flagUrgent) {
    decision = "urgent";
    reason = (flagUrgent.function.arguments?.reason as string) || null;
  } else if (flagUncertain) {
    decision = "unsure";
    reason = (flagUncertain.function.arguments?.reason as string) || null;
  }

  // Issue type — take the accepted check_trade if any (handles multi-issue
  // conversations where the first issue was rejected). Fall back to
  // validate_service or get_price_quote for single-issue flows.
  const issueType =
    (checkTrade?.function.arguments?.issue_type as IssueType | undefined) ||
    (validateService?.function.arguments?.issue_type as IssueType | undefined) ||
    (getPriceQuote?.function.arguments?.issue_type as IssueType | undefined) ||
    null;

  // Accepted vs Rejected topics (B.2) — for multi-issue calls, we split
  // topics by which check_trade result was in_trade=true vs false.
  // Used by the dashboard to show the full conversation story (e.g.
  // Matt: accepted ["hvac"], rejected ["roof"]).
  // We need to look up each check_trade's RESULT in messages, because
  // toolCallList sometimes doesn't include the result inline.
  const checkTradeResultsById = new Map<string, unknown>(); // toolCallId -> result
  for (const m of messages as Array<{ role?: string; name?: string; toolCallId?: string; result?: unknown }>) {
    // Vapi uses role="tool" with name=tool_name for tool call results
    if ((m.role === "tool_call_result" || m.role === "tool") && m.name === "check_trade" && m.toolCallId) {
      try {
        const r = typeof m.result === "string" ? JSON.parse(m.result) : m.result;
        checkTradeResultsById.set(m.toolCallId, r);
      } catch {
        // ignore
      }
    }
  }
  const acceptedTopicsSet = new Set<string>();
  const rejectedTopicsSet = new Set<string>();
  for (const c of allCheckTrades) {
    let inTrade: boolean | null = null;
    const r = checkTradeResultsById.get(c.id) ?? c.function?.result;
    if (r) {
      try {
        const parsed = typeof r === "string" ? JSON.parse(r) : r;
        inTrade = (parsed as { in_trade?: boolean })?.in_trade === true;
      } catch {
        inTrade = null;
      }
    }
    const it = c.function?.arguments?.issue_type as string | undefined;
    if (!it) continue;
    if (inTrade === true) acceptedTopicsSet.add(it);
    else if (inTrade === false) rejectedTopicsSet.add(it);
  }
  if (decision === "rejected" && issueType && !acceptedTopicsSet.has(issueType) && !rejectedTopicsSet.has(issueType)) {
    rejectedTopicsSet.add(issueType);
  }

  // Price quote
  let quoteLow: number | null = null;
  let quoteHigh: number | null = null;
  let pricingBreakdown: PricingBreakdown | null = null;
  if (getPriceQuote?.function.result) {
    try {
      const parsed = typeof getPriceQuote.function.result === "string"
        ? JSON.parse(getPriceQuote.function.result)
        : (getPriceQuote.function.result as unknown);
      if (parsed?.range) {
        quoteLow = parsed.range.low;
        quoteHigh = parsed.range.high;
      }
      if (parsed?.available) {
        pricingBreakdown = {
          trip_fee: parsed.trip_fee,
          fuel_surcharge: parsed.fuel_surcharge ?? 0,
          total_trip_fee: parsed.total_trip_fee ?? parsed.trip_fee,
          range_low: parsed.range.low,
          range_high: parsed.range.high,
          total_low: parsed.total_low ?? parsed.range.low + (parsed.total_trip_fee ?? parsed.trip_fee),
          total_high: parsed.total_high ?? parsed.range.high + (parsed.total_trip_fee ?? parsed.trip_fee),
          distance_miles: parsed.distance_miles ?? null,
          free_distance_miles: boss.free_distance_miles,
          surcharge_per_mile: boss.distance_surcharge_per_mile,
        };
      }
    } catch {
      // ignore
    }
  }

  // If we have a distance from validate_service but no get_price_quote result
  // (e.g. customer said no to quote), still try to build a minimal pricing breakdown
  if (!pricingBreakdown) {
    const validateResult = validateService?.function.result
      ? tryParseJson(validateService.function.result)
      : null;
    const validateDistance = (validateResult?.distance_miles as number | null | undefined) ?? null;
    const validateOk = (validateResult?.ok as boolean | undefined) ?? true;
    if (validateDistance != null && issueType && validateOk) {
      // Use price list to backfill a breakdown even if the AI never asked for a quote
      const band = boss.price_list[issueType];
      if (band) {
        const extra = Math.max(0, validateDistance - boss.free_distance_miles);
        const surcharge = Math.round(extra * boss.distance_surcharge_per_mile);
        const totalTrip = boss.diagnostic_fee + surcharge;
        pricingBreakdown = {
          trip_fee: boss.diagnostic_fee,
          fuel_surcharge: surcharge,
          total_trip_fee: totalTrip,
          range_low: band.low,
          range_high: band.high,
          total_low: band.low + totalTrip,
          total_high: band.high + totalTrip,
          distance_miles: validateDistance,
          free_distance_miles: boss.free_distance_miles,
          surcharge_per_mile: boss.distance_surcharge_per_mile,
        };
        quoteLow = band.low;
        quoteHigh = band.high;
      }
    }
  }

  // Customer info — try structured data first, then fall back to message parsing
  let customerAddress: string | null = null;
  let customerZipcode: string | null = null;
  let issueDetails: string | null = null;
  let preferredTime: string | null = null;
  let summary: string | null = null;

  if (endCall?.function.arguments?.summary) {
    summary = endCall.function.arguments.summary as string;
  }

  // Try structured data from Vapi's analysis
  const structured = endOfCall.analysis?.structuredData;
  if (structured && typeof structured === "object") {
    customerAddress = (structured.address as string) || customerAddress;
    customerZipcode = (structured.zipcode as string) || customerZipcode;
    issueDetails = (structured.issue_details as string) || issueDetails;
    preferredTime = (structured.preferred_time as string) || preferredTime;
  }

  // Last resort: parse summary
  if (!summary && endOfCall.summary) {
    summary = endOfCall.summary;
  }
  if (!summary && endOfCall.analysis?.summary) {
    summary = endOfCall.analysis.summary;
  }

  return {
    decision,
    reason,
    issueType,
    summary,
    quoteLow,
    quoteHigh,
    pricingBreakdown,
    customerAddress,
    customerZipcode,
    issueDetails,
    preferredTime,
    acceptedTopics: Array.from(acceptedTopicsSet),
    rejectedTopics: Array.from(rejectedTopicsSet),
  };
}

function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : (value as Record<string, unknown>);
  } catch {
    return null;
  }
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

function buildTranscript(endOfCall: VapiWebhookPayload["message"]): Array<{ role: string; text: string; ts?: number }> {
  const messages = endOfCall.messages || [];
  if (messages.length > 0) {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        text: m.message || m.content || "",
        ts: m.time,
      }));
  }

  // Fallback: parse raw transcript
  const raw = endOfCall.call?.transcript || endOfCall.transcript_combined;
  if (!raw) return [];

  // Simple split by "Assistant:" / "User:" markers
  const lines = raw.split(/\n/);
  const out: Array<{ role: string; text: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase().startsWith("assistant:")) {
      out.push({ role: "assistant", text: trimmed.slice("assistant:".length).trim() });
    } else if (trimmed.toLowerCase().startsWith("user:")) {
      out.push({ role: "user", text: trimmed.slice("user:".length).trim() });
    } else {
      out.push({ role: "user", text: trimmed });
    }
  }
  return out;
}
