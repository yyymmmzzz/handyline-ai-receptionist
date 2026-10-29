import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { collectFormParams, verifyTwilioSignature, rejectInvalidSignature } from "@/lib/twilio-signature";

/**
 * TwiML endpoint for emergency outbound calls.
 *
 * When Twilio connects the call to the boss, it fetches this URL to get
 * instructions. We return:
 *   1. <Play> the boss's own pre-recorded alert (if uploaded to /public/audio/emergency-alert.mp3)
 *      Otherwise <Say> as a fallback using Twilio's TTS
 *   2. <Gather> for 1 = call back now, 2 = queue
 *   3. <Say> "we'll text you" if no input
 *
 * To use the boss's voice: record a 25-30 second MP3 and save it to
 * /public/audio/emergency-alert.mp3. We auto-detect the file at request time.
 *
 * The ?order=<id> query param tells the decision endpoint which work order
 * to update. Twilio preserves this on the Gather callback.
 */

export async function POST(req: NextRequest) {
  // Verify the request really came from Twilio before doing anything with it.
  const form = await req.formData().catch(() => null);
  const sigParams = collectFormParams(form);
  const signatureCheck = verifyTwilioSignature(req, sigParams);
  const signatureDenied = rejectInvalidSignature(signatureCheck);
  if (signatureDenied) return signatureDenied;

  const orderId = req.nextUrl.searchParams.get("order");
  if (!orderId) {
    // Without an order id, we can't route the decision. Just hang up.
    return twimmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, this alert is missing a work order id. Hanging up.</Say>
  <Hangup/>
</Response>`);
  }

  // Load the order to build a personalized intro (if we fall back to TTS)
  const supabase = getServiceClient();
  const { data: order } = await supabase
    .from("work_orders")
    .select("customer_name, customer_phone, issue_type, issue_details, summary")
    .eq("id", orderId)
    .single();

  const customerName = order?.customer_name || "a customer";
  const customerPhone = order?.customer_phone || "";
  const issueSummary =
    order?.issue_details ||
    order?.summary ||
    order?.issue_type ||
    "an urgent request";

  // Check whether the boss's pre-recorded audio exists by HEAD on the public URL.
  // We can't reliably check the file system from the edge; use a config flag
  // (EMERGENCY_AUDIO_URL) instead.
  const bossAudioUrl = process.env.EMERGENCY_AUDIO_URL;

  // Build the TwiML
  const safeIssue = issueSummary.replace(/[<>&"']/g, ""); // basic XML escape
  const safeName = customerName.replace(/[<>&"']/g, "");
  const safePhone = customerPhone.replace(/[<>&"']/g, "");

  // Choice: <Play> the boss's MP3 OR <Say> text fallback
  const intro = bossAudioUrl
    ? `<Play>${bossAudioUrl}</Play>`
    : `<Say voice="alice">Hey, this is HandyLine with an urgent one. ${safeName} at ${safePhone}. ${safeIssue}.</Say>`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${intro}
  <Gather numDigits="1" action="/api/twilio/emergency-decision?order=${orderId}" method="POST" timeout="8">
    <Say voice="alice">Press 1 to call them back now, or 2 to queue for later.</Say>
  </Gather>
  <Say>No response. We'll text you the details.</Say>
  <Hangup/>
</Response>`;

  return twimmlResponse(twiml);
}

// Also handle GET for testing in a browser
export async function GET(req: NextRequest) {
  return POST(req);
}

function twimmlResponse(xml: string) {
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export const dynamic = "force-dynamic";
