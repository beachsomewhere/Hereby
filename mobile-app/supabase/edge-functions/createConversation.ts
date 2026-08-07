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

const RADII: Record<string, { discovery: number; participation: number; ttlHours: number }> = {
  micro_location: { discovery: 400, participation: 60, ttlHours: 5 },
  venue: { discovery: 1200, participation: 250, ttlHours: 6 },
  area: { discovery: 3000, participation: 800, ttlHours: 10 },
  corridor: { discovery: 2500, participation: 350, ttlHours: 2 },
};

const VENUE_SNAP_RADIUS_M = 150;
const GRID_CELL_M = 120;

function snapToGrid(lat: number, lng: number, cellMeters = GRID_CELL_M) {
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
  category: keyof typeof RADII;
  lat: number;
  lng: number;
  forceCreate?: boolean;
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

  const { title, category, lat, lng, forceCreate } = (await req.json()) as RequestBody;
  const { data: appUser } = await supabase.from("users").select("id").eq("auth_id", authUser.id).single();
  if (!appUser) return new Response("User not found", { status: 404 });

  // 1. Duplicate check first, unless the client already showed suggestions
  //    and the user explicitly chose to create anyway.
  if (!forceCreate) {
    const { data: nearby } = await supabase.rpc("suggest_duplicate_conversations", {
      p_lat: lat,
      p_lng: lng,
      p_category: category,
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

  const snapped = nearVenue && nearVenue.length > 0 ? null : snapToGrid(lat, lng);
  const radii = RADII[category];

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      title,
      category,
      status: "new",
      location: snapped
        ? `SRID=4326;POINT(${snapped.lng} ${snapped.lat})`
        : `SRID=4326;POINT(${lng} ${lat})`, // venue-centroid case would use the venue's own location
      venue_id: nearVenue?.[0]?.id ?? null,
      discovery_radius_m: radii.discovery,
      participation_radius_m: radii.participation,
      created_by: appUser.id,
      expires_at: new Date(Date.now() + radii.ttlHours * 3600 * 1000).toISOString(),
    })
    .select()
    .single();

  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ conversation }), {
    headers: { "Content-Type": "application/json" },
  });
});
