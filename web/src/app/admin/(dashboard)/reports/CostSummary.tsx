import { createClient } from "@/lib/supabaseServer";

interface CostSummaryRow {
  reports_today: number;
  moderation_checks_today: number;
  contextual_analyses_today: number;
  cost_today_usd: number;
  reports_month: number;
  cost_month_usd: number;
}

interface ConfigRow {
  daily_limit_usd: number;
  monthly_limit_usd: number;
}

// Reads the same two limits (moderation_config, via admin_moderation_config)
// that analyzeReport's circuit breaker enforces server-side, rather than
// keeping a separate copy here - the whole point of the banner is telling
// the moderator when enforcement is about to kick in, so it has to agree
// with what's actually being enforced.
export async function CostSummary() {
  const supabase = await createClient();
  const [{ data: summary }, { data: config }] = await Promise.all([
    supabase.rpc("admin_moderation_cost_summary").single<CostSummaryRow>(),
    supabase.rpc("admin_moderation_config").single<ConfigRow>(),
  ]);

  if (!summary || !config) return null;

  const dailyPct = config.daily_limit_usd > 0 ? Number(summary.cost_today_usd) / config.daily_limit_usd : 0;
  const monthlyPct = config.monthly_limit_usd > 0 ? Number(summary.cost_month_usd) / config.monthly_limit_usd : 0;
  const pct = Math.max(dailyPct, monthlyPct);
  const tier = pct >= 1 ? "hard" : pct >= 0.9 ? "high" : pct >= 0.75 ? "warning" : null;

  return (
    <div className="mb-6 space-y-3">
      {tier && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            tier === "warning"
              ? "border-[#F3D9A8] bg-[#FAEEDA] text-[#7A4E00]"
              : "border-[#F09595] bg-[#FBE9E9] text-[#A32D2D]"
          }`}
        >
          {tier === "warning" && "AI moderation budget is over 75% used (today or this month)."}
          {tier === "high" && "AI moderation budget is over 90% used - contextual analysis is now limited to safety-critical cases."}
          {tier === "hard" && "AI moderation budget is exhausted - only safety-critical cases still get full contextual analysis; the rest are deferred."}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Reports today" value={summary.reports_today} />
        <Stat label="AI checks today" value={summary.moderation_checks_today} />
        <Stat label="Contextual analyses today" value={summary.contextual_analyses_today} />
        <Stat
          label="Est. cost (today / month)"
          value={`$${Number(summary.cost_today_usd).toFixed(2)} / $${Number(summary.cost_month_usd).toFixed(2)}`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#EDEBE3] bg-white p-3">
      <div className="text-xs text-[#888780]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#2C2C2A]">{value}</div>
    </div>
  );
}
