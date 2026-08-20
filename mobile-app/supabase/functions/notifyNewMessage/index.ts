// Supabase Edge Function (Deno) - stub / reference implementation.
//
// Triggered by trg_notify_new_message (see schema.sql) on every new message
// insert, via pg_net - not client-invoked, so there's no caller JWT to
// verify (the caller is the trusted Postgres trigger itself, authenticating
// with the service-role key the same way recomputeActivity's cron job
// does). Resolves everyone eligible to be notified (joined, not muted, not
// the sender) and pushes to their registered devices via Expo's push API.
//
// Recipient-targeting logic lives here deliberately, not duplicated into
// the trigger's SQL - matching recomputeActivity's own rationale for
// keeping the heavy lifting in the Edge Function for testability, and it's
// exactly the part that'll keep changing as "advanced targeting" (v2, see
// phase1-strategy.md) gets built later.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_BATCH_SIZE = 100; // Expo's documented per-request limit.

interface RequestBody {
  messageId: string;
}

serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { messageId } = (await req.json()) as RequestBody;

  const { data: message } = await supabase.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (!message) return new Response("Message not found", { status: 404 });

  const { data: recipients } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", message.conversation_id)
    .in("state", ["inside", "grace"])
    .eq("muted", false)
    .neq("user_id", message.user_id);

  const recipientIds = (recipients ?? []).map((r) => r.user_id);
  if (recipientIds.length === 0) return new Response("ok - no eligible recipients");

  const { data: tokens } = await supabase.from("push_tokens").select("id, expo_push_token").in("user_id", recipientIds);
  if (!tokens || tokens.length === 0) return new Response("ok - no registered tokens");

  const pushMessages = tokens.map((t) => ({
    to: t.expo_push_token,
    title: message.username,
    body: message.body,
    data: { conversationId: message.conversation_id, threadId: message.thread_id },
  }));

  const staleTokenIds: string[] = [];

  for (let i = 0; i < pushMessages.length; i += EXPO_PUSH_BATCH_SIZE) {
    const batch = pushMessages.slice(i, i + EXPO_PUSH_BATCH_SIZE);
    const tokenBatch = tokens.slice(i, i + EXPO_PUSH_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      const result = await res.json();
      (result.data ?? []).forEach((ticket: { status: string; message?: string; details?: { error?: string } }, idx: number) => {
        if (ticket.status === "error") {
          console.error(`push failed for token ${tokenBatch[idx]?.expo_push_token}:`, ticket.message);
          if (ticket.details?.error === "DeviceNotRegistered") {
            staleTokenIds.push(tokenBatch[idx].id);
          }
        }
      });
    } catch (err) {
      console.error("push batch request failed:", err instanceof Error ? err.message : err);
    }
  }

  if (staleTokenIds.length > 0) {
    await supabase.from("push_tokens").delete().in("id", staleTokenIds);
  }

  return new Response("ok");
});
