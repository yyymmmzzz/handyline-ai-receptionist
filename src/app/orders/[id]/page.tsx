"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import { decisionLabel, decisionColor, statusLabel, statusColor, formatDateTime, cn, aiQualityLabel, notificationErrorLabel } from "@/lib/utils";
import type { WorkOrder, Boss, PricingBreakdown, NotificationRecord } from "@/lib/types";

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [boss, setBoss] = useState<Boss | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  // Which action items from the AI meeting minutes the operator has ticked off.
  // Local only — these are working notes, not order state.
  const [doneActions, setDoneActions] = useState<Record<string, boolean>>({});
  // Every attempt to notify the boss about THIS job, newest first.
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  useEffect(() => {
    const supabase = getBrowserClient();

    // Set up realtime subscription synchronously, BEFORE the async fetch.
    // This avoids the "cannot add postgres_changes after subscribe()" error
    // that happens in React strict mode when the channel is set up inside
    // an async function (the second effect run would try to .on() an
    // already-subscribed channel).
    const channelName = `work_order_${id}_${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "work_orders", filter: `id=eq.${id}` },
        (payload) => setOrder(payload.new as WorkOrder),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;

    (async () => {
      const [{ data: orderData, error: orderErr }, { data: bossData }] = await Promise.all([
        supabase.from("work_orders").select("*").eq("id", id).single(),
        supabase.from("bosses").select("*").limit(1).single(),
      ]);

      if (cancelled) return;

      if (orderErr || !orderData) {
        console.error("[detail] Failed to load:", orderErr);
        setLoading(false);
        return;
      }

      setOrder(orderData as WorkOrder);
      setBoss((bossData as Boss) || null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Delivery log for this job. If the boss was never told about it, that has
  // to be visible here — not just in a log table.
  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;
    supabase
      .from("notifications")
      .select("id, work_order_id, channel, recipient, message, status, error, created_at")
      .eq("work_order_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[detail] Failed to load notifications:", error);
          return;
        }
        setNotifications((data || []) as NotificationRecord[]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleCallback() {
    if (!order) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/boss/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: order.id }),
      });
      if (!res.ok) throw new Error("Callback failed");
      const data = await res.json();
      alert(`Callback initiated. ${data.ok ? "SMS sent to boss." : ""}`);
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatusChange(status: "confirmed" | "rejected" | "completed" | "cancelled") {
    if (!order) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/boss/callback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: order.id, status }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 text-center text-gray-400">
        Loading...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Not found</h1>
        <Link href="/" className="text-sm text-orange-600 hover:text-orange-700 mt-2 inline-block">
          ← Back to work orders
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to work orders
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded border ${decisionColor(order.ai_decision)}`}>
              {decisionLabel(order.ai_decision)}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs rounded ${statusColor(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            {order.issue_type && (
              <span className="text-xs text-gray-500 capitalize">· {order.issue_type}</span>
            )}
          </div>
          {order.ai_quality_flag && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <span className="font-semibold">AI misbehaved on this call:</span>{" "}
              {aiQualityLabel(order.ai_quality_flag)}. Listen to the recording before trusting this one.
            </div>
          )}
          {notifications[0]?.status === "failed" && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
              <span className="font-semibold">The boss was never notified about this job.</span>{" "}
              {notificationErrorLabel(notifications[0].error)} — last attempt{" "}
              {formatDateTime(notifications[0].created_at)}.
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">
            {order.summary || "Work order"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateTime(order.created_at)}
          </p>
        </div>
      </div>

      {/* Action bar */}
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCallback}
            disabled={actionLoading || order.status === "completed"}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📞 Call back {order.customer_phone}
          </button>
          {order.status === "pending" && (
            <>
              <button
                onClick={() => handleStatusChange("confirmed")}
                disabled={actionLoading}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Confirm job
              </button>
              <button
                onClick={() => handleStatusChange("rejected")}
                disabled={actionLoading}
                className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                ✕ Can't take it
              </button>
            </>
          )}
          {order.status === "confirmed" && (
            <button
              onClick={() => handleStatusChange("completed")}
              disabled={actionLoading}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              ✓ Mark completed
            </button>
          )}
        </div>
      </div>

      {/* Customer info */}
      <Section title="Customer">
        <Field label="Name (caller ID)" value={order.customer_name || "—"} />
        {(order as any).customer_name_extracted && (order as any).customer_name_extracted !== order.customer_name && (
          <Field
            label="Name (from call)"
            value={(order as any).customer_name_extracted}
            highlight
          />
        )}
        <Field label="Phone" value={order.customer_phone} />
        <Field label="Address" value={order.customer_address || "—"} />
        <Field label="Zip code" value={order.customer_zipcode || "—"} />
      </Section>

      {/* Customer intent + follow-up */}
      {((order as any).intent_summary || (order as any).customer_tendency || (order as any).mentioned_topics?.length > 0 || (order as any).follow_up_recommended) && (
        <Section
          title={
            <span className="flex items-center gap-2">
              📋 Customer intent
              {(order as any).follow_up_priority === "high" && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800 border border-red-200">
                  🔥 High follow-up
                </span>
              )}
              {(order as any).follow_up_priority === "medium" && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
                  ⚠️ Medium follow-up
                </span>
              )}
            </span>
          }
        >
          {(order as any).intent_summary && (
            <Field
              label="What they said"
              value={(order as any).intent_summary}
              multiline
            />
          )}
          {(order as any).customer_tendency && (
            <Field
              label="Tendency"
              value={
                <TendencyBadge tendency={(order as any).customer_tendency} />
              }
            />
          )}
          {/* Accepted vs rejected topics — shows the full conversation story
              for multi-issue calls (e.g. Matt: roofing→rejected, hvac→accepted) */}
          {((order as any).accepted_topics?.length > 0 || (order as any).rejected_topics?.length > 0) && (
            <div className="py-2 space-y-2">
              {(order as any).accepted_topics?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1.5">✓ AI said YES to</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(order as any).accepted_topics.map((t: string) => (
                      <span
                        key={t}
                        className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-green-100 text-green-800 border border-green-200"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(order as any).rejected_topics?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1.5">✗ AI said NO to</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(order as any).rejected_topics.map((t: string) => (
                      <span
                        key={t}
                        className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-red-100 text-red-800 border border-red-200"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {(order as any).mentioned_topics && (order as any).mentioned_topics.length > 0 && (
            <div className="py-2">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1.5">All topics mentioned</div>
              <div className="flex flex-wrap gap-1.5">
                {(order as any).mentioned_topics.map((t: string) => (
                  <span
                    key={t}
                    className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-gray-100 text-gray-800 border border-gray-200"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(order as any).transcript_coherence && (
            <Field
              label="Transcript coherence"
              value={
                <CoherenceBadge coherence={(order as any).transcript_coherence} />
              }
            />
          )}
          {(order as any).follow_up_notes && (
            <Field
              label="Why follow up"
              value={(order as any).follow_up_notes}
              multiline
              highlight={(order as any).follow_up_priority === "high"}
            />
          )}
        </Section>
      )}

      {/* AI meeting minutes — the notes a person would have taken after a
          human-answered call (key facts, action items, next step). */}
      {order.human_minutes && (
        <Section
          title={
            <span className="flex items-center gap-2">
              📝 AI meeting minutes
              <span className="text-xs font-normal text-gray-500">
                (human line · {order.human_minutes_source === "llm" ? "generated by AI" : order.human_minutes_source})
              </span>
            </span>
          }
        >
          {order.human_minutes.summary && (
            <Field label="Summary" value={order.human_minutes.summary} multiline />
          )}
          {order.human_minutes.intent && (
            <Field label="Intent" value={order.human_minutes.intent} multiline />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 py-2">
            <Field label="Name" value={order.human_minutes.key_facts.name || "—"} />
            <Field label="Phone" value={order.human_minutes.key_facts.phone || "—"} />
            <Field label="Address" value={order.human_minutes.key_facts.address || "—"} />
            <Field label="Trade" value={order.human_minutes.key_facts.trade_needed || "—"} />
            <Field label="Timing" value={order.human_minutes.key_facts.timing || "—"} />
            <Field
              label="Urgency"
              value={order.human_minutes.key_facts.urgency_signals || "—"}
              highlight={!!order.human_minutes.key_facts.urgency_signals}
            />
            <Field label="Budget" value={order.human_minutes.key_facts.budget_signals || "—"} />
            <Field label="Tendency" value={order.human_minutes.customer_tendency || "—"} />
          </div>
          {order.human_minutes.action_items.length > 0 && (
            <div className="py-2">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1.5">Action items</div>
              <div className="space-y-1.5">
                {order.human_minutes.action_items.map((item, i) => {
                  const key = `${order.id}:${i}`;
                  return (
                    <label
                      key={key}
                      className="flex items-start gap-2 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={!!doneActions[key]}
                        onChange={(e) =>
                          setDoneActions((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        className="mt-0.5"
                      />
                      <span
                        className={cn(
                          "text-sm",
                          doneActions[key] ? "line-through text-gray-400" : "text-gray-900",
                        )}
                      >
                        {item}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {order.human_minutes.follow_up_recommendation && (
            <div className="py-2">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1.5">
                💡 Recommended next step
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
                {order.human_minutes.follow_up_recommendation}
              </div>
            </div>
          )}
          <div className="pt-2">
            <Link
              href="/human-calls"
              className="text-xs text-blue-600 hover:text-blue-700 underline"
            >
              View all human calls →
            </Link>
          </div>
        </Section>
      )}

      {/* Job details */}
      <Section title="Job details">
        <Field label="Issue type" value={order.issue_type || "—"} />
        <Field label="Details" value={order.issue_details || "—"} multiline />
        <Field label="Preferred time" value={order.preferred_time || "—"} />
        {order.ai_decision_reason && (
          <Field label="AI decision reason" value={order.ai_decision_reason} />
        )}
      </Section>

      {/* Pricing breakdown */}
      {order.pricing_breakdown && <PricingSection pb={order.pricing_breakdown} />}
      {!order.pricing_breakdown && order.quote_low && order.quote_high && (
        <Section title="Pricing">
          <Field
            label="Reference range"
            value={`$${order.quote_low}–$${order.quote_high}`}
          />
          {boss && (
            <Field
              label="Trip fee"
              value={`$${boss.diagnostic_fee} (goes toward repair if you proceed)`}
            />
          )}
        </Section>
      )}

      {/* Call artifacts */}
      {(order.transcript || order.recording_url) && (
        <Section title="Call">
          {order.recording_url && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Recording</div>
              <audio controls src={order.recording_url} className="w-full" />
            </div>
          )}
          {order.transcript && order.transcript.length > 0 && (() => {
            // Find any assistant turn that mentions a price ($NNN or $NN to $NN, etc.)
            const pricingLines = order.transcript
              .map((t, i) => ({ ...t, idx: i }))
              .filter((t) => t.role === "assistant" && /\$\d/.test(t.text));
            return (
              <>
                {pricingLines.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-gray-500 uppercase mb-2">Pricing discussion</div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2">
                      {pricingLines.map((t) => (
                        <div key={t.idx} className="flex items-start gap-2 text-sm text-emerald-900">
                          <span className="text-emerald-600 font-bold">$</span>
                          <span>{t.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-2">Full transcript</div>
                  <div className="bg-gray-50 rounded-md p-3 space-y-2 max-h-96 overflow-y-auto">
                    {order.transcript.map((t, i) => {
                      const isPricingLine = t.role === "assistant" && /\$\d/.test(t.text);
                      return (
                        <div key={i} className={cn("flex gap-2 text-sm", t.role === "assistant" ? "" : "flex-row-reverse")}>
                          <div
                            className={cn(
                              "inline-block px-3 py-1.5 rounded-lg max-w-[80%]",
                              isPricingLine
                                ? "bg-emerald-100 border border-emerald-300 text-emerald-900"
                                : t.role === "assistant"
                                  ? "bg-white border border-gray-200"
                                  : "bg-orange-100 text-orange-900",
                            )}
                          >
                            {isPricingLine && <span className="font-bold mr-1">$</span>}
                            {t.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}
        </Section>
      )}

      {/* Notification delivery — did the boss actually get told? */}
      {notifications.length > 0 && (
        <Section title="Notifications">
          {notifications.map((n, i) => {
            const failed = n.status === "failed";
            return (
              <div
                key={n.id || `${n.created_at}-${i}`}
                className={cn(
                  "rounded-md border px-3 py-2",
                  failed ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      failed ? "text-red-800" : "text-emerald-800",
                    )}
                  >
                    {failed ? "🔕 Not delivered" : "✅ Delivered"} · {n.channel}
                  </span>
                  <span className="text-xs text-gray-500">{formatDateTime(n.created_at)}</span>
                </div>
                {n.recipient && (
                  <div className="text-xs text-gray-600 mt-0.5">to {n.recipient}</div>
                )}
                {failed && n.error && (
                  <div className="text-xs text-red-700 mt-1">
                    {notificationErrorLabel(n.error)}
                    {n.error !== notificationErrorLabel(n.error) && (
                      <span className="text-red-500"> ({n.error})</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {/* Data source + Vapi call id (debug) */}
      <div className="mt-6 flex items-center gap-3 text-xs text-gray-400 font-mono flex-wrap">
        {order.data_source && (
          <span
            className={`px-2 py-0.5 rounded border ${
              order.data_source === "production"
                ? "bg-green-50 text-green-700 border-green-200"
                : order.data_source === "demo"
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            data_source: {order.data_source}
          </span>
        )}
        {order.vapi_call_id && <span>vapi_call: {order.vapi_call_id}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, multiline, highlight }: { label: string; value: React.ReactNode; multiline?: boolean; highlight?: boolean }) {
  return (
    <div className={highlight ? "bg-amber-50 border border-amber-200 rounded-md p-2 -mx-2" : ""}>
      <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
      <div className={cn("text-sm text-gray-900 mt-0.5", multiline && "whitespace-pre-wrap")}>{value}</div>
    </div>
  );
}

function TendencyBadge({ tendency }: { tendency: string }) {
  const map: Record<string, { label: string; emoji: string; classes: string }> = {
    scheduling: { label: "Scheduling", emoji: "📅", classes: "bg-blue-100 text-blue-800 border-blue-200" },
    service_inquiry: { label: "Service inquiry", emoji: "❓", classes: "bg-purple-100 text-purple-800 border-purple-200" },
    price_shopping: { label: "Price shopping", emoji: "🛒", classes: "bg-amber-100 text-amber-800 border-amber-200" },
    considering: { label: "Considering", emoji: "🤔", classes: "bg-slate-100 text-slate-800 border-slate-200" },
    complaint: { label: "Complaint", emoji: "😠", classes: "bg-red-100 text-red-800 border-red-200" },
    urgent: { label: "Urgent", emoji: "🚨", classes: "bg-red-100 text-red-800 border-red-200" },
    uncertain: { label: "Uncertain", emoji: "❔", classes: "bg-gray-100 text-gray-800 border-gray-200" },
    info_general: { label: "General info", emoji: "💬", classes: "bg-gray-100 text-gray-800 border-gray-200" },
  };
  // The human line writes free-text tendencies ("urgent and ready to book").
  // Falling back to "Uncertain" for those would state the opposite of what
  // the model said — show the raw words instead of mislabelling them.
  const m =
    map[tendency] ??
    { label: tendency, emoji: "🏷️", classes: "bg-slate-100 text-slate-800 border-slate-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border ${m.classes}`}>
      <span>{m.emoji}</span>
      <span>{m.label}</span>
    </span>
  );
}

function CoherenceBadge({ coherence }: { coherence: string }) {
  const map: Record<string, { label: string; emoji: string; classes: string }> = {
    high: { label: "High — clear conversation", emoji: "✅", classes: "bg-green-100 text-green-800 border-green-200" },
    medium: { label: "Medium", emoji: "🟡", classes: "bg-amber-100 text-amber-800 border-amber-200" },
    low: { label: "Low — likely wrong number / STT failed", emoji: "⚠️", classes: "bg-red-100 text-red-800 border-red-200" },
  };
  const m = map[coherence] || map.medium;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border ${m.classes}`}>
      <span>{m.emoji}</span>
      <span>{m.label}</span>
    </span>
  );
}

function PricingSection({ pb }: { pb: PricingBreakdown }) {
  const hasSurcharge = pb.fuel_surcharge > 0;
  const totalTrip = pb.trip_fee + pb.fuel_surcharge;
  return (
    <Section title="Pricing">
      <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-md p-3 mb-2">
        <div className="text-xs font-medium text-emerald-700 uppercase mb-1">Total estimate</div>
        <div className="text-2xl font-semibold text-emerald-900">
          ${pb.total_low}–${pb.total_high}
        </div>
        <div className="text-xs text-emerald-700 mt-1">
          Repair ${pb.range_low}–${pb.range_high} + ${totalTrip} trip
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-700">Trip fee (base)</span>
          <span className="font-medium text-gray-900">${pb.trip_fee}</span>
        </div>
        {hasSurcharge && (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-amber-700 flex items-center gap-1">
              <span>⛽</span>
              <span>Fuel surcharge ({Math.max(0, (pb.distance_miles ?? 0) - pb.free_distance_miles)} mi over {pb.free_distance_miles})</span>
            </span>
            <span className="font-medium text-amber-700">+${pb.fuel_surcharge}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between text-sm border-t border-gray-200 pt-2">
          <span className="text-gray-700 font-medium">Total trip cost</span>
          <span className="font-semibold text-gray-900">${totalTrip}</span>
        </div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-700">Estimated repair range</span>
          <span className="font-medium text-gray-900">${pb.range_low}–${pb.range_high}</span>
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
        Trip fee goes toward the repair if you proceed. Final price depends on what's found on site.
      </div>

      {pb.distance_miles != null && (
        <div className="text-xs text-gray-500">
          Customer is {pb.distance_miles} miles from base
          {hasSurcharge && ` (${pb.surcharge_per_mile}/mi beyond ${pb.free_distance_miles} mi)`}
        </div>
      )}
    </Section>
  );
}
