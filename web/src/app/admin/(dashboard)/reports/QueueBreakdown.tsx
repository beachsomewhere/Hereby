interface Props {
  priorityCounts: Record<"P0" | "P1" | "P2" | "P3", number>;
  typeCounts: Record<"message" | "user" | "conversation", number>;
}

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-[#A32D2D] text-white",
  P1: "bg-[#C85A2B] text-white",
  P2: "bg-[#EF9F27] text-white",
  P3: "bg-[#D3D1C7] text-[#444441]",
};

// Pure at-a-glance counts over the same rows the queue below already
// fetched - no separate query, just a reduce over admin_list_moderation_cases'
// result, so this can never disagree with what's actually in the lists.
export function QueueBreakdown({ priorityCounts, typeCounts }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-[#EDEBE3] bg-white px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        {(["P0", "P1", "P2", "P3"] as const).map((p) => (
          <span key={p} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLES[p]}`}>
            {p}: {priorityCounts[p]}
          </span>
        ))}
      </div>
      <div className="h-4 w-px bg-[#EDEBE3]" />
      <div className="flex items-center gap-3 text-xs text-[#5F5E5A]">
        <span>Messages: {typeCounts.message}</span>
        <span>Users: {typeCounts.user}</span>
        <span>Conversations: {typeCounts.conversation}</span>
      </div>
    </div>
  );
}
