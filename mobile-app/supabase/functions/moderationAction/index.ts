// Supabase Edge Function (Deno).
//
// Single entry point for every moderator action (lock a conversation,
// delete a message, suspend/ban a user). Writes an append-only audit log
// row for every call, which is what backs the appeals flow described in
// Phase 1 section 12 - moderators never mutate content tables directly from
// the client, only through this function, so there is always a record of
// who did what and why. Called from web/src/app/admin - see is_moderator()
// in schema.sql for the matching read-side role check.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Action = "lock_conversation" | "delete_message" | "suspend_user" | "ban_user" | "dismiss_report" | "uphold_report";

interface RequestBody {
  action: Action;
  targetType: "message" | "user" | "conversation";
  targetId: string;
  reason: string;
  caseId?: string;
}

// Every other Edge Function in this project has only ever been called from
// the mobile app (React Native's fetch doesn't enforce CORS - it's a
// browser-only mechanism), so none of them needed this. This one is also
// called from web/src/app/admin (a real browser) via supabase-js's
// functions.invoke(), which sends a preflight OPTIONS request first -
// without these headers on both the preflight response and the real one,
// the browser silently blocks the actual request before it ever reaches
// here, surfacing client-side as a generic "Failed to send a request to
// the Edge Function" with no server-side error to debug at all.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  // Two clients, deliberately - same pattern as checkEligibility: forwarding
  // the caller's own JWT as the Authorization header (even on a client
  // constructed with the service-role key) makes Postgres/PostgREST act as
  // the CALLER's role (authenticated), not service_role - the apikey header
  // doesn't decide the acting role, the decoded Authorization JWT does.
  // `supabase` (below) is only for identifying who's calling; every write
  // this function makes (reports/conversations/messages/users/
  // moderation_actions - none of them have an UPDATE/INSERT policy open to
  // `authenticated`, by design) needs `supabaseAdmin`, a genuine
  // service-role connection with no forwarded header. Confirmed live: using
  // only the caller-forwarded client here meant every one of those writes
  // was silently blocked by RLS - no error (a 0-row UPDATE isn't an error),
  // the function still returned 200 "ok", but nothing in the database ever
  // actually changed.
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
  if (!authUser) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  const { data: moderator } = await supabase
    .from("users")
    .select("id, role")
    .eq("auth_id", authUser.id)
    .single();
  if (!moderator || moderator.role !== "moderator") return new Response("Forbidden", { status: 403, headers: corsHeaders });

  const { action, targetType, targetId, reason, caseId } = (await req.json()) as RequestBody;

  switch (action) {
    case "lock_conversation":
      await supabaseAdmin.from("conversations").update({ status: "cooling_down" }).eq("id", targetId);
      break;
    case "delete_message":
      await supabaseAdmin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", targetId);
      break;
    case "suspend_user":
    case "ban_user":
      await supabaseAdmin.from("users").update({ is_deleted: action === "ban_user" }).eq("id", targetId);
      break;
    case "uphold_report":
    case "dismiss_report": {
      // Upholding a message report removes it for everyone (soft delete) -
      // distinct from the reporter's own immediate, client-side-only hide
      // (see useAppStore.ts#reportedMessageIds), which never touches the
      // database or any other user. Upholding a user report is
      // deliberately audit-only here (no auto suspend/ban) - a single
      // report shouldn't unilaterally trigger an account action with no
      // further review; suspend_user/ban_user above already exist as
      // separate, explicit actions a moderator can take on top of this.
      if (action === "uphold_report" && targetType === "message") {
        await supabaseAdmin.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", targetId);
      }
      // Resolution operates on the moderation_case, not a single report -
      // a burst of reports against one target (see
      // link_report_to_moderation_case in schema.sql) all link to the same
      // case, so one moderator decision here resolves every one of them
      // atomically instead of requiring a separate click per report.
      if (caseId) {
        const resolvedStatus = action === "uphold_report" ? "upheld" : "dismissed";
        await supabaseAdmin
          .from("moderation_cases")
          .update({
            status: resolvedStatus,
            resolved_by: moderator.id,
            resolved_at: new Date().toISOString(),
            resolution_notes: reason,
          })
          .eq("id", caseId);
        await supabaseAdmin
          .from("reports")
          .update({
            status: resolvedStatus,
            resolved_by: moderator.id,
            resolution_notes: reason,
          })
          .eq("moderation_case_id", caseId);
      }
      break;
    }
  }

  await supabaseAdmin.from("moderation_actions").insert({
    moderator_id: moderator.id,
    target_type: targetType,
    target_id: targetId,
    action,
    reason,
  });

  return new Response("ok", { headers: corsHeaders });
});
