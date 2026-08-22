"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

type AiStatus =
  | "pending"
  | "moderation_check_complete"
  | "context_analysis_pending"
  | "analysis_complete"
  | "analysis_failed"
  | "deferred_budget_limit";

interface Props {
  caseId: string;
  targetType: "message" | "user" | "conversation";
  targetId: string;
  contentSnapshot: string | null;
  reportedUsername?: string;
  reportCount: number;
  firstReportedAt: string;
  priority: "P0" | "P1" | "P2" | "P3";
  severity: "critical" | "high" | "medium" | "low" | null;
  confidence: number | null;
  violationCategory: string | null;
  recommendedAction: string | null;
  requiresHumanReview: boolean;
  aiRecommendedDismissal: boolean;
  contentAutoRemoved: boolean;
  severityBasedOn: "reported_content" | "context_only" | null;
  reasoning: string | null;
  aiStatus: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-[#A32D2D] text-white",
  P1: "bg-[#C85A2B] text-white",
  P2: "bg-[#EF9F27] text-white",
  P3: "bg-[#D3D1C7] text-[#444441]",
};

// analysis_failed/deferred_budget_limit are deliberately styled distinct
// from analysis_complete - both mean "still needs a human," but for a
// different reason (AI never finished, not AI made a judgment call), and
// that distinction matters for how a moderator should read the card.
const AI_STATUS_LABELS: Record<AiStatus, string> = {
  pending: "AI: pending",
  moderation_check_complete: "AI: checking…",
  context_analysis_pending: "AI: analyzing…",
  analysis_complete: "AI: analyzed",
  analysis_failed: "AI: analysis failed",
  deferred_budget_limit: "AI: deferred (budget)",
};
const AI_STATUS_STYLES: Record<AiStatus, string> = {
  pending: "bg-[#EDEBE3] text-[#5F5E5A]",
  moderation_check_complete: "bg-[#DCE8F5] text-[#1E4E7A]",
  context_analysis_pending: "bg-[#DCE8F5] text-[#1E4E7A]",
  analysis_complete: "bg-[#DCEFDC] text-[#2C6B2F]",
  analysis_failed: "bg-[#F5DCDC] text-[#A32D2D]",
  deferred_budget_limit: "bg-[#FAEEDA] text-[#7A4E00]",
};

// Uphold/Dismiss/Re-run all go through Edge Functions rather than a direct
// table update - moderationAction is the single entry point for every
// moderator action (and the only thing that writes the moderation_actions
// audit log), analyzeReport is the single entry point for AI analysis
// (this button hits the same pipeline the trigger fires automatically, not
// a separate implementation).
export function CaseCard({
  caseId,
  targetType,
  targetId,
  contentSnapshot,
  reportedUsername,
  reportCount,
  firstReportedAt,
  priority,
  severity,
  confidence,
  violationCategory,
  recommendedAction,
  requiresHumanReview,
  aiRecommendedDismissal,
  contentAutoRemoved,
  severityBasedOn,
  reasoning,
  aiStatus,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState<"uphold" | "dismiss" | "rerun">();
  const [error, setError] = useState<string>();

  async function resolve(action: "uphold_report" | "dismiss_report") {
    setLoading(action === "uphold_report" ? "uphold" : "dismiss");
    setError(undefined);
    const { error } = await supabase.functions.invoke("moderationAction", {
      body: { action, targetType, targetId, reason: notes, caseId },
    });
    setLoading(undefined);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function rerunAnalysis() {
    setLoading("rerun");
    setError(undefined);
    const { error } = await supabase.functions.invoke("analyzeReport", { body: { caseId } });
    setLoading(undefined);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  const status = (aiStatus in AI_STATUS_LABELS ? aiStatus : "pending") as AiStatus;

  return (
    <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${PRIORITY_STYLES[priority]}`}>{priority}</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${AI_STATUS_STYLES[status]}`}>{AI_STATUS_LABELS[status]}</span>
        {aiRecommendedDismissal && (
          <span className="rounded-full bg-[#DCEFDC] px-2 py-0.5 font-medium text-[#2C6B2F]">AI recommends dismissal</span>
        )}
        {contentAutoRemoved && (
          <span className="rounded-full bg-[#F5DCDC] px-2 py-0.5 font-medium text-[#A32D2D]">Content auto-removed — review needed</span>
        )}
        {severityBasedOn === "context_only" && (
          <span className="rounded-full bg-[#FAEEDA] px-2 py-0.5 font-medium text-[#7A4E00]">
            Concern found elsewhere, not in this content
          </span>
        )}
        <span className="text-[#888780]">
          {targetType} · {reportCount} {reportCount === 1 ? "report" : "reports"}
        </span>
        <span className="ml-auto text-[#888780]">{new Date(firstReportedAt).toLocaleString()}</span>
      </div>

      <p className="mt-3 text-sm text-[#2C2C2A]">
        {reportedUsername && <span className="font-medium">User: {reportedUsername} — </span>}
        {contentSnapshot ?? "No content captured."}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5F5E5A]">
        {severity && <span>Severity: {severity}</span>}
        {confidence != null && <span>Confidence: {Math.round(confidence * 100)}%</span>}
        {violationCategory && <span>Category: {violationCategory}</span>}
        {recommendedAction && <span>AI suggests: {recommendedAction.replaceAll("_", " ")}</span>}
        {requiresHumanReview && <span className="font-medium text-[#A32D2D]">Requires human review</span>}
      </div>

      {reasoning && (
        <p className="mt-2 rounded-lg bg-[#F1EFE8] p-3 text-xs text-[#444441]">
          <span className="font-medium text-[#2C2C2A]">AI justification: </span>
          {reasoning}
        </p>
      )}

      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Resolution notes (optional)"
        className="mt-3 w-full rounded-lg border border-[#D3D1C7] bg-white px-3 py-1.5 text-sm text-[#2C2C2A] outline-none focus:border-[#2C2C2A]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => resolve("uphold_report")}
          disabled={!!loading}
          className="rounded-lg bg-[#A32D2D] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading === "uphold" ? "Working…" : targetType === "message" ? "Uphold & delete message" : "Uphold"}
        </button>
        <button
          onClick={() => resolve("dismiss_report")}
          disabled={!!loading}
          className="rounded-lg border border-[#D3D1C7] px-3 py-1.5 text-xs font-medium text-[#2C2C2A] disabled:opacity-50"
        >
          {loading === "dismiss" ? "Working…" : "Dismiss"}
        </button>
        <button
          onClick={rerunAnalysis}
          disabled={!!loading}
          className="rounded-lg border border-[#D3D1C7] px-3 py-1.5 text-xs font-medium text-[#5F5E5A] disabled:opacity-50"
        >
          {loading === "rerun" ? "Working…" : "Re-run AI Analysis"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#A32D2D]">{error}</p>}
    </div>
  );
}
