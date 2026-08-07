// Supabase Edge Function (Deno) - stub / reference implementation.
//
// Naive keyword-overlap + category + proximity duplicate suggestion, as
// specified in Phase 1 section 3 (deliberately not semantic/embedding-based
// for MVP). Also exposed as a Postgres RPC (suggest_duplicate_conversations)
// so createConversation.ts can call it in-process without a second hop.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function keywordOverlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let shared = 0;
  wa.forEach((w) => {
    if (wb.has(w)) shared++;
  });
  return shared / Math.max(1, Math.min(wa.size, wb.size));
}

interface RequestBody {
  lat: number;
  lng: number;
  category: string;
  title: string;
}

serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { lat, lng, category, title } = (await req.json()) as RequestBody;

  // ST_DWithin-backed RPC does the geo + category filtering in SQL; this
  // function just applies the lightweight text-similarity ranking on top,
  // since that's awkward to express well in plain SQL.
  const { data: candidates } = await supabase.rpc("nearby_conversations_by_category", {
    p_lat: lat,
    p_lng: lng,
    p_category: category,
  });

  const ranked = (candidates ?? [])
    .map((c: { id: string; title: string }) => ({ ...c, overlap: keywordOverlap(c.title, title) }))
    .filter((c: { overlap: number }) => c.overlap > 0.25)
    .sort((a: { overlap: number }, b: { overlap: number }) => b.overlap - a.overlap)
    .slice(0, 3);

  return new Response(JSON.stringify({ suggestions: ranked }), {
    headers: { "Content-Type": "application/json" },
  });
});
