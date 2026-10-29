import { NextRequest, NextResponse } from "next/server";
import { recordBossDecision } from "@/lib/emergency-call";
import { collectFormParams, verifyTwilioSignature, rejectInvalidSignature } from "@/lib/twilio-signature";

/**
 * Twilio decision callback — invoked when the boss presses a key during
 * the emergency call.
 *
 *   Digit "1" → boss will call the customer now → status = callback
 *   Digit "2" → boss will call later → status = urgent (no change in status)
 *   No digit (timeout) → status = urgent, boss_decision stays null
 *
 * Twilio sends a form-urlencoded body with `Digits` and `CallSid`.
 */

export async function POST(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("order");
  if (!orderId) {
    return hangupTwiml("Missing order id.");
  }

  // Twilio sends application/x-www-form-urlencoded
  const form = await req.formData();
  const sigParams = collectFormParams(form);
  const signatureCheck = verifyTwilioSignature(req, sigParams);
  const signatureDenied = rejectInvalidSignature(signatureCheck);
  if (signatureDenied) return signatureDenied;
  const digits = (form.get("Digits") as string | null) || "";
  const callSid = (form.get("CallSid") as string | null) || "";

  let decision: "callback_initiated" | "queued" | "no_response" = "no_response";
  let message = "Got it, we'll send you a text.";

  if (digits === "1") {
    decision = "callback_initiated";
    message = "Got it. Calling them back now.";
  } else if (digits === "2") {
    decision = "queued";
    message = "Got it. Queued for later.";
  } else if (digits) {
    message = "Didn't catch that. We'll text you the details.";
  }

  await recordBossDecision(orderId, decision, callSid);

  return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${message}</Say>
  <Hangup/>
</Response>`);
}

function twimlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function hangupTwiml(reason: string) {
  return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${reason}</Say>
  <Hangup/>
</Response>`);
}

export const dynamic = "force-dynamic";
