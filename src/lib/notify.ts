import type { WorkOrder, Boss } from "./types";
import { getServiceClient } from "./supabase";
import twilio from "twilio";

/**
 * Cached result of the Twilio readiness probe.
 */
let twilioCheck: { ok: boolean; reason: string } | null = null;

/**
 * Check once per process whether this Twilio account can actually send SMS.
 *
 * Two things silently break SMS in this account:
 *   - a Trial that has expired ("Your Trial account has expired")
 *   - a `from` number that Twilio does not own (the AI line lives on Vapi,
 *     so sending "from" it through Twilio can never work)
 *
 * Without this probe the only symptom is a cryptic Twilio error in the
 * notifications table, which nobody reads.
 */
async function checkTwilioReady(): Promise<{ ok: boolean; reason: string }> {
  if (twilioCheck) return twilioCheck;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken) {
    twilioCheck = { ok: false, reason: "twilio_credentials_missing" };
    return twilioCheck;
  }
  if (!fromNumber) {
    twilioCheck = { ok: false, reason: "twilio_from_number_missing" };
    return twilioCheck;
  }

  try {
    const client = twilio(accountSid, authToken);
    const account = await client.api.v2010.accounts(accountSid).fetch();
    if (account.type === "Trial" && account.status !== "active") {
      twilioCheck = { ok: false, reason: `twilio_trial_${account.status}` };
      return twilioCheck;
    }
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    const owned = numbers.filter((n: { phoneNumber: string }) => n.phoneNumber === fromNumber);
    if (owned.length === 0) {
      twilioCheck = {
        ok: false,
        reason: `twilio_from_not_owned:${fromNumber}`,
      };
      return twilioCheck;
    }
    twilioCheck = { ok: true, reason: "ok" };
  } catch (err) {
    twilioCheck = {
      ok: false,
      reason: `twilio_probe_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return twilioCheck;
}

/**
 * Send an SMS to the boss about a new work order.
 * - For URGENT orders, sends a high-priority SMS immediately.
 * - For others, sends a summary with a tap-to-call-back link.
 */
export async function notifyBossOfNewOrder(
  boss: Boss,
  order: WorkOrder,
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[notify] Twilio not configured — skipping SMS");
    await logNotification(order.id, "sms", boss.phone, order.summary || "New job", "failed", "twilio_not_configured");
    return;
  }

  const ready = await checkTwilioReady();
  if (!ready.ok) {
    console.error(`[notify] Twilio cannot send SMS — ${ready.reason}. The boss was NOT notified.`);
    await logNotification(
      order.id,
      "sms",
      boss.phone,
      formatSms(boss, order),
      "failed",
      ready.reason,
    );
    return;
  }

  const message = formatSms(boss, order);

  try {
    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: boss.phone,
    });

    await logNotification(order.id, "sms", boss.phone, message, "sent", null, result.sid);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[notify] SMS failed:", errMsg);
    await logNotification(order.id, "sms", boss.phone, message, "failed", errMsg);
  }
}

/**
 * Initiate a callback from the boss to the customer using Twilio outbound.
 * For the demo, this just logs and returns — a real implementation would
 * either:
 *   1. Use Vapi to make an outbound AI-assisted call
 *   2. Place a Twilio call that connects the boss's phone to the customer's
 *
 * Simplest demo approach: send a click-to-call SMS to the boss with the
 * customer's number.
 */
export async function initiateCallback(order: WorkOrder): Promise<void> {
  const supabase = getServiceClient();

  // Mark as callback initiated
  await supabase
    .from("work_orders")
    .update({
      status: "confirmed", // optimistic; boss will confirm manually
      callback_initiated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  // Send click-to-call SMS
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  // The boss's phone lives on the `bosses` row — that is the value verified
  // against Handy Works' public contact details. TWILIO_BOSS_PHONE is only a
  // fallback, because it silently drifted to the wrong number once and the
  // click-to-call SMS then went to the wrong handset.
  let bossPhone: string | null = null;
  try {
    const { data: bossRow } = await supabase
      .from("bosses")
      .select("phone")
      .eq("id", order.boss_id)
      .maybeSingle();
    bossPhone = (bossRow as { phone?: string } | null)?.phone ?? null;
  } catch {
    // fall through to the env fallback
  }

  const envBossPhone = process.env.TWILIO_BOSS_PHONE;
  if (envBossPhone && bossPhone && envBossPhone !== bossPhone) {
    console.warn(
      `[notify] TWILIO_BOSS_PHONE (${envBossPhone}) disagrees with the bosses row ` +
        `(${bossPhone}) — using the bosses row. Fix TWILIO_BOSS_PHONE.`,
    );
  }
  if (!bossPhone) bossPhone = envBossPhone ?? null;

  if (!accountSid || !authToken || !fromNumber || !bossPhone) {
    console.warn("[notify] Twilio not configured for callback");
    return;
  }

  const ready = await checkTwilioReady();
  if (!ready.ok) {
    console.error(`[notify] Twilio cannot send SMS — ${ready.reason}. The boss was NOT notified.`);
    await logNotification(order.id, "sms", bossPhone, "Call back request", "failed", ready.reason);
    return;
  }

  // tel: link works on mobile — clicking opens the dialer
  const telLink = `tel:${order.customer_phone}`;
  const message =
    order.ai_decision === "urgent"
      ? `URGENT: Call ${order.customer_name || "customer"} now at ${order.customer_phone}. ${order.summary || ""}`
      : `Call back ${order.customer_name || "customer"} at ${order.customer_phone}. ${order.summary || ""} Tap to call: ${telLink}`;

  try {
    const client = twilio(accountSid, authToken);
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: bossPhone,
    });

    await logNotification(order.id, "sms", bossPhone, message, "sent", null, result.sid);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[notify] Callback SMS failed:", errMsg);
    await logNotification(order.id, "sms", bossPhone, message, "failed", errMsg);
  }
}

/**
 * Format the SMS message based on decision type.
 */
function formatSms(boss: Boss, order: WorkOrder): string {
  const decisionEmoji = {
    urgent: "🚨 URGENT",
    accepted: "✅ New job",
    unsure: "📞 Callback",
    rejected: "❌ Out of scope",
  }[order.ai_decision];

  // Build the price line. If we have a full pricing breakdown, show the
  // total estimate (range + trip fee). Otherwise fall back to the basic
  // range + diagnostic fee.
  let priceLine = "";
  const pb = order.pricing_breakdown;
  if (pb && pb.range_low && pb.range_high) {
    const surchargeNote =
      pb.fuel_surcharge > 0
        ? ` (incl. $${pb.trip_fee} trip + $${pb.fuel_surcharge} fuel surcharge, ${pb.distance_miles ?? "?"} mi from base)`
        : ` (incl. $${pb.trip_fee} trip)`;
    priceLine = `Estimate: $${pb.total_low}–$${pb.total_high}${surchargeNote}`;
  } else if (order.quote_low && order.quote_high) {
    priceLine = `Quote: $${order.quote_low}–$${order.quote_high} (+ $${boss.diagnostic_fee} diagnostic)`;
  }

  const lines = [
    `${decisionEmoji} — ${boss.company_name}`,
    order.summary || "(no summary)",
    `Customer: ${order.customer_name || "n/a"} (${order.customer_phone})`,
    priceLine,
    `Open: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/orders/${order.id}`,
  ].filter(Boolean);

  return lines.join("\n");
}

async function logNotification(
  workOrderId: string,
  channel: string,
  recipient: string,
  message: string,
  status: string,
  error: string | null,
  externalId?: string,
): Promise<void> {
  try {
    const supabase = getServiceClient();
    await supabase.from("notifications").insert({
      work_order_id: workOrderId,
      channel,
      recipient,
      message,
      status,
      error,
      ...(externalId ? { external_id: externalId } : {}),
    });
  } catch (err) {
    console.error("[notify] Failed to log notification:", err);
  }
}
