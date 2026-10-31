import type { WorkOrder } from "./types";
import { getServiceClient } from "./supabase";
import { logNotification } from "./notify";
import twilio from "twilio";

/**
 * Emergency outbound call to the boss — via Twilio (not Vapi).
 *
 * Vapi-bought numbers have a daily outbound cap that we'd hit within the first
 * 2-3 urgent jobs. Twilio's outbound is unlimited on a paid plan and only
 * $0.013/min for US calls.
 *
 * Flow:
 *   1. Twilio dials the boss
 *   2. Twilio fetches /api/twilio/emergency-twiml which returns:
 *      - <Play> emergency-alert.mp3 (boss's own voice) OR <Say> fallback
 *      - <Gather> for 1 = call back now, 2 = queue
 *   3. Boss presses a key → Twilio POSTs to /api/twilio/emergency-decision
 *   4. Decision endpoint updates the work order
 *
 * If the boss doesn't answer, the cron endpoint /api/cron/emergency-retry
 * re-dials after 5 min (up to 3 attempts), then falls back to SMS.
 */

interface EmergencyCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

/**
 * Place an outbound emergency call to the boss via Twilio.
 */
export async function placeEmergencyCall(
  boss: { phone: string; owner_name: string },
  order: WorkOrder,
): Promise<EmergencyCallResult> {
  // Dev / test mode: skip the real call to avoid disturbing the boss during
  // automated tests. To actually place a call, set NODE_ENV=production or
  // EMERGENCY_TEST_MODE=0 explicitly.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.EMERGENCY_TEST_MODE !== "0"
  ) {
    const fakeSid = `TST${Date.now()}`;
    console.log(
      `[emergency] TEST MODE — would call ${boss.phone} about order ${order.id} (sid=${fakeSid})`,
    );
    return { success: true, callId: fakeSid };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!accountSid || !authToken || !fromNumber) {
    const reason = "twilio_not_configured";
    await logNotification(
      order.id,
      "voice",
      boss.phone,
      `Emergency call about job ${order.id}`,
      "failed",
      reason,
    );
    return { success: false, error: reason };
  }
  if (!publicUrl) {
    const reason = "NEXT_PUBLIC_APP_URL not set";
    await logNotification(
      order.id,
      "voice",
      boss.phone,
      `Emergency call about job ${order.id}`,
      "failed",
      reason,
    );
    return { success: false, error: reason };
  }

  // Stash the work order id so the TwiML + decision endpoints can find it
  // (Twilio doesn't pass arbitrary params in the call, so we encode the id
  //  into the TwiML URL's ?order=<id> query — Twilio preserves it in the
  //  callback to the decision endpoint).
  const twimlUrl = `${publicUrl}/api/twilio/emergency-twiml?order=${order.id}`;

  try {
    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: boss.phone,
      from: fromNumber,
      url: twimlUrl,
      method: "POST",
      statusCallback: `${publicUrl}/api/twilio/emergency-status`,
      statusCallbackMethod: "POST",
      // Cap the call at 60s — boss should be quick
      timeout: 30,
      // Recording optional — we record so we can show the boss listened
      record: false,
    });

    await logNotification(
      order.id,
      "voice",
      boss.phone,
      `Emergency call about job ${order.id}`,
      "sent",
      null,
      call.sid,
    );
    return { success: true, callId: call.sid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[emergency] Twilio call failed: ${msg}`);
    // Log the failure too — a voice attempt that never connected used to
    // leave no trace, so the dashboard could not distinguish "called and it
    // failed" from "never tried". The SMS path has been logged this way
    // since 2026-10-31; the voice path had to catch up.
    await logNotification(
      order.id,
      "voice",
      boss.phone,
      `Emergency call about job ${order.id}`,
      "failed",
      msg,
    );
    return { success: false, error: msg };
  }
}

/**
 * Update the work order based on the boss's keypad decision.
 */
export async function recordBossDecision(
  workOrderId: string,
  decision: "callback_initiated" | "queued" | "no_response",
  twilioCallSid: string,
): Promise<{ status: WorkOrder["status"]; bossDecision: string | null }> {
  const supabase = getServiceClient();

  const now = new Date().toISOString();
  let newStatus: WorkOrder["status"];
  let bossDecision: string | null;

  if (decision === "callback_initiated") {
    newStatus = "callback";
    bossDecision = "callback_initiated";
  } else if (decision === "queued") {
    newStatus = "urgent";
    bossDecision = "queued";
  } else {
    // no_response — keep status as urgent, don't mark a decision
    newStatus = "urgent";
    bossDecision = null;
  }

  await supabase
    .from("work_orders")
    .update({
      status: newStatus,
      callback_initiated_at: decision === "callback_initiated" ? now : null,
      boss_decision: bossDecision,
      updated_at: now,
    })
    .eq("id", workOrderId);

  await supabase.from("call_events").insert({
    work_order_id: workOrderId,
    vapi_call_id: twilioCallSid,
    event_type: "emergency_call.decision",
    payload: { decision, status: newStatus },
  });

  return { status: newStatus, bossDecision };
}
