import { createClient } from "@/lib/supabaseServer";

interface AdminConversationRow {
  id: string;
  title: string;
  status: "new" | "active" | "cooling_down" | "archived" | "deleted";
  created_at: string;
  expires_at: string;
  participant_count: number;
  peak_participant_count: number;
  lat: number;
  lng: number;
}

// "2h 15m" / "3d 4h" / "45m" - coarsest two units, since a live-monitoring
// table has no use for second-level precision.
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.abs(ms) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatAge(createdAt: string): string {
  return formatDuration(Date.now() - new Date(createdAt).getTime());
}

function formatTimeToAgeOut(expiresAt: string): string {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return "Expired";
  return formatDuration(remainingMs);
}

function formatGps(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const COLUMNS = ["Chat name", "Age", "Time to age out", "GPS coordinates", "Users", "Peak users"];

export default async function AdminChatsPage() {
  const supabase = await createClient();
  const { data: chats, error } = await supabase.rpc("admin_list_conversations");

  if (error) {
    return <p className="text-sm text-[#A32D2D]">Couldn&rsquo;t load chats: {error.message}</p>;
  }

  const rows = (chats ?? []) as AdminConversationRow[];

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-[#2C2C2A]">Chats ({rows.length})</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-[#888780]">No current chats.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#EDEBE3] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDEBE3] bg-[#FAF9F5]">
                {COLUMNS.map((col) => (
                  <th key={col} className="px-4 py-2.5 text-xs font-medium text-[#888780]">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((chat) => (
                <tr key={chat.id} className="border-b border-[#EDEBE3] last:border-0">
                  <td className="px-4 py-2.5 font-medium text-[#2C2C2A]">{chat.title}</td>
                  <td className="px-4 py-2.5 text-[#5F5E5A]">{formatAge(chat.created_at)}</td>
                  <td className="px-4 py-2.5 text-[#5F5E5A]">
                    {chat.participant_count === 0 ? (
                      <span className="text-[#A32D2D]">{formatTimeToAgeOut(chat.expires_at)}</span>
                    ) : (
                      formatTimeToAgeOut(chat.expires_at)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[#5F5E5A]">{formatGps(chat.lat, chat.lng)}</td>
                  <td className="px-4 py-2.5 text-[#2C2C2A]">{chat.participant_count}</td>
                  <td className="px-4 py-2.5 text-[#2C2C2A]">{chat.peak_participant_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
