import { createClient } from "@/lib/supabaseServer";
import { ReportCard } from "./ReportCard";

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: "message" | "user" | "conversation";
  target_id: string;
  reason: string;
  created_at: string;
  status: "open" | "upheld" | "dismissed";
}

async function loadContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  report: ReportRow
): Promise<string> {
  if (report.target_type === "message") {
    const { data } = await supabase
      .from("messages")
      .select("username, body")
      .eq("id", report.target_id)
      .maybeSingle();
    return data ? `${data.username}: "${data.body}"` : "Message no longer available (already deleted).";
  }
  if (report.target_type === "user") {
    const { data } = await supabase.from("users").select("username").eq("id", report.target_id).maybeSingle();
    return data ? `User: ${data.username}` : "User not found.";
  }
  const { data } = await supabase.from("conversations").select("title").eq("id", report.target_id).maybeSingle();
  return data ? `Conversation: ${data.title}` : "Conversation not found.";
}

// reports.reporter_id -> users.id, so a plain select can't be chained
// through PostgREST here without a foreign-key-based embed (reports has no
// FK-based join declared for this) - fetched as a separate lookup instead,
// batched with the target-context fetches below.
async function loadReporterLabel(supabase: Awaited<ReturnType<typeof createClient>>, reporterId: string): Promise<string> {
  const { data } = await supabase.from("users").select("username").eq("id", reporterId).maybeSingle();
  return data?.username ?? "unknown user";
}

export default async function AdminReportsPage() {
  const supabase = await createClient();
  const { data: reports, error } = await supabase.rpc("admin_list_reports", { p_status: "open" });

  if (error) {
    return <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load reports: {error.message}</p>;
  }

  const rows = (reports ?? []) as ReportRow[];
  const withContext = await Promise.all(
    rows.map(async (r) => ({
      report: r,
      context: await loadContext(supabase, r),
      reporterLabel: await loadReporterLabel(supabase, r.reporter_id),
    }))
  );

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-[#2C2C2A]">Open reports</h1>
      {withContext.length === 0 ? (
        <p className="text-sm text-[#888780]">No open reports.</p>
      ) : (
        <div className="space-y-4">
          {withContext.map(({ report, context, reporterLabel }) => (
            <ReportCard
              key={report.id}
              reportId={report.id}
              targetType={report.target_type}
              targetId={report.target_id}
              reason={report.reason}
              createdAt={report.created_at}
              reporterLabel={reporterLabel}
              contextLabel={context}
            />
          ))}
        </div>
      )}
    </div>
  );
}
