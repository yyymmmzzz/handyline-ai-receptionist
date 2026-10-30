import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * GET /api/human-line/status
 *
 * Is the human-answering line actually able to take a call right now?
 *
 * The /human-calls page needs to tell the operator the truth instead of
 * showing an empty list that looks like a broken feature. Three things decide
 * that:
 *   1. does the boss have a human line number assigned and enabled
 *   2. does the Twilio account actually own that number
 *   3. what happens when nobody picks up (fallback)
 *
 * No secrets are returned — just phone numbers, flags and counts.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function twilioJson(path: string): Promise<{ status: number; body: any }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { status: 0, body: null };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      },
      cache: "no-store",
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    return { status: 0, body: null };
  }
}

export async function GET() {
  try {
    const supabase = getServiceClient();

    const { data: bosses, error } = await supabase
      .from("bosses")
      .select(
        "id, company_name, country, phone, human_line_enabled, human_line_number, human_answer_phone, human_line_ring_seconds, human_line_fallback",
      )
      .order("company_name");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const { data: calls } = await supabase
      .from("work_orders")
      .select("id, call_type, human_answered, recording_url, human_minutes, created_at")
      .eq("call_type", "human");

    const humanCalls = calls || [];

    // Which Twilio numbers does the account actually own?
    const account = await twilioJson("/.json");
    const numbers = await twilioJson("/IncomingPhoneNumbers.json?PageSize=50");
    const ownedNumbers: string[] = (numbers.body?.incoming_phone_numbers || []).map(
      (n: any) => n.phone_number,
    );

    const lines = (bosses || []).map((b: any) => {
      const configured = !!b.human_line_number;
      const owned = configured && ownedNumbers.includes(b.human_line_number);
      return {
        bossId: b.id,
        companyName: b.company_name,
        country: b.country,
        enabled: !!b.human_line_enabled,
        number: b.human_line_number,
        answerPhone: b.human_answer_phone,
        ringSeconds: b.human_line_ring_seconds,
        fallback: b.human_line_fallback,
        ownedByTwilio: owned,
        // The line can only ring if it is enabled AND the number is really ours.
        live: !!b.human_line_enabled && owned,
      };
    });

    const anyLive = lines.some((l) => l.live);

    return NextResponse.json({
      ok: true,
      twilio: {
        reachable: account.status === 200,
        type: account.body?.type ?? null,
        status: account.body?.status ?? null,
        trial: account.body?.type === "Trial",
        ownedNumbers,
      },
      lines,
      anyLive,
      counts: {
        humanCalls: humanCalls.length,
        withRecording: humanCalls.filter((c: any) => !!c.recording_url).length,
        withMinutes: humanCalls.filter((c: any) => !!c.human_minutes).length,
        answered: humanCalls.filter((c: any) => c.human_answered).length,
      },
      // A single sentence the UI can show without interpreting the rest.
      headline: anyLive
        ? "The human line is live — incoming calls will ring Alex's phone."
        : lines.some((l) => l.enabled)
          ? "The human line is enabled but the number is not owned by Twilio yet, so calls cannot come in."
          : "The human line is not enabled yet (no number bought / not wired up).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
