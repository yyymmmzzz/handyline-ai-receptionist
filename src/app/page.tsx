"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import { decisionLabel, decisionColor, statusLabel, statusColor, relativeTime, formatDateTime, aiQualityLabel } from "@/lib/utils";
import type { WorkOrder } from "@/lib/types";

type DataSource = "demo" | "production" | "test";
type StatusFilter = "all" | "urgent" | "pending" | "callback";
type SourceFilter = "all" | DataSource;
type CountryFilter = "all" | "US" | "MY";
type CallTypeFilter = "all" | "ai" | "human";

const CALL_TYPE_BADGE: Record<string, { label: string; classes: string }> = {
  ai: { label: "AI", classes: "bg-blue-50 text-blue-700 border-blue-200" },
  human: { label: "Human", classes: "bg-purple-50 text-purple-700 border-purple-200" },
  hybrid: { label: "Hybrid", classes: "bg-teal-50 text-teal-700 border-teal-200" },
};

const SOURCE_BADGE: Record<DataSource, { label: string; classes: string; emoji: string }> = {
  production: { label: "production", classes: "bg-green-50 text-green-700 border-green-200", emoji: "🟢" },
  test: { label: "test", classes: "bg-amber-50 text-amber-700 border-amber-200", emoji: "🟡" },
  demo: { label: "demo", classes: "bg-blue-50 text-blue-700 border-blue-200", emoji: "🟦" },
};

function DashboardPageInner() {
  const searchParams = useSearchParams();
  // Allow ?country=us|my|all (case-insensitive) to set initial filter.
  // Default (no param or unknown) = show all countries.
  const initialCountry: CountryFilter = (() => {
    const c = (searchParams.get("country") || "").toLowerCase();
    if (c === "my") return "MY";
    if (c === "us") return "US";
    if (c === "all") return "all";
    return "all";
  })();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>(initialCountry);
  const [callTypeFilter, setCallTypeFilter] = useState<CallTypeFilter>(
    (() => {
      const c = (searchParams.get("line") || "").toLowerCase();
      if (c === "ai" || c === "human") return c;
      return "all";
    })(),
  );

  useEffect(() => {
    const supabase = getBrowserClient();

    let query = supabase
      .from("work_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (countryFilter === "US") query = query.or("country.eq.US,country.is.null");
    else if (countryFilter === "MY") query = query.eq("country", "MY");
    // "all" → no filter, returns all countries

    query.then(({ data, error }) => {
        if (error) {
          console.error("[dashboard] Failed to load work orders:", error);
        } else {
          setOrders((data || []) as WorkOrder[]);
        }
        setLoading(false);
      });

    // Subscribe to realtime updates — use a unique channel name per mount
    // to avoid the "postgres_changes after subscribe()" error in React strict mode
    const channelName = `work_orders_${countryFilter}_${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setOrders((prev) => [payload.new as WorkOrder, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setOrders((prev) =>
              prev.map((o) => (o.id === (payload.new as WorkOrder).id ? (payload.new as WorkOrder) : o)),
            );
          } else if (payload.eventType === "DELETE") {
            setOrders((prev) => prev.filter((o) => o.id !== (payload.old as WorkOrder).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Apply both filters (status + data source + call type)
  const filtered = orders.filter((o) => {
    // Call type filter (ai | human | hybrid)
    if (callTypeFilter !== "all") {
      if ((o.call_type || "ai") !== callTypeFilter) return false;
    }
    // Source filter
    if (sourceFilter !== "all") {
      if ((o.data_source || "production") !== sourceFilter) return false;
    }
    // Status filter (existing)
    if (filter === "all") return o.status !== "completed" && o.status !== "cancelled";
    if (filter === "urgent") return o.ai_decision === "urgent" || o.status === "urgent";
    if (filter === "pending") return o.status === "pending";
    if (filter === "callback") return o.status === "callback" || o.ai_decision === "unsure";
    return true;
  });

  // Stats (over ALL loaded data, not filtered — so users see real numbers)
  const stats = {
    total: orders.length,
    urgent: orders.filter((o) => o.ai_decision === "urgent" || o.status === "urgent").length,
    pending: orders.filter((o) => o.status === "pending").length,
    callback: orders.filter((o) => o.status === "callback" || o.ai_decision === "unsure").length,
  };

  // Call-type counts for the filter chips
  const callTypeCounts = {
    all: orders.length,
    ai: orders.filter((o) => (o.call_type || "ai") === "ai").length,
    human: orders.filter((o) => o.call_type === "human").length,
  };

  // Source counts for the filter chips
  const sourceCounts = {
    all: orders.length,
    production: orders.filter((o) => (o.data_source || "production") === "production").length,
    demo: orders.filter((o) => o.data_source === "demo").length,
    test: orders.filter((o) => o.data_source === "test").length,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live feed of calls handled by the AI receptionist
          </p>
        </div>
        <div className="text-xs text-gray-400">
          {orders.length > 0 && `${orders.length} total`}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total calls" value={stats.total} />
        <StatCard label="Urgent" value={stats.urgent} accent="red" />
        <StatCard label="Pending" value={stats.pending} accent="blue" />
        <StatCard label="Callback" value={stats.callback} accent="amber" />
      </div>

      {/* Market filter — top-level tab to switch All / US / MY */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Market:</span>
        {(["all", "US", "MY"] as CountryFilter[]).map((c) => {
          const active = countryFilter === c;
          // "all" tab is the canonical / — no query string needed
          const href = c === "all" ? "/" : `/?country=${c.toLowerCase()}`;
          const label =
            c === "all" ? "🌍 All" :
            c === "US" ? "🇺🇸 US (United States)" :
            "🇲🇾 MY (Malaysia)";
          return (
            <a
              key={c}
              href={href}
              className={`px-4 py-1.5 text-sm rounded-md border font-medium ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {label}
            </a>
          );
        })}
      </div>

      {/* Call type filter — which line answered: AI or a human */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Answered by:</span>
        {([
          { key: "all", label: "All lines" },
          { key: "ai", label: "🤖 AI" },
          { key: "human", label: "👤 Human" },
        ] as const).map((c) => {
          const active = callTypeFilter === c.key;
          const colorClass =
            c.key === "human"
              ? active
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-white text-purple-700 border-purple-200 hover:bg-purple-50"
              : c.key === "ai"
                ? active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"
                : active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50";
          return (
            <button
              key={c.key}
              onClick={() => setCallTypeFilter(c.key)}
              className={`px-3 py-1.5 text-sm rounded-md border font-medium ${colorClass}`}
            >
              {c.label}{" "}
              <span className="ml-1 text-xs opacity-75">({callTypeCounts[c.key]})</span>
            </button>
          );
        })}
      </div>

      {/* Data source filter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Source:</span>
        {(["all", "production", "demo", "test"] as SourceFilter[]).map((s) => {
          const count = sourceCounts[s];
          const active = sourceFilter === s;
          const colorClass =
            s === "production"
              ? active ? "bg-green-600 text-white border-green-600" : "bg-white text-green-700 border-green-200 hover:bg-green-50"
              : s === "demo"
                ? active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"
                : s === "test"
                  ? active ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
                  : active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50";
          return (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-md border ${colorClass}`}
            >
              {s === "all" ? "All" : SOURCE_BADGE[s].label} <span className="ml-1 text-xs opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Status:</span>
        {(["all", "urgent", "pending", "callback"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md border ${
              filter === f
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} sourceFilter={sourceFilter} />
      ) : (
        <div className="space-y-2">
          {filtered.map((order) => (
            <WorkOrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "red" | "blue" | "amber" }) {
  const accentClass =
    accent === "red"
      ? "border-l-red-500"
      : accent === "blue"
        ? "border-l-blue-500"
        : accent === "amber"
          ? "border-l-amber-500"
          : "border-l-gray-200";

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${accentClass} px-4 py-3`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function WorkOrderRow({ order }: { order: WorkOrder }) {
  const source = (order.data_source || "production") as DataSource;
  const badge = SOURCE_BADGE[source];
  const callType = order.call_type || "ai";
  const callTypeBadge = CALL_TYPE_BADGE[callType];
  // Country → currency symbol (denormalized display)
  const currencySymbol =
    order.country === "MY" ? "RM" :
    order.country === "SG" ? "S$" :
    order.country === "ID" ? "Rp" :
    "$";
  const countryFlag =
    order.country === "MY" ? "🇲🇾" :
    order.country === "SG" ? "🇸🇬" :
    order.country === "ID" ? "🇮🇩" :
    "🇺🇸";
  return (
    <Link
      href={`/orders/${order.id}`}
      className="block bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all p-4"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${decisionColor(order.ai_decision)}`}>
              {decisionLabel(order.ai_decision)}
            </span>
            {/* Who actually picked up — only badge the non-AI cases so the
                list stays readable once almost everything is AI. */}
            {callType !== "ai" && callTypeBadge && (
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${callTypeBadge.classes}`}
                title={order.line_label || "Answered by a human"}
              >
                👤 {callTypeBadge.label}
              </span>
            )}
            <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded ${statusColor(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            {order.country && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded bg-gray-50 text-gray-700 border border-gray-200">
                {countryFlag} {order.country}
              </span>
            )}
            {order.issue_type && (
              <span className="text-xs text-gray-500 capitalize">{order.issue_type}</span>
            )}
            {order.pricing_breakdown ? (
              <span
                className="text-xs text-gray-700 font-medium"
                title={
                  order.pricing_breakdown.fuel_surcharge > 0
                    ? `Includes ${currencySymbol}${order.pricing_breakdown.trip_fee} trip + ${currencySymbol}${order.pricing_breakdown.fuel_surcharge} fuel surcharge (${order.pricing_breakdown.distance_miles} mi from base)`
                    : `Includes ${currencySymbol}${order.pricing_breakdown.trip_fee} trip fee`
                }
              >
                {currencySymbol}{order.pricing_breakdown.total_low}–{order.pricing_breakdown.total_high}
                {order.pricing_breakdown.fuel_surcharge > 0 && (
                  <span className="ml-1 text-amber-600">⛽</span>
                )}
              </span>
            ) : order.quote_low && order.quote_high ? (
              <span className="text-xs text-gray-700 font-medium">
                {currencySymbol}{order.quote_low}–{order.quote_high}
              </span>
            ) : null}
            {order.ai_quality_flag && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border bg-red-100 text-red-800 border-red-200"
                title={aiQualityLabel(order.ai_quality_flag)}
              >
                ⚠ AI misbehaved
              </span>
            )}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded border ${badge.classes}`}
              title={`Data source: ${badge.label}`}
            >
              {badge.emoji} {badge.label}
            </span>
          </div>
          <div className="text-sm text-gray-900 font-medium">
            {order.summary || "No summary"}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
            <span>{order.customer_name || order.customer_name_extracted || "Unknown"} · {order.customer_phone}</span>
            {order.customer_address && (
              <span className="truncate">· {order.customer_address}</span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-400 flex-shrink-0">
          <div>{relativeTime(order.created_at)}</div>
          <div className="mt-0.5">{formatDateTime(order.created_at)}</div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ filter, sourceFilter }: { filter: string; sourceFilter: string }) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
      <div className="text-4xl mb-3">📞</div>
      <h3 className="text-sm font-semibold text-gray-900">No work orders yet</h3>
      <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
        {sourceFilter !== "all" && `No ${sourceFilter} records matching `}
        {filter === "all" ? "this view." : `"${filter}".`}
        {sourceFilter === "production" && (
          <span className="block mt-2">Make a real call to +1 (724) 362-0422 to see production data here.</span>
        )}
        {sourceFilter === "all" && (
          <span className="block mt-2">When a customer calls your Vapi number, the AI will create a work order here.</span>
        )}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  // Wrap in Suspense because useSearchParams forces dynamic rendering
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}
