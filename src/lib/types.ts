// Core TypeScript types for the demo

// Issue types across all regions:
//   US (home services): plumbing | electrical | hvac | handyman | roofing | general
//   MY H-Master (security): security | alarm | cctv | autogate | access_control | door_lock | general
export type IssueType =
  | "plumbing" | "electrical" | "hvac" | "handyman" | "roofing"
  | "security" | "alarm" | "cctv" | "autogate" | "access_control" | "door_lock"
  | "general";

export type AIDecision = "accepted" | "urgent" | "unsure" | "rejected" | "human_handled";

/**
 * Result of check_trade tool: does the boss handle this issue type?
 * Used in Phase 1 of the conversation — call BEFORE asking for address.
 */
export interface CheckTradeResult {
  in_trade: boolean;
  /** When in_trade=true, echoes back the matched trade name */
  matched_trade?: IssueType;
  /** When in_trade=false, explains what trades we DO handle */
  reason?: string;
}

export type WorkOrderStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "callback"
  | "urgent"
  | "completed"
  | "cancelled";

export interface Boss {
  id: string;
  company_name: string;
  owner_name: string;
  phone: string;
  // Multi-region fields (migration 010)
  country?: string | null;                    // 'US' | 'SG' | 'MY' | 'ID' | ...
  currency_code?: string;                     // 'USD' | 'SGD' | 'MYR' | 'IDR'
  currency_symbol?: string;                   // '$' | 'S$' | 'RM' | 'Rp'
  locale?: string;                            // 'en-US' | 'en-SG' | 'en-MY' | 'id-ID'
  service_postal_prefixes?: string[];         // For SEA (SG/MY/ID)
  service_radius_km?: number | null;          // For SEA (alternative to miles)
  service_base_address: string | null;
  service_base_zip: string;
  service_radius_miles: number;
  service_trades: string[];
  diagnostic_fee: number;
  // Pricing for distance-based surcharge
  free_distance_miles: number;       // miles within base before surcharge kicks in
  distance_surcharge_per_mile: number; // $ per mile beyond free_distance_miles
  business_hours: BusinessHours;
  timezone: string;
  price_list: PriceList;
  service_zip_prefixes: string[];
  vapi_assistant_id: string | null;
  twilio_phone_number: string | null;
  faq: Record<string, string>;
  routing_mode: "after_hours" | "always" | "busy";
  routing_ring_seconds: number;
  whitelist_numbers: string[];
}

export interface PricingBreakdown {
  trip_fee: number;
  fuel_surcharge: number;        // $0 if within free distance
  total_trip_fee: number;        // trip_fee + fuel_surcharge
  range_low: number;
  range_high: number;
  total_low: number;             // range_low + total_trip_fee
  total_high: number;            // range_high + total_trip_fee
  distance_miles: number | null; // null when we couldn't compute distance
  free_distance_miles: number;
  surcharge_per_mile: number;
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface BusinessHours {
  [day: string]: { start: string; end: string } | null;
}

export interface PriceList {
  [trade: string]: { low: number; high: number };
}

export interface Customer {
  id: string;
  boss_id: string;
  phone: string;
  name: string | null;
  address: string | null;
  zipcode: string | null;
  notes: string | null;
  total_jobs: number;
  created_at: string;
  updated_at: string;
}

export interface WorkOrder {
  id: string;
  boss_id: string;
  customer_id: string | null;
  customer_name: string | null;
  // The name the AI heard in the call, extracted from the transcript. The
  // customer_name above is the caller ID, which is empty for most calls.
  customer_name_extracted?: string | null;
  // Which path produced the LLM summary fields. Only "llm" rows may be
  // reused as a cache hit — a regex fallback can be empty, and caching one
  // of those locks the gap in permanently.
  summary_source?: "llm" | "regex" | "regex-fallback" | null;
  customer_phone: string;
  customer_address: string | null;
  customer_zipcode: string | null;
  issue_type: IssueType | null;
  issue_details: string | null;
  preferred_time: string | null;
  ai_decision: AIDecision;
  ai_decision_reason: string | null;
  quote_low: number | null;
  quote_high: number | null;
  pricing_breakdown?: PricingBreakdown | null;
  summary: string | null;
  vapi_call_id: string | null;
  recording_url: string | null;
  transcript: TranscriptEntry[] | null;
  status: WorkOrderStatus;
  confirmed_at: string | null;
  callback_initiated_at: string | null;
  // Emergency outbound call tracking
  outbound_attempts?: number;
  last_outbound_at?: string | null;
  outbound_call_id?: string | null;
  boss_decision?: "callback_initiated" | "queued" | null;
  // Origin of this record (so demo / test / production can be filtered separately)
  data_source?: "demo" | "production" | "test";
  // Multi-region field (migration 009). 'US' | 'SG' | 'MY' | 'ID' | ...
  country?: string | null;
  // Which line picked up (migration 013): the AI receptionist, a human, or a
  // handover where the AI started and a human took over.
  call_type?: "ai" | "human" | "hybrid";
  // Human-line metadata — null on AI-only calls.
  human_answered?: boolean | null;
  human_ring_seconds?: number | null;
  /** Human-facing label for the line, e.g. "Handy Works direct line". */
  line_label?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: number;
}

// =====================================================
// Vapi Webhook payload types (subset we care about)
// See: https://docs.vapi.ai/server-url
// =====================================================

export interface VapiWebhookPayload {
  message: {
    type:
      | "status-update"
      | "transcript"
      | "tool-calls"
      | "end-of-call-report"
      | "conversation-update"
      | "function-call"
      | "speech-update"
      | "hang"
      | "transfer-destination-request";

    // Status update fields
    status?: "queued" | "ringing" | "in-progress" | "forwarding" | "ended" | "failed" | "busy" | "no-answer";

    // Call info
    call?: {
      id: string;
      orgId: string;
      assistantId?: string;
      type?: "inboundPhoneCall" | "outboundPhoneCall" | "webCall";
      phoneNumberId?: string;
      customer?: { number: string; name?: string };
      startedAt?: string;
      endedAt?: string;
      endedReason?: string;
      cost?: number;
      recordingUrl?: string;
      transcript?: string;
    };

    // Transcript fields
    transcript?: string;
    // Vapi uses "bot" for the assistant's own turns (not "assistant").
    role?: "user" | "assistant" | "bot" | "system";

    // Tool calls (Vapi sends both; toolCallList is the "completed" list with results)
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      };
    }>;
    toolCallList?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
      };
    }>;

    // End of call report
    summary?: string;
    transcript_combined?: string;
    // Recording lives at message level (and mirrored inside artifact) — NOT
    // on message.call. See order.ts persistRecording() call site.
    recordingUrl?: string;
    stereoRecordingUrl?: string;
    artifact?: {
      recordingUrl?: string;
      stereoRecordingUrl?: string;
      // SigV4-signed URLs — these are the ONLY ones that can actually be
      // fetched. `recordingUrl` is a raw bucket path and returns 400.
      presignedMonoUrl?: string;
      presignedStereoUrl?: string;
      presignedCustomerUrl?: string;
      presignedAssistantUrl?: string;
      presignedUrlsExpiresAt?: string;
      transcript?: string;
      messages?: unknown[];
    };
    messages?: Array<{
      // "bot" = the AI, "tool_calls" = a function-call turn,
      // "tool_call_result" = a function result turn.
      role: "user" | "assistant" | "bot" | "system" | "tool" | "tool_calls" | "tool_call_result";
      message?: string;
      // Vapi puts the spoken text here for bot/user turns.
      messageContent?: string;
      content?: string;
      time?: number;
      name?: string;
      toolCallId?: string;
      result?: unknown;
      toolCalls?: Array<{
        id?: string;
        type?: string;
        name?: string;
        arguments?: Record<string, unknown> | string;
        result?: string;
        function?: {
          name: string;
          arguments: Record<string, unknown> | string;
          result?: string;
        };
      }>;
      toolCallResults?: Array<{
        id?: string;
        name?: string;
        result?: unknown;
      }>;
    }>;
    analysis?: {
      summary?: string;
      successEvaluation?: string;
      structuredData?: Record<string, unknown>;
    };
  };
}

// =====================================================
// Function call tool result types
// =====================================================

export interface ValidateServiceArgs {
  zipcode: string;
  issue_type: IssueType;
}

export interface ValidateServiceResult {
  ok: boolean;
  reason?: string;
  distance_miles?: number;
}

export interface GetPriceQuoteArgs {
  issue_type: IssueType;
}

export interface GetPriceQuoteResult {
  available: boolean;
  trip_fee: number;
  fuel_surcharge: number;
  total_trip_fee: number;
  distance_miles: number | null;
  range?: { low: number; high: number };
  total_low?: number;
  total_high?: number;
  currency_symbol?: string;  // '$' | 'S$' | 'RM' | 'Rp'
}
