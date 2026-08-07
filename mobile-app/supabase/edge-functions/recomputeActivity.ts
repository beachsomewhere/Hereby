// Supabase Edge Function (Deno) - stub / reference implementation.
//
// Triggered by pg_cron on a short interval (see schema.sql, bottom). Walks
// active/new/cooling_down conversations, recomputes their activity score
// with the same formula as src/services/activityScore.ts, updates
// lifecycle status, and archives anything past its expires_at. This is the
// server-owned "canonical" score; clients only compute a cosmetic render
// size from whatever score they last received over Realtime.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const W_PARTICIPANTS = 2.4;
const W_MESSAGES = 2.0;
const W_IDLE_PENALTY = 0.12;
const W_RECENCY_BOOST = 1.2;
const RECENCY_WINDOW_MIN = 6;

function minutesBetween(a: string, b: number) {
  return Math.max(0, (b - new Date(a).getTime()) / 60000);
}

serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const now = Date.now();
  const { data: conversations } = await supabase
    .from("conversations")
    .select("*")
    .not("status", "in", "(archived,deleted)");

  for (const conv of conversations ?? []) {
    const minutesSinceLastMessage = minutesBetween(conv.last_activity_at, now);
    const minutesSinceCreated = minutesBetween(conv.created_at, now);
    const recencyBoost = Math.max(0, RECENCY_WINDOW_MIN - minutesSinceCreated) * W_RECENCY_BOOST;

    const score = Math.max(
      0,
      W_PARTICIPANTS * Math.log(1 + conv.participant_count) +
        W_MESSAGES * Math.log(1 + conv.messages_last_15min) -
        W_IDLE_PENALTY * minutesSinceLastMessage +
        recencyBoost
    );

    const pastExpiry = new Date(conv.expires_at).getTime() <= now;
    let status = conv.status;
    if (pastExpiry) {
      status = "archived";
    } else if (score < 1.5 && minutesSinceLastMessage > 45) {
      status = "cooling_down";
    } else if (score >= 4) {
      status = "active";
    }

    await supabase
      .from("conversations")
      .update({ activity_score: score, status })
      .eq("id", conv.id);
  }

  // Retention: hard-delete conversations archived long enough ago that the
  // moderation/appeals window (24-72h, see Phase 1 section 10) has passed.
  const cutoff = new Date(now - 72 * 3600 * 1000).toISOString();
  await supabase.from("conversations").delete().eq("status", "archived").lt("expires_at", cutoff);

  return new Response("ok");
});
