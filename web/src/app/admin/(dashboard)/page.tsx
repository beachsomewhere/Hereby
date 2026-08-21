import { createClient } from "@/lib/supabaseServer";

interface AdminStats {
  total_users: number;
  total_conversations: number;
  active_conversations: number;
  total_messages: number;
  messages_last_24h: number;
  new_users_last_7d: number;
}

const CARDS: { key: keyof AdminStats; label: string }[] = [
  { key: "total_users", label: "Total users" },
  { key: "new_users_last_7d", label: "New users (7d)" },
  { key: "total_conversations", label: "Total conversations" },
  { key: "active_conversations", label: "Active conversations" },
  { key: "total_messages", label: "Total messages" },
  { key: "messages_last_24h", label: "Messages (24h)" },
];

export default async function AdminHomePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stats").single<AdminStats>();

  if (error || !data) {
    return <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load stats: {error?.message ?? "no data"}</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-[#2C2C2A]">Overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-xl border border-[#EDEBE3] bg-white p-5">
            <div className="text-xs text-[#888780]">{card.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#2C2C2A]">{data[card.key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
