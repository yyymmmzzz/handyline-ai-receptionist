/**
 * call-extraction.ts — pure extraction of the AI's decision, pricing and
 * customer details from a Vapi end-of-call report.
 *
 * Deliberately free of side effects (no Supabase, no Twilio, no network) so
 * the real stored payloads can be replayed against it in tests. order.ts owns
 * everything that writes or sends.
 */
import type {
  Boss,
  VapiWebhookPayload,
  AIDecision,
  PricingBreakdown,
  IssueType,
} from "./types";

export interface ExtractedCallData {
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
 * A tool call normalised into the flat shape the extraction code expects.
 */
export interface NormalizedToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
  };
}

/**
 * Collect every function call out of a Vapi payload, with results attached.
 *
 * Vapi puts function calls in ONE of two places depending on the event:
 *   - `message.toolCallList` / `message.toolCalls`  (flat, "tool-calls" event)
 *   - `message.messages[].toolCalls` on a `role: "tool_calls"` message
 *     (end-of-call-report / conversation-update — the shape production sends)
 *
 * The old code only read the flat form. On real end-of-call-report payloads
 * `end_call` was therefore invisible, so every work order came out as
 * ai_decision="unsure" with a null summary and a null issue type.
 *
 * Results arrive either as `message.messages[].toolCallResults[]` or as
 * standalone `role: "tool_call_result"` messages. We match them to calls by
 * toolCallId when available, otherwise by name in call order.
 */
export function collectToolCalls(endOfCall: VapiWebhookPayload["message"]): NormalizedToolCall[] {
  const calls: NormalizedToolCall[] = [];
  const seen = new Set<string>();

  const push = (raw: {
    id?: string;
    toolCallId?: string;
    name?: string;
    arguments?: Record<string, unknown> | string;
    result?: string;
    function?: { name?: string; arguments?: Record<string, unknown> | string; result?: string };
  }) => {
    const fn = (raw.function ?? raw) as {
      name?: string;
      arguments?: Record<string, unknown> | string;
      result?: string;
    };
    const name = fn?.name;
    if (!name) return;
    let args: Record<string, unknown> = (fn?.arguments ?? {}) as Record<string, unknown>;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    const id = raw.id ?? raw.toolCallId ?? `tc_${calls.length}`;
    const key = `${id}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      id,
      type: "function",
      function: { name, arguments: args, result: fn?.result },
    });
  };

  for (const raw of endOfCall.toolCallList ?? []) push(raw);
  for (const raw of endOfCall.toolCalls ?? []) push(raw);
  for (const m of endOfCall.messages ?? []) {
    for (const raw of m.toolCalls ?? []) push(raw as Parameters<typeof push>[0]);
  }

  // ---- Attach results -------------------------------------------------
  type RawResult = { id?: string; name?: string; result?: unknown };
  const results: RawResult[] = [];
  for (const m of endOfCall.messages ?? []) {
    for (const r of m.toolCallResults ?? []) {
      results.push({ id: r.id, name: r.name, result: r.result });
    }
    if (m.role === "tool_call_result" || m.role === "tool") {
      results.push({ id: m.toolCallId, name: m.name, result: m.result });
    }
  }

  const used = new Set<number>();
  for (const call of calls) {
    if (call.function.result !== undefined) continue;
    // 1) exact match by tool call id
    let idx = results.findIndex((r, i) => !used.has(i) && r.id && r.id === call.id);
    // 2) fall back to the next unused result with the same tool name
    if (idx === -1) {
      idx = results.findIndex((r, i) => !used.has(i) && r.name === call.function.name);
    }
    if (idx === -1) continue;
    used.add(idx);
    const raw = results[idx].result;
    call.function.result = typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
  }

  return calls;
}

/**
 * Extract the AI's decision, customer info, and other details from a
 * Vapi end-of-call report.
 *
 * The data lives in:
 * - endOfCall.messages[].toolCalls (function calls made — production shape)
 * - endOfCall.toolCallList / endOfCall.toolCalls (flat shape)
 * - endOfCall.analysis.structuredData (custom extraction if configured)
 * - endOfCall.summary (free-form summary)
 * - endOfCall.call.transcript (raw transcript)
 * - endOfCall.messages (full message history)
 */
export function extractCallData(
  boss: Boss,
  endOfCall: VapiWebhookPayload["message"],
): ExtractedCallData {
  const toolCalls = collectToolCalls(endOfCall);
  const messages = endOfCall.messages || [];

  // Find the end_call tool invocation
  const endCall = toolCalls.find((t) => t.function.name === "end_call");
  const flagUrgent = toolCalls.find((t) => t.function.name === "flag_urgent");
  const flagUncertain = toolCalls.find((t) => t.function.name === "flag_uncertain");
  const validateService = toolCalls.find((t) => t.function.name === "validate_service");
  const getPriceQuote = toolCalls.find((t) => t.function.name === "get_price_quote");
  // Get ALL trade-check calls — when a customer gets rejected on one issue then
  // pivots to another, the conversation has 2+ calls. We want the
  // LAST one whose result was in_trade=true (the one that led to acceptance),
  // falling back to the first one if none succeeded.
  //
  // The live assistant uses the merged `check_and_quote` tool; `check_trade`
  // is the legacy name kept for older imports.
  const TRADE_CHECK_TOOLS = new Set(["check_and_quote", "check_trade"]);
  const allCheckTrades = toolCalls.filter((t) => TRADE_CHECK_TOOLS.has(t.function.name));
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
  // topics by which trade check returned in_trade=true vs false.
  // Used by the dashboard to show the full conversation story (e.g.
  // Matt: accepted ["hvac"], rejected ["roof"]).
  // Results normally ride along on the call itself (collectToolCalls attaches
  // them); this map is a fallback for payloads that keep them only in messages.
  const checkTradeResultsById = new Map<string, unknown>(); // toolCallId -> result
  for (const m of messages) {
    for (const r of m.toolCallResults ?? []) {
      if (!r.name || !TRADE_CHECK_TOOLS.has(r.name)) continue;
      const parsed = tryParseJson(r.result);
      if (parsed && r.id) checkTradeResultsById.set(r.id, parsed);
    }
    if ((m.role === "tool_call_result" || m.role === "tool") && m.name && TRADE_CHECK_TOOLS.has(m.name)) {
      const parsed = tryParseJson(m.result);
      if (parsed && m.toolCallId) checkTradeResultsById.set(m.toolCallId, parsed);
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

  // The live assistant's `check_and_quote` returns a FLAT quote shape
  // (range_low / range_high / trip_fee / total_trip_fee …), not the legacy
  // { range: {low,high}, available } object. Read it when get_price_quote
  // was not used — otherwise every production quote stayed null.
  if (!pricingBreakdown) {
    for (const c of [...allCheckTrades].reverse()) {
      const parsed = tryParseJson(c.function.result);
      if (!parsed) continue;
      if (parsed.in_service === false) continue; // outside service area — handled elsewhere
      const low = typeof parsed.range_low === "number" ? parsed.range_low : null;
      const high = typeof parsed.range_high === "number" ? parsed.range_high : null;
      if (low === null || high === null) continue;
      quoteLow = low;
      quoteHigh = high;
      pricingBreakdown = {
        trip_fee: (parsed.trip_fee as number) ?? 0,
        fuel_surcharge: (parsed.fuel_surcharge as number) ?? 0,
        total_trip_fee: (parsed.total_trip_fee as number) ?? (parsed.trip_fee as number) ?? 0,
        range_low: low,
        range_high: high,
        total_low: (parsed.total_low as number) ?? low,
        total_high: (parsed.total_high as number) ?? high,
        distance_miles: (parsed.distance_miles as number | null) ?? null,
        free_distance_miles: boss.free_distance_miles,
        surcharge_per_mile: boss.distance_surcharge_per_mile,
      };
      break;
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

  // The AI passes the customer's ZIP to check_and_quote — that is the only
  // place it reliably appears, so recover it from the tool arguments.
  if (!customerZipcode) {
    for (const c of allCheckTrades) {
      const zip = c.function.arguments?.zipcode;
      if (typeof zip === "string" && zip.trim()) {
        customerZipcode = zip.trim();
        break;
      }
    }
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

export function tryParseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : (value as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function buildTranscript(endOfCall: VapiWebhookPayload["message"]): Array<{ role: string; text: string; ts?: number }> {
  const messages = endOfCall.messages || [];
  if (messages.length > 0) {
    // Vapi labels the assistant's own turns as role "bot" (NOT "assistant"),
    // so filtering on "assistant" alone silently dropped every AI reply —
    // the dashboard only ever showed half the conversation.
    return messages
      .filter((m) => m.role === "user" || m.role === "bot" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "bot" ? "assistant" : m.role,
        text: m.message || m.messageContent || m.content || "",
        ts: m.time,
      }))
      .filter((t) => t.text.trim().length > 0);
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
