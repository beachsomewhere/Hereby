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
  reportId?: string;
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

  const { data: moderator } = await supabase
    .from("users")
    .select("id, role")
    .eq("auth_id", authUser.id)
    .single();
  if (!moderator || moderator.role !== "moderator") return new Response("Forbidden", { status: 403 });

  const { action, targetType, targetId, reason, reportId } = (await req.json()) as RequestBody;

  switch (action) {
    case "lock_conversation":
      await supabase.from("conversations").update({ status: "cooling_down" }).eq("id", targetId);
      break;
    case "delete_message":
      await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", targetId);
      break;
    case "suspend_user":
    case "ban_user":
      await supabase.from("users").update({ is_deleted: action === "ban_user" }).eq("id", targetId);
      break;
    case "uphold_report":
    case "dismiss_report":
      if (reportId) {
        await supabase
          .from("reports")
          .update({
            status: action === "uphold_report" ? "upheld" : "dismissed",
            resolved_by: moderator.id,
            resolution_notes: reason,
          })
          .eq("id", reportId);
      }
      break;
  }

  await supabase.from("moderation_actions").insert({
    moderator_id: moderator.id,
    target_type: targetType,
    target_id: targetId,
    action,
    reason,
  });

  return new Response("ok");
});
