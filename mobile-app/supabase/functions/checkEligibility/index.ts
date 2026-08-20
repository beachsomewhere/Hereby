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

// Radius is a free choice (a slider client-side), not a fixed category
// tier - grace period is interpolated from it the same way
// src/services/mockBackend.ts#graceMinutesForRadius does.
const MIN_RADIUS_M = 5;
const MAX_RADIUS_M = 800;

function graceMinutesForRadius(radiusM: number): number {
  const t = Math.max(0, Math.min(1, (radiusM - MIN_RADIUS_M) / (MAX_RADIUS_M - MIN_RADIUS_M)));
  return Math.round(8 + t * (35 - 8));
}

interface RequestBody {
  conversationId: string;
  lat: number;
  lng: number;
}

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  // Two clients, deliberately: forwarding the caller's own JWT as the
  // Authorization header (even on a client constructed with the service-role
  // key) makes Postgres/PostgREST act as the CALLER's role (authenticated),
  // not service_role - the apikey header doesn't decide the acting role, the
  // decoded Authorization JWT does. `supabase` (below) is only for verifying
  // who's calling; `supabaseAdmin` is a genuine service-role connection (no
  // forwarded header) for conversation_participants, which has RLS enabled
  // with zero policies - reads and the upsert below both need real
  // service_role, not just an authenticated user's own privileges.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Every call below was previously chained one-at-a-time (6 sequential
  // round-trips) even though most of them don't actually depend on each
  // other - confirmed live as a real cause of the join flow taking 10-15s.
  // Grouped into 3 stages here, each running its independent calls
  // concurrently: only stage 2 depends on stage 1's output (authUser.id),
  // only stage 3 depends on stage 2's output (appUser.id), and the final
  // upsert depends on both of stage 3's results.
  const [authResult, body] = await Promise.all([supabase.auth.getUser(), req.json() as Promise<RequestBody>]);
  const authUser = authResult.data.user;
  if (!authUser) return new Response("Unauthorized", { status: 401 });
  const { conversationId, lat, lng } = body;

  const [appUserResult, conversationResult] = await Promise.all([
    supabase.from("users").select("id").eq("auth_id", authUser.id).single(),
    supabase.from("conversations").select("*").eq("id", conversationId).single(),
  ]);
  const appUser = appUserResult.data;
  const conversation = conversationResult.data;
  if (!appUser) return new Response("User not found", { status: 404 });
  if (!conversation) return new Response("Conversation not found", { status: 404 });

  // Raw lat/lng is used here, in-memory, for exactly one distance
  // computation, and is never written to any table.
  const [eligibilityResult, existingResult] = await Promise.all([
    supabase.rpc("check_eligibility", {
      p_user_id: appUser.id,
      p_conversation_id: conversationId,
      p_lat: lat,
      p_lng: lng,
    }),
    supabaseAdmin
      .from("conversation_participants")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", appUser.id)
      .maybeSingle(),
  ]);
  const inside = eligibilityResult.data === "inside";
  const existing = existingResult.data;

  const graceMinutes = graceMinutesForRadius(conversation.participation_radius_m);

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

  // muted deliberately omitted from this payload - PostgREST's upsert only
  // updates the columns present here, so an existing row's muted value is
  // left untouched on conflict, and a brand-new row takes its column
  // default (false).
  await supabaseAdmin.from("conversation_participants").upsert({
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
      muted: existing?.muted ?? false,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
