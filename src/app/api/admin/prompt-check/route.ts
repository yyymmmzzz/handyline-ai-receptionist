/**
 * /api/admin/prompt-check — run one chat completion against the live model.
 *
 * Why this exists: prompt regressions shipped unnoticed because
 * scripts/test-conversations.js needs a reachable api.openai.com, and the
 * office machine frequently cannot reach it. This route runs the SAME request
 * from the deployed app (where OpenAI IS reachable), so the conversation test
 * suite can exercise the prompt that is actually live on Vapi.
 *
 * It is a thin, guarded pass-through — it does not interpret the prompt.
 * The caller sends the OpenAI request body and gets the OpenAI response.
 *
 * Auth: x-admin-token header matching WEBHOOK_SECRET (same convention as
 * /api/admin/llm-stats).
 *
 * Deliberate limits, because this endpoint can burn money:
 *   - model allowlist (no arbitrary models)
 *   - max_tokens capped
 *   - message count and input size capped
 *   - no key is ever returned to the caller
 *
 * Usage is NOT written to llm_usage: this is a test tool, not a business call,
 * and mixing the two would corrupt the cost report.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_MODELS = new Set(["gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4o"]);
const MAX_TOKENS = 500;
const MAX_MESSAGES = 40;
const MAX_INPUT_CHARS = 200_000;
const MAX_TOOLS = 6;

type ChatMessage = { role?: string; content?: unknown; [k: string]: unknown };

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || req.headers.get("x-webhook-secret");
  if (!process.env.WEBHOOK_SECRET || token !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "openai_not_configured" }, { status: 503 });
  }

  let body: {
    model?: string;
    messages?: ChatMessage[];
    tools?: unknown[];
    temperature?: number;
    max_tokens?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const model = body.model ?? "gpt-4o-mini";
  if (!ALLOWED_MODELS.has(model)) {
    return NextResponse.json(
      { error: "model_not_allowed", allowed: [...ALLOWED_MODELS] },
      { status: 400 },
    );
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "invalid_messages" }, { status: 400 });
  }

  const inputChars = messages.reduce(
    (n, m) => n + (typeof m.content === "string" ? m.content.length : 0),
    0,
  );
  if (inputChars > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: "input_too_large" }, { status: 413 });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
    max_tokens: Math.min(typeof body.max_tokens === "number" ? body.max_tokens : 150, MAX_TOKENS),
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    payload.tools = body.tools.slice(0, MAX_TOOLS);
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "upstream_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
