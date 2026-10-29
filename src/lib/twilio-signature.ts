import crypto from "crypto";
import type { NextRequest } from "next/server";

/**
 * Twilio request signature validation.
 *
 * WHY THIS EXISTS (2026-10-29)
 * -----------------------------
 * Every Twilio-facing webhook in this app was reachable by anyone who knew
 * the URL. That is not a theoretical problem here:
 *
 *   - /api/human-line/voice DIALS ALEX'S PHONE. Anyone could make his
 *     phone ring, repeatedly, at our expense.
 *   - /api/human-line/recording fetches whatever URL it is handed, so it
 *     was an SSRF hole, and it created work orders — fake leads in Alex's
 *     queue.
 *   - /api/twilio/emergency-decision flips a work order's status.
 *
 * Twilio signs every request it makes with the account auth token
 * (X-Twilio-Signature). Verifying that signature is what makes a public
 * URL safe.
 *
 * The algorithm (per Twilio docs):
 *   1. Take the full webhook URL, exactly as Twilio requested it.
 *   2. Sort the POST parameters alphabetically by name. For repeated
 *      parameters, append the value once per occurrence.
 *   3. Concatenate: url + name1 + value1 + name2 + value2 ...
 *   4. HMAC-SHA1 with the auth token, base64 encoded.
 *   5. Compare (constant time) with the X-Twilio-Signature header.
 */

/**
 * Collect form fields, preserving repeated keys as arrays.
 *
 * Twilio's signature covers EVERY occurrence of a repeated parameter, so the
 * signature check cannot use the "last value wins" map the business logic
 * uses.
 */
export function collectFormParams(form: FormData | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!form) return out;
  for (const [key, value] of form.entries()) {
    const v = typeof value === "string" ? value : "";
    if (key in out) {
      const cur = out[key];
      out[key] = Array.isArray(cur) ? [...cur, v] : [cur as string, v];
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Rebuild the URL Twilio signed. */
export function reconstructWebhookUrl(req: NextRequest): string {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "https") ||
    "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host ||
    "";
  const path = req.nextUrl.pathname || "";
  const search = req.nextUrl.search || "";
  return `${proto}://${host}${path}${search}`;
}

/** Compute the expected X-Twilio-Signature for a URL + form params. */
export function computeTwilioSignature(
  url: string,
  params: Record<string, string | string[]>,
  authToken: string,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const value = params[key];
      if (Array.isArray(value)) {
        return acc + value.map((v) => `${key}${v}`).join("");
      }
      return acc + `${key}${value}`;
    }, url);

  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "no_token" | "no_signature" | "mismatch" };

/**
 * Verify the X-Twilio-Signature header of an incoming request.
 *
 * Fails CLOSED: if TWILIO_AUTH_TOKEN is not configured, the request is
 * rejected. A webhook that accepts anything is worse than one that is
 * offline.
 */
export function verifyTwilioSignature(
  req: NextRequest,
  params: Record<string, string | string[]>,
  authToken: string | undefined = process.env.TWILIO_AUTH_TOKEN,
): SignatureCheck {
  if (!authToken) return { ok: false, reason: "no_token" };

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return { ok: false, reason: "no_signature" };

  const url = reconstructWebhookUrl(req);
  const expected = computeTwilioSignature(url, params, authToken);

  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(signature, "utf-8");
  if (a.length !== b.length) return { ok: false, reason: "mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };

  return { ok: true };
}

/** Convenience wrapper that returns a 403 NextResponse on failure. */
export function rejectInvalidSignature(check: SignatureCheck): Response | null {
  if (check.ok) return null;
  console.warn(
    `[twilio-signature] rejected request: ${
      check.reason === "no_token"
        ? "TWILIO_AUTH_TOKEN is not configured on this deployment"
        : check.reason === "no_signature"
          ? "X-Twilio-Signature header missing"
          : "signature mismatch"
    }`,
  );
  return new Response(
    JSON.stringify({ error: "invalid_twilio_signature", reason: check.reason }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}
