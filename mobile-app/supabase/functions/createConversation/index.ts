// Supabase Edge Function (Deno) - stub / reference implementation.
//
// Handles conversation creation: snaps the raw input coordinate to a
// generalized location (venue centroid if one is close by, else a coarse
// grid cell), then checks for nearby duplicate topics before creating a row.
// The raw coordinate is discarded after snapping - only the generalized
// point is ever stored.
//
// Mirrors src/services/mockBackend.ts#createConversation /
// src/services/geo.ts#snapToGrid.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Radius is a free choice (a slider client-side, MIN_RADIUS_M-MAX_RADIUS_M),
// not one of a few fixed category tiers - discovery radius and TTL are
// derived from it the same way src/services/mockBackend.ts does.
const MIN_RADIUS_M = 5;
const MAX_RADIUS_M = 800;

function interpolateForRadius(radiusM: number, lo: number, hi: number): number {
  const t = Math.max(0, Math.min(1, (radiusM - MIN_RADIUS_M) / (MAX_RADIUS_M - MIN_RADIUS_M)));
  return lo + t * (hi - lo);
}
function ttlHoursForRadius(radiusM: number): number {
  return Math.round(interpolateForRadius(radiusM, 3, 10));
}
function discoveryRadiusForRadius(radiusM: number): number {
  return Math.round(Math.max(150, radiusM * 4));
}
function snapCellForRadius(radiusM: number): number {
  return Math.min(120, radiusM * 0.5);
}

const VENUE_SNAP_RADIUS_M = 150;

function snapToGrid(lat: number, lng: number, cellMeters: number) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const cellDegLat = cellMeters / metersPerDegLat;
  const cellDegLng = cellMeters / metersPerDegLng;
  return {
    lat: Math.round(lat / cellDegLat) * cellDegLat,
    lng: Math.round(lng / cellDegLng) * cellDegLng,
  };
}

interface RequestBody {
  title: string;
  radiusM: number;
  lat: number;
  lng: number;
  forceCreate?: boolean;
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
  // forwarded header) for the one operation that's deliberately revoked from
  // authenticated - create_conversation_with_general_thread, so location-
  // snapping can't be bypassed via a direct client rpc() call.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return new Response("Unauthorized", { status: 401 });

  const { title, radiusM, lat, lng, forceCreate } = (await req.json()) as RequestBody;
  const { data: appUser } = await supabase.from("users").select("id").eq("auth_id", authUser.id).single();
  if (!appUser) return new Response("User not found", { status: 404 });

  // 1. Duplicate check first, unless the client already showed suggestions
  //    and the user explicitly chose to create anyway. No category filter
  //    anymore - proximity (against the candidate's own discovery radius)
  //    plus keyword overlap is the whole match now.
  if (!forceCreate) {
    const { data: nearby } = await supabase.rpc("suggest_duplicate_conversations", {
      p_lat: lat,
      p_lng: lng,
      p_title: title,
    });
    if (nearby && nearby.length > 0) {
      return new Response(JSON.stringify({ suggestions: nearby }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 2. Generalize the location. Try snapping to a known venue centroid
  //    first; fall back to a coarse grid cell. The raw (lat, lng) above is
  //    not referenced again after this block.
  const { data: nearVenue } = await supabase
    .from("venues")
    .select("id, name, location")
    .filter("location", "not.is", null)
    .limit(1);
  // (Simplified for the stub - production would use an ST_DWithin RPC like
  // suggest_duplicate_conversations does, ordering by ST_Distance.)

  const snapped = nearVenue && nearVenue.length > 0 ? null : snapToGrid(lat, lng, snapCellForRadius(radiusM));

  // create_conversation_with_general_thread (schema.sql) does both inserts
  // (the conversation and its always-exactly-one General thread) in a
  // single transaction - not granted to authenticated/anon, only callable
  // here with the service-role connection, so location-snapping above can't
  // be bypassed via a direct client rpc() call.
  const { data: conversation, error } = await supabaseAdmin.rpc("create_conversation_with_general_thread", {
    p_title: title,
    p_lat: snapped ? snapped.lat : lat, // venue-centroid case would use the venue's own location
    p_lng: snapped ? snapped.lng : lng,
    p_discovery_radius_m: discoveryRadiusForRadius(radiusM),
    p_participation_radius_m: radiusM,
    p_created_by: appUser.id,
    p_expires_at: new Date(Date.now() + ttlHoursForRadius(radiusM) * 3600 * 1000).toISOString(),
    p_venue_id: nearVenue?.[0]?.id ?? null,
  });

  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ conversation }), {
    headers: { "Content-Type": "application/json" },
  });
});
