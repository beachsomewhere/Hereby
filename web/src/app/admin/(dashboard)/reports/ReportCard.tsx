"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

interface Props {
  reportId: string;
  targetType: "message" | "user" | "conversation";
  targetId: string;
  reason: string;
  createdAt: string;
  reporterLabel: string;
  contextLabel: string;
}

// Resolve/Dismiss both go through the moderationAction Edge Function
// (supabase/functions/moderationAction) rather than a direct table update -
// that function is the single entry point for every moderator action and
// is what writes the moderation_actions audit log row, matching the rest
// of the app's "trust-sensitive writes go through Edge Functions" rule
// (see schema.sql's own header).
export function ReportCard({ reportId, targetType, targetId, reason, createdAt, reporterLabel, contextLabel }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState<"uphold" | "dismiss">();
  const [error, setError] = useState<string>();

  async function resolve(action: "uphold_report" | "dismiss_report") {
    setLoading(action === "uphold_report" ? "uphold" : "dismiss");
    setError(undefined);
    const { error } = await supabase.functions.invoke("moderationAction", {
      body: { action, targetType, targetId, reason: notes, reportId },
    });
    setLoading(undefined);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-[#EDEBE3] bg-white p-5">
      <div className="flex items-center justify-between text-xs text-[#888780]">
        <span>
          {targetType} · reported by {reporterLabel}
        </span>
        <span>{new Date(createdAt).toLocaleString()}</span>
      </div>
      <p className="mt-2 text-sm text-[#2C2C2A]">{contextLabel}</p>
      <p className="mt-1 text-sm text-[#5F5E5A]">
        <span className="font-medium text-[#2C2C2A]">Reason: </span>
        {reason}
      </p>

      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Resolution notes (optional)"
        className="mt-3 w-full rounded-lg border border-[#D3D1C7] px-3 py-1.5 text-sm outline-none focus:border-[#2C2C2A]"
      />

      <div className="mt-3 flex gap-2">
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
      </div>
      {error && <p className="mt-2 text-xs text-[#A32D2D]">{error}</p>}
    </div>
  );
}
