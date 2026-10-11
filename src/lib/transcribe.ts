/**
 * transcribe.ts — audio → text.
 *
 * Used by the human-answering line: Twilio records the call, we pull the
 * audio and turn it into a transcript before summarising it.
 *
 * Why OpenAI Whisper specifically:
 *   - The AI line already depends on OpenAI at runtime (openai-summarize.ts
 *     calls gpt-4o-mini on every single call), so this is not a new failure
 *     mode — it is the same vendor, the same API key, the same region.
 *   - Introducing Deepgram or Google STT here would mean a new account, a new
 *     key, and a new thing that can break at 3am.
 *
 * Cost: whisper-1 is ~$0.006/min. A four-minute call is about $0.024, which is
 * only paid when a human actually answers.
 */

import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  _client = new OpenAI({ apiKey: key });
  return _client;
}

export interface TranscriptResult {
  text: string;
  durationSeconds: number | null;
  language: string | null;
}

/**
 * Transcribe a recording.
 *
 * @param audioUrl  publicly reachable audio URL (Twilio hands these out)
 * @param mimeType  optional hint; Twilio recordings are usually audio/x-wav
 */
export async function transcribeAudio(
  audioUrl: string,
  mimeType?: string,
): Promise<TranscriptResult> {
  const client = getClient();
  const res = await client.audio.transcriptions.create({
    file: await fetch(audioUrl),
    model: "whisper-1",
    ...(mimeType ? { language: undefined } : {}),
  });

  return {
    text: (res as unknown as { text: string }).text?.trim() || "",
    durationSeconds: null,
    language: null,
  };
}

/**
 * Best-effort transcription that never throws.
 *
 * A failed transcript must not lose the recording — the audio is the valuable
 * artefact (Alex can still listen), the text is derivable from it later. So we
 * return null and let the caller keep the storage URL and mark the order as
 * "not yet transcribed" instead of failing the whole ingest.
 */
export async function transcribeAudioSafe(
  audioUrl: string,
  mimeType?: string,
): Promise<TranscriptResult | null> {
  try {
    const out = await transcribeAudio(audioUrl, mimeType);
    return out.text ? out : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[transcribe] failed for ${audioUrl}: ${msg}`);
    return null;
  }
}

/**
 * Split a plain Whisper transcript into turn objects.
 *
 * Whisper gives us a flat blob with no speaker labels, so we cannot reliably
 * say who said what. Rather than fabricate turns, we store the whole thing as a
 * single block — the dashboard shows it as one continuous transcript instead of
 * pretending to know the speakers. If speaker labels are ever needed, the fix
 * is diarization (Deepgram/AssemblyAI), not a guess here.
 */
export function plainTextToTranscript(text: string): Array<{ role: string; text: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return [{ role: "user", text: trimmed }];
}
