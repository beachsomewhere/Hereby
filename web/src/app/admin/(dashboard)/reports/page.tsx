import { createClient } from "@/lib/supabaseServer";
import { CaseCard } from "./CaseCard";
import { CostSummary } from "./CostSummary";
import { QueueBreakdown } from "./QueueBreakdown";

interface ModerationCaseRow {
  id: string;
  target_type: "message" | "user" | "conversation";
  target_id: string;
  reported_user_id: string | null;
  reported_content_snapshot: string | null;
  report_count: number;
  first_reported_at: string;
  priority: "P0" | "P1" | "P2" | "P3";
  severity: "critical" | "high" | "medium" | "low" | null;
  confidence: number | null;
  violation_category: string | null;
  recommended_action: string | null;
  requires_human_review: boolean;
  ai_recommended_dismissal: boolean;
  content_auto_removed: boolean;
  severity_based_on: "reported_content" | "context_only" | null;
  reasoning: string | null;
  ai_status: string;
}

// moderation_cases is the primary object now, not individual reports - a
// burst of reports against the same target (see
// link_report_to_moderation_case in schema.sql) all link to one case and
// share one AI analysis, so the queue here is cases, not a flat report
// list. admin_list_moderation_cases() already returns pre-sorted by the
// priority/severity/report-volume/confidence/age order, so both sections
// below just render in RPC order - no client-side re-sort needed, only a
// split by requires_human_review.
export default async function AdminReportsPage() {
  const supabase = await createClient();
  const { data: cases, error } = await supabase.rpc("admin_list_moderation_cases", { p_status: "open" });

  if (error) {
    return <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load moderation queue: {error.message}</p>;
  }

  const rows = (cases ?? []) as ModerationCaseRow[];
  const reportedUserIds = [...new Set(rows.map((c) => c.reported_user_id).filter((id): id is string => !!id))];
  const { data: users } =
    reportedUserIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", reportedUserIds)
      : { data: [] as { id: string; username: string }[] };
  const usernameById = new Map((users ?? []).map((u) => [u.id, u.username]));

  const needsReview = rows.filter((c) => c.requires_human_review);
  const otherCases = rows.filter((c) => !c.requires_human_review);

  const priorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const typeCounts = { message: 0, user: 0, conversation: 0 };
  for (const c of rows) {
    priorityCounts[c.priority]++;
    typeCounts[c.target_type]++;
  }

  function renderCase(c: ModerationCaseRow) {
    return (
      <CaseCard
        key={c.id}
        caseId={c.id}
        targetType={c.target_type}
        targetId={c.target_id}
        contentSnapshot={c.reported_content_snapshot}
        reportedUsername={c.reported_user_id ? usernameById.get(c.reported_user_id) : undefined}
        reportCount={c.report_count}
        firstReportedAt={c.first_reported_at}
        priority={c.priority}
        severity={c.severity}
        confidence={c.confidence}
        violationCategory={c.violation_category}
        recommendedAction={c.recommended_action}
        requiresHumanReview={c.requires_human_review}
        aiRecommendedDismissal={c.ai_recommended_dismissal}
        contentAutoRemoved={c.content_auto_removed}
        severityBasedOn={c.severity_based_on}
        reasoning={c.reasoning}
        aiStatus={c.ai_status}
      />
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-[#2C2C2A]">Moderation queue</h1>
      <CostSummary />
      {rows.length > 0 && <QueueBreakdown priorityCounts={priorityCounts} typeCounts={typeCounts} />}

      {rows.length === 0 ? (
        <p className="text-sm text-[#888780]">No open cases.</p>
      ) : (
        <>
          <h2 className="mb-3 text-sm font-semibold text-[#A32D2D]">
            Requires human review ({needsReview.length})
          </h2>
          {needsReview.length === 0 ? (
            <p className="mb-6 text-sm text-[#888780]">Nothing needs review right now.</p>
          ) : (
            <div className="mb-8 space-y-4">{needsReview.map(renderCase)}</div>
          )}

          <h2 className="mb-3 text-sm font-semibold text-[#5F5E5A]">
            Other open cases ({otherCases.length})
          </h2>
          {otherCases.length === 0 ? (
            <p className="text-sm text-[#888780]">Nothing else open.</p>
          ) : (
            <div className="space-y-4">{otherCases.map(renderCase)}</div>
          )}
        </>
      )}
    </div>
  );
}
