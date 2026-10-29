import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { collectFormParams, verifyTwilioSignature, rejectInvalidSignature } from "@/lib/twilio-signature";

/**
 * POST /api/human-line/no-answer
 *
 * Twilio `Dial action` — fires when nobody picked up the human line within
 * boss.human_line_ring_seconds.
 *
 * Behaviour is driven by boss.human_line_fallback:
 *   ai        → tell the caller our assistant can help right now. We cannot
 *               hand the live call over to Vapi at this point: Twilio has
 *               already released the <Dial>, and Vapi only accepts calls that
 *               enter through its own SIP/number plumbing. Wiring a true
 *               live handoff is a separate piece of work.
 *   voicemail → let them leave a message
 *   hangup    → apologise and end the call
 *
 * Every branch records something so a missed human call is still visible in the
 * dashboard as a callback rather than silently vanishing.
 */

export const dynamic = "force-dynamic";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://demo-navy-chi-47.vercel.app";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const sigParams = collectFormParams(form);
  const signatureCheck = verifyTwilioSignature(req, sigParams);
  const signatureDenied = rejectInvalidSignature(signatureCheck);
  if (signatureDenied) return signatureDenied;
  const params = Object.fromEntries((form?.entries() as Iterable<[string, string]>) ?? []);
  const to = params.To || "";
  const from = params.From || "";
  const duration = Number(params.DialCallDuration || 0);

  let fallback = "voicemail";
  try {
    const supabase = getServiceClient();
    const { data: boss } = await supabase
      .from("bosses")
      .select("id, company_name, human_line_fallback, human_line_ring_seconds, owner_name")
      .eq("human_line_number", to)
      .limit(1)
      .maybeSingle();

    if (boss) {
      fallback = boss.human_line_fallback || "voicemail";
      await supabase.from("work_orders").insert({
        boss_id: boss.id,
        customer_phone: from || "(unknown)",
        ai_decision: "unsure",
        ai_decision_reason: `No answer on the human line after ${boss.human_line_ring_seconds}s`,
        call_type: "human",
        human_answered: false,
        human_ring_seconds: duration,
        line_label: `${boss.company_name} direct line`,
        summary: "Nobody answered the direct line. Follow up when possible.",
        status: "callback",
        follow_up_priority: "high",
        data_source: "production",
        country: "US",
        vapi_call_id: `twilio-missed-${params.CallSid || Date.now()}`,
      });
    }
  } catch (err) {
    console.error("[human-line] no-answer bookkeeping failed:", err);
  }

  if (fallback === "hangup") {
    return twiml(
      `<Say voice="alice">Sorry, the line is not being answered right now. Please try again later.</Say>`,
    );
  }

  if (fallback === "ai") {
    return twiml(
      `<Say voice="alice">Our team is not available right now. Would you like me to have our assistant give you a price range and book the visit for you?</Say>` +
        `<Gather numDigits="1" action="${BASE_URL}/api/human-line/no-answer/route" timeout="8">` +
        `<Say voice="alice">Press 1 for an instant quote, or 2 to leave a message.</Say>` +
        `</Gather>`,
    );
  }

  // voicemail
  return twiml(
    `<Say voice="alice">Please leave a message after the tone with your name, number, and what you need.</Say>` +
      `<Record maxLength="120" playBeep="true" action="${BASE_URL}/api/human-line/no-answer/route" recordingStatusCallback="${BASE_URL}/api/human-line/recording" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" transcribe="false" />` +
      `<Say voice="alice">Thanks, we'll get back to you.</Say>`,
  );
}
