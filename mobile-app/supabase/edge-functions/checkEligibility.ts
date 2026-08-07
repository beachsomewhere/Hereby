// Supabase Edge Function (Deno) - stub / reference implementation.
//
// This is the single most important server-side function in the product:
// it is the ONLY place that ever sees a user's raw coordinate for the
// purpose of a join/post decision, and it never persists that coordinate -
// only the resulting participant state.
//
// Mirrors src/services/mockBackend.ts#checkEligibility exactly, so the
// client-facing contract doesn't change when this replaces the mock.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRACE_MINUTES: Record<string, number> = {
  micro_location: 12,
  venue: 25,
  area: 35,
  corridor: 15,
};

interface RequestBody {
  conversationId: string;
  lat: number;
  lng: number;
}

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return new Response("Unauthorized", { status: 401 });

  const { conversationId, lat, lng } = (await req.json()) as RequestBody;

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authUser.id)
    .single();
  if (!appUser) return new Response("User not found", { status: 404 });

  const { data: conversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();
  if (!conversation) return new Response("Conversation not found", { status: 404 });

  // Raw lat/lng is used here, in-memory, for exactly one distance
  // computation, and is never written to any table.
  const { data: distanceResult } = await supabase.rpc("check_eligibility", {
    p_user_id: appUser.id,
    p_conversation_id: conversationId,
    p_lat: lat,
    p_lng: lng,
  });
  const inside = distanceResult === "inside";

  const { data: existing } = await supabase
    .from("conversation_participants")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", appUser.id)
    .maybeSingle();

  const graceMinutes = GRACE_MINUTES[conversation.category] ?? 15;

  let state: "inside" | "grace" | "read_only" | "left";
  let graceStartedAt: string | null = existing?.grace_started_at ?? null;

  if (inside) {
    state = "inside";
    graceStartedAt = null;
  } else if (existing && (existing.state === "inside" || existing.state === "grace")) {
    graceStartedAt = graceStartedAt ?? new Date().toISOString();
    const minutesInGrace = (Date.now() - new Date(graceStartedAt).getTime()) / 60000;
    state = minutesInGrace <= graceMinutes ? "grace" : "read_only";
  } else {
    state = "read_only";
  }

  await supabase.from("conversation_participants").upsert({
    conversation_id: conversationId,
    user_id: appUser.id,
    state,
    grace_started_at: state === "grace" ? graceStartedAt : null,
    last_check_at: new Date().toISOString(),
    joined_at: existing?.joined_at ?? new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({
      state,
      canPost: state === "inside" || state === "grace",
      canRead: true,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
