// Supabase Edge Function (Deno) - stub / reference implementation.
//
// Duplicate-topic suggestion, as specified in Phase 1 section 3
// (deliberately not semantic/embedding-based for MVP). Radius is a free
// per-chat choice rather than one of a few fixed category tiers, so
// there's no meaningful "same category" filter anymore - proximity
// (against each candidate's own discovery radius) plus title similarity is
// the whole match. All of that - geo filter, pg_trgm similarity ranking,
// and the top-3 cutoff - lives in the suggest_duplicate_conversations SQL
// function (schema.sql) so this and createConversation.ts share one
// implementation instead of two divergent ones.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface RequestBody {
  lat: number;
  lng: number;
  title: string;
}

serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { lat, lng, title } = (await req.json()) as RequestBody;

  const { data: suggestions, error } = await supabase.rpc("suggest_duplicate_conversations", {
    p_lat: lat,
    p_lng: lng,
    p_title: title,
  });
  if (error) return new Response(error.message, { status: 500 });

  return new Response(JSON.stringify({ suggestions: suggestions ?? [] }), {
    headers: { "Content-Type": "application/json" },
  });
});
