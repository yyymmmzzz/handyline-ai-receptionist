import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * POST /api/human-line/voice
 *
 * Twilio voice webhook for the dedicated human-answering line.
 *
 * WHY THIS EXISTS (2026-10-11)
 * ----------------------------
 * Alex gets a second number that a *person* answers. The AI line is untouched.
 * This route is what that number points at.
 *
 * The shape is deliberately Twilio-native rather than Vapi-native. Vapi only
 * records calls that run through Vapi, and Vapi's behaviour after a transfer
 * could not be verified from this environment (the transfer docs 404). Twilio's
 * <Record> semantics are stable and documented, so the human line does not
 * depend on an unverified assumption.
 *
 * Flow:
 *   inbound call
 *     -> ring Alex's phone for N seconds (boss.human_line_ring_seconds)
 *     -> answered: record the call, play the AI-composed privacy notice,
 *        bridge the two legs
 *     -> not answered: action= falls through to /api/human-line/no-answer
 *
 * Recording is `record-from-answer-dual`, so we get both legs on separate
 * channels — useful later if we ever want to isolate Alex's voice.
 */

export const dynamic = "force-dynamic";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://demo-navy-chi-47.vercel.app";

/** Escape text before it goes inside <Say>. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const params = Object.fromEntries((form?.entries() as Iterable<[string, string]>) ?? []);

  const to = params.To || "";
  const from = params.From || "";

  // Signed-off requests from Alex's own whitelist are not customer calls —
  // let them ring straight through.
  const supabase = getServiceClient();
  const { data: boss } = await supabase
    .from("bosses")
    .select(
      "id, company_name, human_line_enabled, human_line_number, human_answer_phone, human_line_ring_seconds, human_line_fallback, phone, owner_name, whitelist_numbers",
    )
    .eq("human_line_enabled", true)
    .not("human_line_number", "is", null)
    .limit(1)
    .maybeSingle();

  if (!boss) {
    return twiml(
      `<Say voice="alice">Sorry, this line is not set up yet. Please call our main number.</Say>`,
    );
  }

  const answerPhone = boss.human_answer_phone || boss.phone;

  const whitelist = (boss.whitelist_numbers as string[] | null) || [];
  if (from && whitelist.includes(from)) {
    return twiml(
      `<Say voice="alice">Handy Works, you are through.</Say>` +
        `<Dial callerId="${esc(to)}">${esc(answerPhone || boss.human_line_number)}</Dial>`,
    );
  }

  if (!answerPhone) {
    return twiml(
      `<Say voice="alice">Sorry, this line is not set up correctly. Please call back later.</Say>`,
    );
  }

  const ringSeconds = boss.human_line_ring_seconds || 20;

  // Play the recording notice only once the human has actually picked up, so
  // we never make an unanswered caller listen to a compliance notice.
  const notice = (() => {
    const noticeUrl = process.env.HUMAN_LINE_RECORDING_NOTICE_URL;
    if (noticeUrl) return `<Play>${esc(noticeUrl)}</Play>`;
    return "";
  })();

  return twiml(
    `<Dial callerId="${esc(to)}" timeout="${ringSeconds}" answerOnBridge="true"` +
      ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${BASE_URL}/api/human-line/recording"` +
      ` recordingStatusCallbackMethod="POST"` +
      ` recordingStatusCallbackEvent="completed"` +
      ` action="${BASE_URL}/api/human-line/no-answer"` +
      ` actionMethod="POST">` +
      notice +
      `<Number>${esc(answerPhone)}</Number>` +
      `</Dial>`,
  );
}
