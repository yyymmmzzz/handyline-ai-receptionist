/**
 * recording-storage.ts — make Vapi / Twilio recordings survive their expiry.
 *
 * THE PROBLEM THIS FIXES (2026-10-01)
 * -----------------------------------
 * Vapi hands back `recordingUrl` values that are *presigned* and expire about
 * 30 minutes after the call ends. `order.ts` was storing that URL verbatim,
 * so every "play recording" link in the dashboard went dead half an hour
 * later. There was no production code that copied the audio anywhere — only
 * the offline `scripts/import-vapi-calls.js` knew how to do it, which is why
 * this went unnoticed: the import script repaired the data, the live path
 * never did.
 *
 * WHAT THIS DOES
 * --------------
 * Downloads the audio while the URL is still valid and re-hosts it in our own
 * Supabase Storage bucket, then stores that permanent URL instead.
 *
 * Failure policy: never throw. A missing recording must not fail the whole
 * webhook — we fall back to the original (soon-to-expire) Vapi URL and let the
 * rest of the work order write normally.
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET = "call-recordings";
/** Anything under 100 bytes is an error page, not audio. */
const MIN_AUDIO_BYTES = 100;
/** Don't spend forever on a stuck download inside a webhook. */
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — a 10-minute call is well under this

function storagePathFor(callId: string): string {
  return `${BUCKET}/${callId}.wav`;
}

/**
 * True when a URL already points at our own storage, so we can skip the
 * download entirely on re-runs.
 */
export function isPermanentRecording(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/storage/v1/object/") || url.includes(`/${BUCKET}/`);
}

function publicUrlFor(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  return `${base}/storage/v1/object/public/${path}`;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Copy a recording into Supabase Storage and return the permanent URL.
 *
 * Idempotent: the upload uses `upsert`, and an already-permanent URL is
 * returned untouched.
 *
 * @param recordingUrl Vapi/Twilio presigned URL (expires ~30 min)
 * @param callId       used as the storage object name
 * @returns permanent public URL, or the original URL if persistence failed
 */
export async function persistRecording(
  recordingUrl: string | null | undefined,
  callId: string,
): Promise<string | null> {
  if (!recordingUrl) return null;
  if (isPermanentRecording(recordingUrl)) return recordingUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn(`[recording] Supabase env missing — keeping ephemeral URL for ${callId}`);
    return recordingUrl;
  }

  const path = storagePathFor(callId);

  try {
    const exists = await storageHasObject(supabaseUrl, serviceKey, path);
    if (exists) {
      console.log(`[recording] Already stored, skipping download for ${callId}`);
      return publicUrlFor(path);
    }

    const buf = await downloadBuffer(recordingUrl);
    if (buf.length < MIN_AUDIO_BYTES) {
      console.warn(
        `[recording] ${callId} downloaded only ${buf.length} bytes — looks like an error page, not audio`,
      );
      return recordingUrl;
    }
    if (buf.length > MAX_BYTES) {
      console.warn(`[recording] ${callId} is ${buf.length} bytes, over the ${MAX_BYTES} cap`);
      return recordingUrl;
    }

    await uploadObject(supabaseUrl, serviceKey, path, buf);
    const url = publicUrlFor(path);
    console.log(`[recording] Persisted ${callId} (${Math.round(buf.length / 1024)} KB) → ${url}`);
    return url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[recording] Failed to persist ${callId} — falling back to Vapi URL: ${msg}`);
    return recordingUrl;
  }
}

async function storageHasObject(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<boolean> {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.storage.from(BUCKET).list(path.split("/")[0], {
    limit: 1000,
  });
  if (error) throw new Error(error.message);
  const name = path.split("/").pop();
  return !!data?.some((f) => f.name === name);
}

async function uploadObject(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
  body: Buffer,
): Promise<void> {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: "audio/wav",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}
