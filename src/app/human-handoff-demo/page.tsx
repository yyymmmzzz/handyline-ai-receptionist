"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { SAMPLE_TRANSCRIPTS, type SampleTranscript, type TranscriptTurn } from "@/lib/sample-transcripts";

interface Minutes {
  summary: string;
  intent: string;
  key_facts: {
    name: string | null;
    phone: string | null;
    address: string | null;
    issue: string | null;
    trade_needed: string;
    timing: string;
    urgency_signals: string;
    budget_signals: string;
  };
  action_items: string[];
  topics_mentioned: string[];
  customer_tendency: string;
  follow_up_priority: "high" | "medium" | "low";
  follow_up_recommendation: string;
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-green-100 text-green-800 border-green-300",
};

const SPEAKER_STYLE: Record<string, string> = {
  "AI Receptionist": "bg-blue-50 text-blue-900 border-blue-200",
  "Customer": "bg-gray-100 text-gray-900 border-gray-300",
  "Alex (contractor)": "bg-green-50 text-green-900 border-green-300",
};

const SPEAKER_LABEL: Record<string, string> = {
  "AI Receptionist": "AI",
  "Customer": "Customer",
  "Alex (contractor)": "Alex",
};

export default function HumanHandoffDemoPage() {
  const [selectedId, setSelectedId] = useState(SAMPLE_TRANSCRIPTS[0].id);
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ tokens: number; cost: number; cached: boolean } | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());

  const selected = useMemo(
    () => SAMPLE_TRANSCRIPTS.find((s) => s.id === selectedId) || SAMPLE_TRANSCRIPTS[0],
    [selectedId]
  );

  const fullTranscript = useMemo(
    () => selected.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n"),
    [selected]
  );

  async function handleSummarize() {
    setLoading(true);
    setError(null);
    setMinutes(null);
    setMeta(null);
    setCheckedItems(new Set());
    try {
      const res = await fetch("/api/human-handoff-demo/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: fullTranscript,
          customerName: selected.customerName,
          callerPhone: selected.callerPhone,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMinutes(data.summary);
      setMeta({ tokens: data.tokens || 0, cost: data.cost || 0, cached: data.cached || false });
    } catch (e: any) {
      setError(e.message || "Failed to generate minutes");
    } finally {
      setLoading(false);
    }
  }

  function toggleCheckItem(i: number) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
              ← Dashboard
            </Link>
            <span className="text-slate-300">|</span>
            <h1 className="text-lg font-semibold text-slate-900">
              Human Handoff + Recording Demo
            </h1>
          </div>
          <div className="text-xs text-slate-500">
            AI generates meeting minutes from call transcript
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Intro */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-blue-900 mb-1">
            What this demonstrates
          </h2>
          <p className="text-sm text-blue-800">
            When a customer asks to talk to a real person, the AI receptionist
            hands off to Alex. The call is recorded, transcribed, and then
            this demo shows the AI-generated <strong>meeting minutes</strong>{" "}
            that Alex would review: summary, customer intent, key facts, action
            items, follow-up priority, and a recommendation.
          </p>
        </div>

        {/* Sample selector */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Pick a sample call
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {SAMPLE_TRANSCRIPTS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedId(s.id);
                  setMinutes(null);
                  setError(null);
                  setMeta(null);
                  setCheckedItems(new Set());
                }}
                className={`text-left p-4 rounded-lg border-2 transition-all ${
                  selectedId === s.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-sm font-medium text-slate-900 mb-1">
                  {s.title}
                </div>
                <div className="text-xs text-slate-500">
                  {s.customerName} · {s.duration}
                </div>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {s.trades.map((t) => (
                    <span
                      key={t}
                      className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Transcript */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Call Transcript
              </h3>
              <button
                onClick={handleSummarize}
                disabled={loading}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {loading ? "Generating…" : "Generate Meeting Minutes"}
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              {/* Call header */}
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {selected.customerName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {selected.callerPhone} · {selected.duration}
                    </div>
                  </div>
                  <div className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700">
                    Recorded call
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Issue: {selected.issue}
                </div>
              </div>

              {/* Transcript turns */}
              <div className="max-h-[640px] overflow-y-auto p-4 space-y-3">
                {selected.turns.map((turn, i) => (
                  <TranscriptBubble key={i} turn={turn} />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Meeting Minutes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                AI-Generated Meeting Minutes
              </h3>
              {meta && (
                <div className="text-xs text-slate-500">
                  {meta.cached && <span className="text-amber-600">cached</span>}
                  {!meta.cached && meta.tokens > 0 && (
                    <span>
                      {meta.tokens} tokens · ${meta.cost.toFixed(5)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {!minutes && !loading && !error && (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                <div className="text-slate-400 text-4xl mb-2">📋</div>
                <p className="text-sm text-slate-600">
                  Click <strong>Generate Meeting Minutes</strong> to see
                  the AI summary.
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Uses OpenAI gpt-4o-mini · results cached for replay
                </p>
              </div>
            )}

            {loading && (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                <div className="inline-block animate-pulse text-slate-400 text-2xl mb-2">⏳</div>
                <p className="text-sm text-slate-600">
                  Generating meeting minutes from transcript…
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-sm font-medium text-red-900 mb-1">
                  Error
                </div>
                <div className="text-xs text-red-700">{error}</div>
              </div>
            )}

            {minutes && <MinutesCard minutes={minutes} checkedItems={checkedItems} onToggleCheck={toggleCheckItem} />}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-500">
          <p>
            Demo for HandyLine AI · Uses Vapi transferCall (planned) + OpenAI
            gpt-4o-mini for meeting minutes generation
          </p>
        </div>
      </main>
    </div>
  );
}

function TranscriptBubble({ turn }: { turn: TranscriptTurn }) {
  return (
    <div className={`flex gap-3 ${turn.speaker === "Customer" ? "" : "flex-row-reverse"}`}>
      <div className="flex-shrink-0 w-16 text-xs text-slate-500 text-right pt-1 font-mono">
        {turn.time}
      </div>
      <div
        className={`flex-1 rounded-lg border p-3 ${SPEAKER_STYLE[turn.speaker] || ""}`}
      >
        <div className="text-xs font-semibold mb-1 opacity-70">
          {SPEAKER_LABEL[turn.speaker] || turn.speaker}
        </div>
        <div className="text-sm">{turn.text}</div>
      </div>
    </div>
  );
}

function MinutesCard({
  minutes,
  checkedItems,
  onToggleCheck,
}: {
  minutes: Minutes;
  checkedItems: Set<number>;
  onToggleCheck: (i: number) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
          Summary
        </div>
        <div className="text-sm text-slate-900">{minutes.summary}</div>
      </div>

      {/* Intent + Priority */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
            Customer Intent
          </div>
          <div className="text-sm text-slate-900">{minutes.intent}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
            Follow-up Priority
          </div>
          <span
            className={`inline-block text-sm font-medium px-2 py-1 rounded border ${
              PRIORITY_STYLE[minutes.follow_up_priority] || ""
            }`}
          >
            {minutes.follow_up_priority.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Key facts */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
          Key Facts
        </div>
        <div className="space-y-1.5 text-sm">
          <FactRow label="Name" value={minutes.key_facts.name} />
          <FactRow label="Phone" value={minutes.key_facts.phone} />
          <FactRow label="Address" value={minutes.key_facts.address} />
          <FactRow label="Issue" value={minutes.key_facts.issue} />
          <FactRow label="Trade" value={minutes.key_facts.trade_needed} />
          <FactRow label="Timing" value={minutes.key_facts.timing} />
          <FactRow
            label="Urgency"
            value={minutes.key_facts.urgency_signals}
            highlight
          />
          <FactRow label="Budget" value={minutes.key_facts.budget_signals} />
        </div>
      </div>

      {/* Action items (checkable) */}
      {minutes.action_items && minutes.action_items.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
            Action Items
          </div>
          <div className="space-y-2">
            {minutes.action_items.map((item, i) => (
              <label
                key={i}
                className="flex items-start gap-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 py-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={checkedItems.has(i)}
                  onChange={() => onToggleCheck(i)}
                  className="mt-1"
                />
                <span
                  className={`text-sm ${
                    checkedItems.has(i) ? "line-through text-slate-400" : "text-slate-900"
                  }`}
                >
                  {item}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Topics */}
      {minutes.topics_mentioned && minutes.topics_mentioned.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
            Topics
          </div>
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

      {/* Tendency */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
          Customer Tendency
        </div>
        <div className="text-sm text-slate-900">{minutes.customer_tendency}</div>
      </div>

      {/* Recommendation */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-xs font-semibold text-amber-700 uppercase mb-1">
          💡 Follow-up Recommendation
        </div>
        <div className="text-sm text-amber-900">
          {minutes.follow_up_recommendation}
        </div>
      </div>
    </div>
  );
}

function FactRow({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <div className="text-xs text-slate-500 w-20 flex-shrink-0 pt-0.5">
        {label}
      </div>
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
