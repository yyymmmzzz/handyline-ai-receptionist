"use client";

/**
 * /human-calls — the real view of the human-answering line.
 *
 * This page used to be `/human-handoff-demo`: a standalone showcase fed by
 * hard-coded sample transcripts, living outside the product. It is now the
 * operational view for the Twilio direct line:
 *
 *   - every call a person actually answered, newest first
 *   - the recording, playable in place (the audio is copied into our own
 *     storage first, so the link does not expire)
 *   - the transcript
 *   - the AI meeting minutes: key facts, action items, follow-up priority and
 *     the recommended next step
 *
 * The demo page is kept as a redirect to here, so old links still land
 * somewhere useful.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import { formatDateTime, relativeTime } from "@/lib/utils";
import type { WorkOrder, MeetingMinutes } from "@/lib/types";

type Filter = "all" | "recording" | "minutes" | "callback";

interface LineStatus {
  ok: boolean;
  error?: string;
  twilio: {
    reachable: boolean;
    type: string | null;
    status: string | null;
    trial: boolean;
    ownedNumbers: string[];
  };
  lines: Array<{
    companyName: string;
    country: string | null;
    enabled: boolean;
    number: string | null;
    answerPhone: string | null;
    ringSeconds: number | null;
    fallback: string | null;
    ownedByTwilio: boolean;
    live: boolean;
  }>;
  anyLive: boolean;
  counts: {
    humanCalls: number;
    withRecording: number;
    withMinutes: number;
    answered: number;
  };
  headline: string;
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-green-100 text-green-800 border-green-300",
};

export default function HumanCallsPage() {
  const [calls, setCalls] = useState<WorkOrder[]>([]);
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // The calls themselves come straight from Supabase (same path the main
  // dashboard uses), so this page stays in sync without its own API.
  useEffect(() => {
    const supabase = getBrowserClient();
    supabase
      .from("work_orders")
      .select("*")
      .eq("call_type", "human")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) console.error("[human-calls] load failed:", error);
        setCalls((data || []) as WorkOrder[]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch("/api/human-line/status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch((e) => console.error("[human-calls] status failed:", e))
      .finally(() => setStatusLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filter === "recording") return calls.filter((c) => !!c.recording_url);
    if (filter === "minutes") return calls.filter((c) => !!c.human_minutes);
    if (filter === "callback") {
      return calls.filter((c) => c.status === "callback" || c.status === "pending");
    }
    return calls;
  }, [calls, filter]);

  const stats = {
    total: calls.length,
    withRecording: calls.filter((c) => !!c.recording_url).length,
    withMinutes: calls.filter((c) => !!c.human_minutes).length,
    callback: calls.filter((c) => c.status === "callback" || c.status === "pending").length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
              ← Dashboard
            </Link>
            <span className="text-slate-300">|</span>
            <h1 className="text-lg font-semibold text-slate-900">Human Calls</h1>
          </div>
          <div className="text-xs text-slate-500">
            {calls.length > 0 && `${calls.length} human call${calls.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Line status — say plainly whether the line can take a call yet */}
        <StatusBanner status={status} loading={statusLoading} />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Human calls" value={stats.total} />
          <StatCard label="With recording" value={stats.withRecording} accent="blue" />
          <StatCard label="With AI minutes" value={stats.withMinutes} accent="purple" />
          <StatCard label="Needs action" value={stats.callback} accent="amber" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wide">Filter:</span>
          {([
            { key: "all", label: "All" },
            { key: "recording", label: "🎧 With recording" },
            { key: "minutes", label: "📋 With minutes" },
            { key: "callback", label: "⏳ Needs action" },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-md border font-medium ${
                filter === f.key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Calls */}
        {loading ? (
          <div className="text-center text-sm text-slate-500 py-12">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={calls.length > 0} />
        ) : (
          <div className="space-y-3">
            {filtered.map((call) => (
              <CallCard
                key={call.id}
                call={call}
                open={openId === call.id}
                onToggle={() => setOpenId(openId === call.id ? null : call.id)}
                checked={checked}
                onCheck={(key, value) => setChecked((prev) => ({ ...prev, [key]: value }))}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBanner({ status, loading }: { status: LineStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-500">
        Checking line status…
      </div>
    );
  }
  if (!status || !status.ok) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
        Could not read the human line status. {status?.error ? `(${status.error})` : ""}
      </div>
    );
  }

  const tone = status.anyLive
    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
    : "bg-amber-50 border-amber-200 text-amber-900";

  return (
    <div className={`border rounded-lg p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-semibold">{status.headline}</div>
          <div className="text-xs mt-1 opacity-80">
            {status.twilio.trial &&
              "Twilio is still a trial account (no outbound calls or SMS, and the trial has expired)."}
            {status.twilio.ownedNumbers.length > 0
              ? ` Numbers owned by Twilio: ${status.twilio.ownedNumbers.join(", ")}.`
              : " Twilio does not own any phone numbers yet."}
          </div>
        </div>
        <div className="text-xs space-y-1">
          {status.lines.map((l) => (
            <div key={l.companyName} className="flex items-center gap-2">
              <span className="font-medium">{l.companyName}</span>
              <span
                className={`px-1.5 py-0.5 rounded border ${
                  l.live
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : "bg-white text-slate-600 border-slate-300"
                }`}
              >
                {l.live ? "Live" : l.enabled ? "No number yet" : "Disabled"}
              </span>
              <span className="opacity-70">
                {l.number || "no number"} → rings {l.answerPhone || "not set"}{" "}
                {l.ringSeconds ? `(${l.ringSeconds}s)` : ""}
                {l.fallback ? ` · no answer → ${l.fallback}` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  if (hasAny) {
    return (
      <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-10 text-center">
        <div className="text-slate-300 text-3xl mb-2">🔎</div>
        <p className="text-sm text-slate-600">No human calls match this filter.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-10 text-center">
      <div className="text-slate-300 text-3xl mb-2">📞</div>
      <p className="text-sm font-medium text-slate-700 mb-1">No human calls yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        The human line (a separate Twilio number) is not live yet. Once the number is
        bought and wired up, every call that reaches Alex shows up here — recording,
        transcript and AI minutes included.
      </p>
    </div>
  );
}

function CallCard({
  call,
  open,
  onToggle,
  checked,
  onCheck,
}: {
  call: WorkOrder;
  open: boolean;
  onToggle: () => void;
  checked: Record<string, boolean>;
  onCheck: (key: string, value: boolean) => void;
}) {
  const minutes = call.human_minutes || null;
  const priority = minutes?.follow_up_priority || call.follow_up_priority || null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900">
              {call.customer_name_extracted || call.customer_name || "Unknown caller"}
            </span>
            <span className="text-xs text-slate-500 font-mono">{call.customer_phone}</span>
            {priority && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${
                  PRIORITY_STYLE[priority] || "bg-slate-100 text-slate-700 border-slate-300"
                }`}
              >
                {String(priority).toUpperCase()}
              </span>
            )}
            {call.human_answered === false && (
              <span className="text-xs px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300">
                No answer
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1 truncate">
            {minutes?.summary || call.summary || call.intent_summary || "(no summary)"}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {formatDateTime(call.created_at)} · {relativeTime(call.created_at)}
            {call.line_label ? ` · ${call.line_label}` : ""}
            {call.recording_url ? " · 🎧 recording" : " · no recording"}
            {minutes ? " · 📋 AI minutes" : " · no AI minutes"}
          </div>
        </div>
        <span className="text-slate-400 text-sm shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4 space-y-4 bg-slate-50/40">
          {/* Recording */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Recording</div>
            {call.recording_url ? (
              <audio controls src={call.recording_url} className="w-full" />
            ) : (
              <div className="text-sm text-slate-400">No recording file for this call.</div>
            )}
          </div>

          {/* AI minutes */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1">AI minutes</div>
            {minutes ? (
              <MinutesCard
                minutes={minutes}
                callId={call.id}
                checked={checked}
                onCheck={onCheck}
              />
            ) : (
              <div className="text-sm text-slate-400">
                No AI minutes were generated for this call
                {call.human_minutes_source === "none" && " (generation failed or there was no transcript)"}.
              </div>
            )}
          </div>

          {/* Transcript */}
          {call.transcript && call.transcript.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
                Transcript
                <span className="ml-2 font-normal normal-case text-slate-400">
                  (speech-to-text does not separate speakers)
                </span>
              </div>
              <div className="bg-white border border-slate-200 rounded-md p-3 text-sm text-slate-800 max-h-72 overflow-y-auto whitespace-pre-wrap">
                {call.transcript.map((t, i) => (
                  <p key={i} className="mb-2 last:mb-0">
                    {t.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs">
            <Link
              href={`/orders/${call.id}`}
              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              Open work order →
            </Link>
            {call.customer_phone && (
              <a
                href={`tel:${call.customer_phone}`}
                className="px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              >
                Call back {call.customer_phone}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MinutesCard({
  minutes,
  callId,
  checked,
  onCheck,
}: {
  minutes: MeetingMinutes;
  callId: string;
  checked: Record<string, boolean>;
  onCheck: (key: string, value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Summary</div>
        <div className="text-sm text-slate-900">{minutes.summary || "—"}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Customer intent</div>
          <div className="text-sm text-slate-900">{minutes.intent || "—"}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Follow-up priority</div>
          <span
            className={`inline-block text-sm font-medium px-2 py-1 rounded border ${
              PRIORITY_STYLE[minutes.follow_up_priority] || ""
            }`}
          >
            {minutes.follow_up_priority.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Key facts</div>
        <div className="space-y-1.5 text-sm">
          <FactRow label="Name" value={minutes.key_facts.name} />
          <FactRow label="Phone" value={minutes.key_facts.phone} />
          <FactRow label="Address" value={minutes.key_facts.address} />
          <FactRow label="Issue" value={minutes.key_facts.issue} />
          <FactRow label="Trade" value={minutes.key_facts.trade_needed} />
          <FactRow label="Timing" value={minutes.key_facts.timing} />
          <FactRow label="Urgency" value={minutes.key_facts.urgency_signals} highlight />
          <FactRow label="Budget" value={minutes.key_facts.budget_signals} />
        </div>
      </div>

      {minutes.action_items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Action items</div>
          <div className="space-y-2">
            {minutes.action_items.map((item, i) => {
              const key = `${callId}:${i}`;
              return (
                <label
                  key={key}
                  className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 py-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={!!checked[key]}
                    onChange={(e) => onCheck(key, e.target.checked)}
                    className="mt-1"
                  />
                  <span
                    className={`text-sm ${
                      checked[key] ? "line-through text-slate-400" : "text-slate-900"
                    }`}
                  >
                    {item}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {minutes.topics_mentioned.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Topics</div>
          <div className="flex flex-wrap gap-1.5">
            {minutes.topics_mentioned.map((t, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Customer tendency</div>
        <div className="text-sm text-slate-900">{minutes.customer_tendency || "—"}</div>
      </div>

      {minutes.follow_up_recommendation && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-700 uppercase mb-1">
            💡 Recommended next step
          </div>
          <div className="text-sm text-amber-900">{minutes.follow_up_recommendation}</div>
        </div>
      )}
    </div>
  );
}

function FactRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <div className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">{label}</div>
      <div
        className={`flex-1 text-sm ${
          value
            ? highlight
              ? "text-red-700 font-medium"
              : "text-slate-900"
            : "text-slate-400 italic"
        }`}
      >
        {value || "not mentioned"}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "blue" | "amber" | "purple";
}) {
  const color =
    accent === "red"
      ? "text-red-600"
      : accent === "blue"
        ? "text-blue-600"
        : accent === "amber"
          ? "text-amber-600"
          : accent === "purple"
            ? "text-purple-600"
            : "text-slate-900";
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
