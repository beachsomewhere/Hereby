// Real, production backend - implements the exact same function surface as
// mockBackend.ts's production functions (everything except the dev*-
// prefixed exports, which stay mock-only and are never called from here).
// Every non-dev screen/component imports from this module instead.
//
// Trust boundary, matching CLAUDE.md/phase1-strategy.md's "never trust the
// client for location" principle: raw GPS and anything that mutates
// helpful_points/level/avatar_icon/eligibility state routes through a
// SECURITY DEFINER RPC (supabase/schema.sql) or a service-role Edge
// Function (supabase/functions/*/index.ts) - never a direct client write.
// RLS on conversations/conversation_participants/confirmations blocks
// direct client writes entirely, so those paths are the only way in.

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { distanceMeters } from "./geo";
import { computeRenderSize } from "./activityScore";
import { generatePseudonym } from "./pseudonym";
import { HEREBIES } from "./herebies";
import {
  ConfirmationType,
  Confirmation,
  Conversation,
  ConversationStatus,
  ConversationSummary,
  CreateConversationInput,
  CreateConversationResult,
  EligibilityResult,
  GeoPoint,
  Message,
  Report,
  ReportTargetType,
  Thread,
  User,
} from "./types";

export { generatePseudonym };

// ---------------------------------------------------------------------------
// Row -> app-type mapping. supabase-js doesn't camelCase automatically, so
// every table/RPC row gets mapped explicitly here rather than scattered
// across call sites.
// ---------------------------------------------------------------------------

interface ConversationFlatRow {
  id: string;
  title: string;
  status: ConversationStatus;
  lat: number;
  lng: number;
  venue_id: string | null;
  road_label: string | null;
  discovery_radius_m: number;
  participation_radius_m: number;
  created_by: string;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
  activity_score: number;
  participant_count: number;
  messages_last_15min: number;
  thread_count: number;
  last_message_preview: string | null;
  is_participant: boolean | null;
}

function mapConversation(row: ConversationFlatRow, userLocation?: GeoPoint): ConversationSummary {
  const location: GeoPoint = { lat: row.lat, lng: row.lng };
  const dist = userLocation ? distanceMeters(location, userLocation) : undefined;
  const base: Conversation = {
    id: row.id,
    title: row.title,
    status: row.status,
    location,
    venueLabel: row.road_label ?? undefined,
    discoveryRadiusM: row.discovery_radius_m,
    participationRadiusM: row.participation_radius_m,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastActivityAt: row.last_activity_at,
    participantCount: row.participant_count,
    messagesLast15Min: row.messages_last_15min,
  };
  return {
    ...base,
    activityScore: row.activity_score,
    renderSize: computeRenderSize(row.activity_score, dist),
    lastMessagePreview: row.last_message_preview ?? undefined,
    threadCount: row.thread_count,
    isParticipant: !!row.is_participant,
  };
}

interface UsersRow {
  id: string;
  username: string;
  avatar_seed: string;
  avatar_icon: string | null;
  level: number;
  helpful_points: number;
  created_at: string;
  is_deleted: boolean;
}

function mapUser(row: UsersRow): User {
  return {
    id: row.id,
    username: row.username,
    avatarSeed: row.avatar_seed,
    avatarIcon: row.avatar_icon ?? undefined,
    level: row.level,
    helpfulPoints: row.helpful_points,
    createdAt: row.created_at,
    badgeIds: [],
  };
}

interface ThreadsRow {
  id: string;
  conversation_id: string;
  title: string;
  is_general: boolean;
  created_by: string;
  created_at: string;
  last_activity_at: string;
}

function mapThread(row: ThreadsRow): Thread {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    isGeneral: row.is_general,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

interface MessagesRow {
  id: string;
  conversation_id: string;
  thread_id: string;
  user_id: string;
  username: string;
  author_level: number;
  author_avatar_icon: string | null;
  body: string;
  reply_to_id: string | null;
  created_at: string;
  deleted_at: string | null;
  flagged: boolean;
}

function mapMessage(row: MessagesRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    userId: row.user_id,
    username: row.username,
    authorLevel: row.author_level,
    authorAvatarIcon: row.author_avatar_icon ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    replyToId: row.reply_to_id ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    flagged: row.flagged,
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function getUser(userId: string): Promise<User | undefined> {
  const { data, error } = await supabase.from("users").select().eq("id", userId).maybeSingle();
  if (error) raise(error);
  return data ? mapUser(data as UsersRow) : undefined;
}

export async function updateAvatarIcon(_userId: string, herebieId: string): Promise<User | undefined> {
  // update_avatar_icon() (schema.sql) acts on auth.uid()'s own row, not an
  // arbitrary target - _userId is kept in the signature only for parity
  // with mockBackend.ts; every call site already passes the caller's own id.
  // p_icon/avatar_icon predate Herebies (this used to store a raw emoji
  // string) - kept as-is rather than renamed throughout the DB/RPC, since
  // only the meaning of the stored text changed, not its shape.
  //
  // requiredLevel is looked up client-side from the same catalog the
  // Herebie picker itself renders from, rather than re-encoding an
  // id->level mapping in SQL as a second, drift-prone copy - see
  // schema.sql's update_avatar_icon for why (a hardcoded emoji-string CASE
  // match there previously broke every selection silently). An id not in
  // the catalog at all (shouldn't happen - the picker only ever sends real
  // ones) is treated as requiring an unreachable level, so the RPC's own
  // check still blocks it rather than defaulting to "always allowed."
  const requiredLevel = HEREBIES.find((h) => h.id === herebieId)?.levelRequired ?? 999;
  const { data, error } = await supabase.rpc("update_avatar_icon", { p_icon: herebieId, p_required_level: requiredLevel });
  if (error) raise(error);
  return data ? mapUser(data as UsersRow) : undefined;
}

// ---------------------------------------------------------------------------
// Map queries
// ---------------------------------------------------------------------------
export async function getVisibleConversations(userLocation: GeoPoint): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("nearby_conversations_by_participation", {
    p_lat: userLocation.lat,
    p_lng: userLocation.lng,
  });
  if (error) raise(error);
  return ((data ?? []) as ConversationFlatRow[])
    .map((row) => mapConversation(row, userLocation))
    .sort((a, b) => b.activityScore - a.activityScore);
}

export async function getConversation(id: string, userLocation?: GeoPoint): Promise<ConversationSummary | undefined> {
  const { data, error } = await supabase.rpc("get_conversation_by_id", { p_id: id });
  if (error) raise(error);
  return data ? mapConversation(data as ConversationFlatRow, userLocation) : undefined;
}

export async function suggestDuplicates(location: GeoPoint, title: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("suggest_duplicate_conversations", {
    p_lat: location.lat,
    p_lng: location.lng,
    p_title: title,
  });
  if (error) raise(error);
  return ((data ?? []) as ConversationFlatRow[]).map((row) => mapConversation(row, location));
}

export async function findConversationsToSupersede(location: GeoPoint, radiusM: number): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("conversations_to_supersede", {
    p_lat: location.lat,
    p_lng: location.lng,
    p_radius_m: radiusM,
  });
  if (error) raise(error);
  return ((data ?? []) as ConversationFlatRow[]).map((row) => mapConversation(row, location));
}

// PostgrestError (what `{ error }` actually is on every .from()/.rpc() call
// below) is a plain object, not a real Error - `err instanceof Error` at any
// call site's catch block is false for it, silently skipping straight past
// `err.message` to a generic fallback. Every throw site wraps through this
// so callers always get a genuine Error with the real message on it.
function raise(error: { message: string }): never {
  throw error instanceof Error ? error : new Error(error.message);
}

// supabase-js's default FunctionsHttpError.message is just "Edge Function
// returned a non-2xx status code" - useless for debugging or for showing
// the user what actually went wrong. The real message is the Edge
// Function's own response body (each function returns `new Response(msg, {
// status })` on failure, plain text - see supabase/functions/*/index.ts).
async function unwrapFunctionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.text().catch(() => "");
    return new Error(detail || error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

// The client (CreateConversationSheet.tsx) already calls suggestDuplicates/
// findConversationsToSupersede itself before ever reaching this, and shows
// the user those results. Always passing forceCreate: true here means this
// function creates unconditionally once called, rather than mockBackend.ts's
// createConversation, which redundantly re-runs its own internal duplicate
// check on every call with no way to bypass it - harmless in the mock, but
// on a real backend it means "create anyway" would never actually create
// anything (it would just re-show the same suggestions forever). The
// duplicate-check UX itself is unchanged; only this redundant second check
// is skipped.
export async function createConversation(input: CreateConversationInput): Promise<CreateConversationResult> {
  const { data, error } = await supabase.functions.invoke("createConversation", {
    body: {
      title: input.title,
      radiusM: input.radiusM,
      lat: input.location.lat,
      lng: input.location.lng,
      forceCreate: true,
    },
  });
  if (error) throw await unwrapFunctionError(error);
  if (data.suggestions) {
    return {
      suggestions: (data.suggestions as ConversationFlatRow[]).map((row) => mapConversation(row, input.location)),
      conversation: undefined,
    };
  }
  return {
    conversation: mapConversation(data.conversation as ConversationFlatRow, input.location),
    suggestions: [],
  };
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export async function createThread(conversationId: string, title: string, userId: string): Promise<Thread> {
  const { data, error } = await supabase
    .from("threads")
    .insert({ conversation_id: conversationId, title, created_by: userId })
    .select()
    .single();
  if (error) raise(error);
  return mapThread(data as ThreadsRow);
}

export async function getThreads(conversationId: string): Promise<Thread[]> {
  const { data, error } = await supabase
    .from("threads")
    .select()
    .eq("conversation_id", conversationId)
    .order("is_general", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) raise(error);
  return ((data ?? []) as ThreadsRow[]).map(mapThread);
}

// ---------------------------------------------------------------------------
// Eligibility / join / leave
// ---------------------------------------------------------------------------
async function invokeCheckEligibility(conversationId: string, rawLocation: GeoPoint): Promise<EligibilityResult> {
  const { data, error } = await supabase.functions.invoke("checkEligibility", {
    body: { conversationId, lat: rawLocation.lat, lng: rawLocation.lng },
  });
  if (error) throw await unwrapFunctionError(error);
  return data as EligibilityResult;
}

export async function checkEligibility(
  _userId: string,
  conversationId: string,
  rawLocation: GeoPoint
): Promise<EligibilityResult> {
  return invokeCheckEligibility(conversationId, rawLocation);
}

// checkEligibility's Edge Function already upserts conversation_participants
// as a side effect (see supabase/functions/checkEligibility/index.ts) -
// joining IS checking eligibility on the real backend, unlike the mock
// where they're two separate steps.
export async function joinConversation(
  _userId: string,
  conversationId: string,
  rawLocation: GeoPoint
): Promise<EligibilityResult> {
  return invokeCheckEligibility(conversationId, rawLocation);
}

export async function leaveConversation(_userId: string, conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_conversation", { p_conversation_id: conversationId });
  if (error) raise(error);
}

export async function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_conversation_muted", {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (error) raise(error);
}

export async function registerPushToken(expoPushToken: string): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", { p_expo_push_token: expoPushToken });
  if (error) raise(error);
}

// ---------------------------------------------------------------------------
// Messages / votes / confirmations
// ---------------------------------------------------------------------------
export async function getMessages(threadId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select()
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) raise(error);
  return ((data ?? []) as MessagesRow[]).map(mapMessage);
}

export async function sendMessage(
  threadId: string,
  user: User,
  body: string,
  replyToId?: string
): Promise<Message> {
  // username/author_level/author_avatar_icon/conversation_id are all
  // stamped server-side (trg_stamp_message_author, schema.sql) from the
  // CURRENT users/threads rows, ignoring whatever's sent here - a client
  // can't lie about its own level/icon in a message snapshot, and doesn't
  // need to know a thread's parent conversation_id to post into it.
  const { data, error } = await supabase
    .from("messages")
    .insert({ thread_id: threadId, user_id: user.id, body, reply_to_id: replyToId ?? null })
    .select()
    .single();
  if (error) raise(error);
  return mapMessage(data as MessagesRow);
}

export async function voteMessage(
  messageId: string,
  _userId: string,
  type: ConfirmationType
): Promise<{ upvotes: number; downvotes: number; myVote?: ConfirmationType }> {
  // vote_message() (schema.sql) is SECURITY DEFINER and resolves the acting
  // user from auth.uid() itself - _userId is kept for parity with
  // mockBackend.ts's signature, every call site already passes the current
  // user's own id.
  const { data, error } = await supabase.rpc("vote_message", { p_message_id: messageId, p_type: type });
  if (error) raise(error);
  const row = (data as { upvotes: number; downvotes: number; my_vote: ConfirmationType | null }[])[0];
  return { upvotes: row?.upvotes ?? 0, downvotes: row?.downvotes ?? 0, myVote: row?.my_vote ?? undefined };
}

export async function getConfirmations(messageId: string): Promise<Confirmation[]> {
  const { data, error } = await supabase.from("confirmations").select().eq("message_id", messageId);
  if (error) raise(error);
  return ((data ?? []) as { message_id: string; user_id: string; type: ConfirmationType }[]).map((r) => ({
    messageId: r.message_id,
    userId: r.user_id,
    type: r.type,
  }));
}

// Batched variant of getConfirmations - not part of mockBackend.ts's
// surface (the mock is synchronous in-memory, so an N-query loop cost it
// nothing there), added purely for real-network performance. Confirmed
// live: ConversationScreen's refreshMessages was firing one getConfirmations
// call per message on every thread switch and every 6s poll tick - 15+
// concurrent requests for a single screen refresh on an active thread,
// measured as several real seconds of added latency. One .in() query
// instead of N separate ones.
export async function getConfirmationsForMessages(messageIds: string[]): Promise<Record<string, Confirmation[]>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase.from("confirmations").select().in("message_id", messageIds);
  if (error) raise(error);
  const grouped: Record<string, Confirmation[]> = {};
  ((data ?? []) as { message_id: string; user_id: string; type: ConfirmationType }[]).forEach((r) => {
    const list = grouped[r.message_id] ?? (grouped[r.message_id] = []);
    list.push({ messageId: r.message_id, userId: r.user_id, type: r.type });
  });
  return grouped;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function reportTarget(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
  contextMessageId?: string
): Promise<void> {
  // No .select() here deliberately - reports has no SELECT policy for
  // authenticated (moderator-only, read only via the admin dashboard's
  // is_moderator()-gated RPCs). Postgres RLS applies SELECT policies to an
  // INSERT ... RETURNING clause too, so chaining .select().single() after
  // this insert throws even though the insert itself succeeds - confirmed
  // live as the reason a filed report never seemed to reach the dashboard
  // (neither call site awaited/caught this, so the error was silent).
  //
  // contextMessageId: only meaningful for a "user" report - the profile
  // card is only ever opened by tapping a specific message's author row
  // (ConversationScreen.tsx#openProfile), so the message that prompted the
  // report is already known at the moment of reporting. Gives the
  // dashboard something to show besides just a username.
  const { error } = await supabase
    .from("reports")
    .insert({
      reporter_id: reporterId,
      target_type: targetType,
      target_id: targetId,
      reason,
      context_message_id: contextMessageId ?? null,
    });
  if (error) raise(error);
}

// ---------------------------------------------------------------------------
// Realtime subscriptions - same (listener) => unsubscribe shape as
// mockBackend.ts's in-memory pub-sub, backed by Supabase Realtime channels
// instead. Listeners carry no payload; callers just refetch on signal,
// exactly as they already do against the mock. Requires conversations/
// threads/messages to be added to the supabase_realtime publication (see
// schema.sql) - a table not in that publication never fires change events.
// ---------------------------------------------------------------------------
let channelSeq = 0;
function uniqueChannelName(prefix: string): string {
  channelSeq += 1;
  return `${prefix}-${channelSeq}`;
}

export function subscribeToMap(listener: () => void): () => void {
  const channel = supabase
    .channel(uniqueChannelName("map"))
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => listener())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToConversation(conversationId: string, listener: () => void): () => void {
  const channel = supabase
    .channel(uniqueChannelName(`conversation-${conversationId}`))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
      () => listener()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "threads", filter: `conversation_id=eq.${conversationId}` },
      () => listener()
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToThread(threadId: string, listener: () => void): () => void {
  const channel = supabase
    .channel(uniqueChannelName(`thread-${threadId}`))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
      () => listener()
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
