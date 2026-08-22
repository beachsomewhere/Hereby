import { createClient } from "@/lib/supabaseServer";
import { TrendChart } from "./TrendChart";

interface AdminStats {
  total_users: number;
  total_conversations: number;
  active_conversations: number;
  total_messages: number;
  messages_last_24h: number;
  new_users_last_7d: number;
  avg_participants_per_conversation: number | null;
}

interface AdoptionTrendRow {
  day: string;
  new_users: number;
  new_conversations: number;
  active_users: number;
  messages_sent: number;
}

const CARDS: { key: keyof AdminStats; label: string }[] = [
  { key: "total_users", label: "Total users" },
  { key: "new_users_last_7d", label: "New users (7d)" },
  { key: "total_conversations", label: "Total conversations" },
  { key: "active_conversations", label: "Active conversations" },
  { key: "total_messages", label: "Total messages" },
  { key: "messages_last_24h", label: "Messages (24h)" },
];

// Short month/day label (e.g. "Aug 22") for the chart's axis endpoints -
// trend rows come back as plain ISO dates from admin_adoption_trends().
function shortDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function AdminHomePage() {
  const supabase = await createClient();
  const [{ data: stats, error: statsError }, { data: trend, error: trendError }] = await Promise.all([
    supabase.rpc("admin_stats").single<AdminStats>(),
    supabase.rpc("admin_adoption_trends", { p_days: 30 }),
  ]);

  if (statsError || !stats) {
    return <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load stats: {statsError?.message ?? "no data"}</p>;
  }

  const trendRows = (trend ?? []) as AdoptionTrendRow[];
  const days = trendRows.map((r) => shortDay(r.day));

  // Point-in-time ratios, computed from admin_stats() rather than a
  // separate RPC - "active conversations against total conversations" was
  // the user's own example of this kind of metric.
  const activeRatio = stats.total_conversations > 0 ? (stats.active_conversations / stats.total_conversations) * 100 : 0;
  const avgMessagesPerConversation = stats.total_conversations > 0 ? stats.total_messages / stats.total_conversations : 0;

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-[#2C2C2A]">Overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-xl border border-[#EDEBE3] bg-white p-5">
            <div className="text-xs text-[#888780]">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#2C2C2A]">{stats[card.key]}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-[#5F5E5A]">Engagement ratios</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
          <div className="text-xs text-[#888780]">Active / total conversations</div>
          <div className="mt-1 text-2xl font-semibold text-[#2C2C2A]">{activeRatio.toFixed(0)}%</div>
        </div>
        <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
          <div className="text-xs text-[#888780]">Avg messages / conversation</div>
          <div className="mt-1 text-2xl font-semibold text-[#2C2C2A]">{avgMessagesPerConversation.toFixed(1)}</div>
        </div>
        <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
          <div className="text-xs text-[#888780]">Avg participants / conversation</div>
          <div className="mt-1 text-2xl font-semibold text-[#2C2C2A]">
            {stats.avg_participants_per_conversation ?? 0}
          </div>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-[#5F5E5A]">Adoption, last 30 days</h2>
      {trendError ? (
        <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load trends: {trendError.message}</p>
      ) : trendRows.length === 0 ? (
        <p className="text-sm text-[#888780]">No trend data yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TrendChart label="New signups" values={trendRows.map((r) => r.new_users)} days={days} />
          <TrendChart label="New conversations" values={trendRows.map((r) => r.new_conversations)} days={days} />
          <TrendChart label="Daily active users" values={trendRows.map((r) => r.active_users)} days={days} />
          <TrendChart label="Messages sent" values={trendRows.map((r) => r.messages_sent)} days={days} />
        </div>
      )}
    </div>
  );
}
