import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { persistRecording } from "@/lib/recording-storage";
import { transcribeAudioSafe, plainTextToTranscript } from "@/lib/transcribe";
import { summarizeWithFallback } from "@/lib/openai-summarize";
import { collectFormParams, verifyTwilioSignature, rejectInvalidSignature } from "@/lib/twilio-signature";

/**
 * POST /api/human-line/recording
 *
 * Twilio `recordingStatusCallback` for the human-answering line.
 *
 * This is the point where a human call becomes a first-class work order —
 * identical in shape to an AI call, just tagged `call_type = 'human'` so the
 * dashboard can separate them. Same columns, same summary pipeline, same
 * follow-up fields. No parallel data model.
 *
 * Order of operations matters here: the audio is copied into our own storage
 * *before* anything else, because Twilio's URL is only valid for a few hours
 * and the recording is the irreplaceable artefact. If transcription or
 * summarisation then fails we still keep the audio and mark the order as
 * pending transcription rather than dropping the call.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Twilio posts form-encoded params. */
async function readForm(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries(form.entries() as Iterable<[string, string]>);
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const sigParams = collectFormParams(form);
  const signatureCheck = verifyTwilioSignature(req, sigParams);
  const signatureDenied = rejectInvalidSignature(signatureCheck);
  if (signatureDenied) return signatureDenied;

  const params = await readForm(req);
  const recordingUrl = params.RecordingUrl || "";
  const callSid = params.CallSid || "";

  // Twilio sends this on every status event; only act on the finished one.
  if (params.RecordingStatus && params.RecordingStatus !== "completed") {
    return NextResponse.json({ ok: true, skipped: params.RecordingStatus });
  }
  if (!recordingUrl) {
    return NextResponse.json({ ok: false, error: "RecordingUrl missing" }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    // Which line is this? Match the destination number back to the boss.
    const to = params.To || "";
    const from = params.From || "";
    const { data: boss } = await supabase
      .from("bosses")
      .select("id, company_name, owner_name, phone, currency_code, locale, timezone, service_zip_prefixes")
      .eq("human_line_number", to)
      .limit(1)
      .maybeSingle();

    if (!boss) {
      console.warn(`[human-line] no boss owns ${to} — recording ${callSid} dropped`);
      return NextResponse.json({ ok: false, error: "unknown line" }, { status: 404 });
    }

    // 1) Preserve the audio first — everything else can be redone from it.
    const stableUrl = await persistRecording(recordingUrl, `human-${callSid}`);
    const audioUrl = stableUrl || recordingUrl;

    // 2) Transcribe.
    const heard = await transcribeAudioSafe(audioUrl, params.RecordingContentType);
    const transcriptText = heard?.text || "";
    const transcript = plainTextToTranscript(transcriptText);

    // 3) Summarise with the same pipeline the AI line uses.
    const { summary, source } = await summarizeWithFallback(
      transcript,
      params.CallerName || null,
      null,
      transcriptText ? "accepted" : "unsure",
      [],
      [],
      { callId: callSid },
    );

    // 4) A human answered, so there is no AI decision to record. Mark it
    //    human_handled so the dashboard does not pretend an AI triaged it.
    const decision = transcriptText ? "human_handled" : "unsure";
    const status = transcriptText ? "pending" : "callback";

    const row = {
      boss_id: boss.id,
      customer_phone: from || "(unknown)",
      customer_name: params.CallerName || summary.customerNameExtracted || null,
      customer_zipcode: summary.mentionedTopics?.[0]?.match(/\b77\d{3}\b/)?.[0] || null,
      issue_type: null,
      accepted_topics: [],
      rejected_topics: [],
      ai_decision: decision,
      ai_decision_reason: "Answered by a person on the direct line",
      call_type: "human" as const,
      human_answered: true,
      human_ring_seconds: params.DialCallDuration ? Number(params.DialCallDuration) : null,
      line_label: `${boss.company_name} direct line`,
      summary: summary.intentSummary || transcriptText.slice(0, 300) || null,
      intent_summary: summary.intentSummary || null,
      customer_tendency: summary.customerTendency || null,
      mentioned_topics: summary.mentionedTopics || [],
      follow_up_priority: summary.followUpPriority || "none",
      follow_up_notes: summary.followUpNotes || null,
      follow_up_recommended: summary.followUpRecommended ?? false,
      customer_name_extracted: summary.customerNameExtracted || null,
      transcript,
      recording_url: audioUrl,
      status,
      data_source: "production" as const,
      country: "US",
      vapi_call_id: `twilio-${callSid}`,
      // No Vapi call id, so reuse the sha256 slot to keep re-delivery idempotent.
      summary_hash: `human-${callSid}`,
      updated_at: new Date().toISOString(),
      // Surfaced in the admin log so a silent LLM outage is visible.
      ...(source === "llm" ? {} : { transcript_coherence: "low" }),
    };

    const { data: inserted, error } = await supabase
      .from("work_orders")
      .upsert(row, { onConflict: "vapi_call_id" })
      .select("id, summary_hash")
      .single();

    if (error) {
      console.error("[human-line] insert failed:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    console.log(
      `[human-line] ${callSid} → work order ${inserted.id} (summary via ${source}, transcript ${transcriptText.length} chars)`,
    );

    return NextResponse.json({
      ok: true,
      workOrderId: inserted.id,
      transcribed: !!transcriptText,
      summarySource: source,
      recordingUrl: audioUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[human-line] recording handler failed:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
