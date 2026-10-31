import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = (d.getTime() - now) / 1000; // seconds

  const absDiff = Math.abs(diff);
  const isFuture = diff > 0;

  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (absDiff < 60) return rtf.format(Math.round(diff), "second");
  if (absDiff < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (absDiff < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function decisionLabel(decision: string): string {
  return {
    accepted: "Accepted",
    urgent: "Urgent",
    unsure: "Callback",
    rejected: "Out of scope",
    human_handled: "Handled by human",
  }[decision] || decision;
}

export function decisionColor(decision: string): string {
  return {
    accepted: "bg-green-100 text-green-800 border-green-200",
    urgent: "bg-red-100 text-red-800 border-red-200",
    unsure: "bg-amber-100 text-amber-800 border-amber-200",
    rejected: "bg-gray-100 text-gray-600 border-gray-200",
    human_handled: "bg-purple-100 text-purple-800 border-purple-200",
  }[decision] || "bg-gray-100 text-gray-800 border-gray-200";
}

export function statusLabel(status: string): string {
  return {
    pending: "Pending",
    confirmed: "Confirmed",
    rejected: "Rejected",
    callback: "Callback needed",
    urgent: "Urgent",
    completed: "Completed",
    cancelled: "Cancelled",
  }[status] || status;
}

export function statusColor(status: string): string {
  return {
    pending: "bg-blue-50 text-blue-700",
    confirmed: "bg-green-50 text-green-700",
    rejected: "bg-gray-50 text-gray-500",
    callback: "bg-amber-50 text-amber-700",
    urgent: "bg-red-50 text-red-700",
    completed: "bg-emerald-50 text-emerald-700",
    cancelled: "bg-gray-50 text-gray-500",
  }[status] || "bg-gray-50 text-gray-700";
}

/**
 * Human-readable label for the AI quality flags on a work order.
 *
 * These mark calls where the AI visibly misbehaved — e.g. it repeated its
 * opening question after the customer had already spoken (the 2026-10-14
 * bug). They are warnings for a human to look at, not automated decisions.
 */
export function aiQualityLabel(flags: string | null | undefined): string {
  if (!flags) return "";
  const parts = flags.split(",").map((f) => f.trim()).filter(Boolean);
  const labels: Record<string, string> = {
    repeated_turn: "AI repeated itself",
    opener_echo: "AI echoed its opening question",
    no_customer_turn: "Customer never got a word in",
  };
  if (!parts.length) return "";
  return parts.map((p) => labels[p] || p).join(" · ");
}

export function aiQualityColor(flags: string | null | undefined): string {
  return flags
    ? "bg-red-100 text-red-800 border-red-200"
    : "bg-gray-100 text-gray-800 border-gray-200";
}

/**
 * Turn a raw delivery error into something an operator can act on.
 *
 * The `notifications` table stores whatever Twilio said. That string is
 * accurate but not actionable — "twilio_from_not_owned:+17243620422" does not
 * tell the operator that the account needs a number it owns. The known
 * failure modes each get a plain-English cause; anything unrecognised is
 * passed through unchanged rather than hidden.
 */
export function notificationErrorLabel(error: string | null | undefined): string {
  if (!error) return "Unknown error";
  const e = error.toLowerCase();
  if (e.startsWith("twilio_from_not_owned"))
    return "The sending number is not owned by this Twilio account";
  if (e.includes("trial account has expired"))
    return "The Twilio trial has expired — the account must be upgraded";
  if (e.includes("no twilio trial phone number"))
    return "Twilio has no usable sending number on this account";
  if (e.startsWith("twilio_trial"))
    return "Twilio is still on a trial account";
  if (e.startsWith("twilio_not_configured"))
    return "Twilio credentials are missing";
  if (e.startsWith("twilio_credentials_missing"))
    return "Twilio credentials are missing";
  if (e.startsWith("twilio_from_number_missing"))
    return "No sending number is configured";
  if (e.startsWith("twilio_probe_failed"))
    return "Twilio could not be reached";
  return error;
}

/** Whether a notification row represents a delivery that never happened. */
export function notificationFailed(status: string | null | undefined): boolean {
  return status === "failed";
}
