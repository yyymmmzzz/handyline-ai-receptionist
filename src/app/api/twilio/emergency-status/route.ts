import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { collectFormParams, verifyTwilioSignature, rejectInvalidSignature } from "@/lib/twilio-signature";

/**
 * Twilio status callback — fires when the emergency call state changes
 * (ringing, in-progress, completed, no-answer, busy, failed, canceled).
 *
 * We log the status to call_events. The cron /api/cron/emergency-retry
 * uses `last_outbound_at` + status to figure out when to retry.
 *
 * For "no-answer" / "busy" / "failed" the cron will re-dial after the
 * retry interval (default 5 min), up to EMERGENCY_MAX_ATTEMPTS (default 3).
 */

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sigParams = collectFormParams(form);
  const signatureCheck = verifyTwilioSignature(req, sigParams);
  const signatureDenied = rejectInvalidSignature(signatureCheck);
  if (signatureDenied) return signatureDenied;
  const callSid = (form.get("CallSid") as string | null) || "";
  const callStatus = (form.get("CallStatus") as string | null) || "";
  const from = (form.get("From") as string | null) || "";
  const to = (form.get("To") as string | null) || "";
  const duration = (form.get("CallDuration") as string | null) || "";

  console.log(`[emergency-status] ${callSid}: ${callStatus} (${duration}s)`);

  // Find the work order that owns this call via outbound_call_id
  const supabase = getServiceClient();
  const { data: order } = await supabase
    .from("work_orders")
    .select("id")
    .eq("outbound_call_id", callSid)
    .single();

  await supabase.from("call_events").insert({
    work_order_id: order?.id || null,
    vapi_call_id: callSid,
    event_type: `emergency_call.${callStatus}`,
    payload: {
      from,
      to,
      duration: Number(duration) || 0,
    },
  });

  // For terminal failure states, we don't change boss_decision —
  // the cron will retry if attempts < max.
  return NextResponse.json({ received: true });
}

export const dynamic = "force-dynamic";
