import { redirect } from "next/navigation";

/**
 * The old demo page. It showed meeting minutes generated from hard-coded
 * sample transcripts — a showcase, not a product surface.
 *
 * The capability it demonstrated now runs on real calls: the human line
 * generates the same minutes for every call a person actually answered, and
 * they live in the work order. The demo's fake data has been removed so
 * nobody mistakes sample transcripts for real customers.
 *
 * Old links land on the real view.
 */
export default function HumanHandoffDemoRedirect() {
  redirect("/human-calls");
}
