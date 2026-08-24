// In-memory stand-in for the real backend described in the Phase 1
// architecture doc: Supabase Postgres/PostGIS + Realtime + Edge Functions.
//
// Every exported function here has the signature a real implementation
// would have (async, same inputs/outputs) so that swapping this module for
// src/services/supabaseBackend.ts later is mechanical - screens never talk
// to storage directly, only to this module's API.
//
// Two things this mock is careful to preserve from the real design, because
// they're the whole point of the privacy model:
//  1. Raw coordinates are never stored - only eligibility state is.
//  2. Conversation locations are generalized (snapped) before being stored.

import {
  Conversation,
  ConversationSummary,
  CreateConversationInput,
  CreateConversationResult,
  EligibilityResult,
  GeoPoint,
  Message,
  ParticipantState,
  Confirmation,
  ConfirmationType,
  Report,
  ReportTargetType,
  Thread,
  User,
} from "./types";
import { distanceMeters, snapToGrid, jitter } from "./geo";
import { computeActivityScore, computeRenderSize, minutesBetween, nextStatus } from "./activityScore";
import { SCENARIOS, ScenarioName } from "../dev/scenarios";
import { MIN_RADIUS_M, MAX_RADIUS_M } from "./clustering";
import { unlockedHerebies } from "./herebies";
import { generatePseudonym } from "./pseudonym";

// ---------------------------------------------------------------------------
// In-memory "clock" - lets dev mode fast-forward time without waiting.
// ---------------------------------------------------------------------------
let clockOffsetMs = 0;
export function now(): Date {
  return new Date(Date.now() + clockOffsetMs);
}
export function nowIso(): string {
  return now().toISOString();
}
export function advanceClockMinutes(minutes: number) {
  clockOffsetMs += minutes * 60 * 1000;
  recomputeAll();
  notifyMap();
}

// ---------------------------------------------------------------------------
// Radius-derived defaults, per Phase 1 sections 9 and 10 - originally 4
// fixed category tiers, now a continuous function of the chosen radius
// (see CreateConversationSheet's slider), linearly interpolated between the
// slider's own MIN/MAX_RADIUS_M bounds (clustering.ts).
// ---------------------------------------------------------------------------
function interpolateForRadius(radiusM: number, lo: number, hi: number): number {
  const t = Math.max(0, Math.min(1, (radiusM - MIN_RADIUS_M) / (MAX_RADIUS_M - MIN_RADIUS_M)));
  return lo + t * (hi - lo);
}

function graceMinutesForRadius(radiusM: number): number {
  return Math.round(interpolateForRadius(radiusM, 8, 35));
}

function ttlHoursForRadius(radiusM: number): number {
  return Math.round(interpolateForRadius(radiusM, 3, 10));
}

// How far away this chat can be surfaced as a possible duplicate when
// someone's about to create a similar one nearby (see suggestDuplicates) -
// deliberately wider than the participation radius itself.
function discoveryRadiusForRadius(radiusM: number): number {
  return Math.round(Math.max(150, radiusM * 4));
}

// Grid cell size used to generalize/snap a conversation's stored location
// (see snapToGrid). Scales with the chosen radius so the worst-case snap
// offset (~cellMeters * sqrt(2)/2, i.e. ~0.35x radius here) never approaches
// the participation radius itself - otherwise a chat's own creator could
// snap to just outside their own eligibility radius.
function snapCellForRadius(radiusM: number): number {
  return Math.min(120, radiusM * 0.5);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface ParticipantRecord {
  userId: string;
  state: ParticipantState;
  joinedAt: string;
  graceStartedAt?: string;
}

const users = new Map<string, User>();
const conversations = new Map<string, Conversation>();
const threads = new Map<string, Thread>();
const messages = new Map<string, Message[]>(); // threadId -> messages
const participants = new Map<string, Map<string, ParticipantRecord>>(); // conversationId -> userId -> record
const confirmations = new Map<string, Confirmation[]>(); // messageId -> confirmations
const reports: Report[] = [];
const blocks = new Map<string, Set<string>>(); // blockerId -> blockedIds

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}_${idCounter++}`;
}

type Listener = () => void;
const mapListeners = new Set<Listener>();
const conversationListeners = new Map<string, Set<Listener>>();
const threadListeners = new Map<string, Set<Listener>>();

function notifyMap() {
  mapListeners.forEach((l) => l());
}
function notifyConversation(conversationId: string) {
  conversationListeners.get(conversationId)?.forEach((l) => l());
}
function notifyThread(threadId: string) {
  threadListeners.get(threadId)?.forEach((l) => l());
}

export function subscribeToMap(listener: Listener): () => void {
  mapListeners.add(listener);
  return () => mapListeners.delete(listener);
}
export function subscribeToConversation(conversationId: string, listener: Listener): () => void {
  if (!conversationListeners.has(conversationId)) conversationListeners.set(conversationId, new Set());
  conversationListeners.get(conversationId)!.add(listener);
  return () => conversationListeners.get(conversationId)?.delete(listener);
}
export function subscribeToThread(threadId: string, listener: Listener): () => void {
  if (!threadListeners.has(threadId)) threadListeners.set(threadId, new Set());
  threadListeners.get(threadId)!.add(listener);
  return () => threadListeners.get(threadId)?.delete(listener);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export { generatePseudonym } from "./pseudonym";

// Levels/badges should be "few and legible" per Phase 1 section 11 - 5
// levels, driven only by helpfulPoints (never raw message/join counts, to
// avoid rewarding volume over quality).
const LEVEL_THRESHOLDS = [0, 5, 15, 40, 100];
export function computeLevel(helpfulPoints: number): number {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (helpfulPoints >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  return level;
}

export async function createUser(username?: string): Promise<User> {
  const id = nextId("user");
  const user: User = {
    id,
    username: username ?? generatePseudonym(),
    avatarSeed: id,
    level: 1,
    helpfulPoints: 0,
    createdAt: nowIso(),
    badgeIds: [],
  };
  users.set(id, user);
  return user;
}

// Registers a user created by a real backend (see authService.ts) into the
// mock's own user store, so mock-backed functions that look authors up here
// - voteMessage bumping helpfulPoints/level, most notably - keep working for
// a real user mixed in with the mock's synthetic ones.
export function registerUser(user: User): void {
  users.set(user.id, user);
}

export async function getUser(userId: string): Promise<User | undefined> {
  return users.get(userId);
}

// Only ever sets a Herebie the user has actually unlocked at their current
// level (see herebies.ts#unlockedHerebies) - defends against a stale
// picker selection made before a level dropped out of sync client-side.
//
// Returns a new object (rather than mutating in place, unlike voteMessage's
// helpfulPoints/level update below) and replaces the map entry with that
// same object - callers hand this straight to setState, and React bails out
// of re-rendering when a setState call receives a reference-identical
// object, so a same-reference mutation here would sit invisible until some
// unrelated re-render happened to catch up. Replacing the map entry with
// this exact object (not a second, detached copy) keeps voteMessage's
// later in-place mutations landing on the object the UI is actually holding.
export async function updateAvatarIcon(userId: string, herebieId: string): Promise<User | undefined> {
  const user = users.get(userId);
  if (!user) return undefined;
  if (!unlockedHerebies(user.level).some((h) => h.id === herebieId)) return user;
  const updated: User = { ...user, avatarIcon: herebieId };
  users.set(userId, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Activity recompute (mirrors the pg_cron recomputeActivity job)
// ---------------------------------------------------------------------------
function recomputeAll() {
  const n = nowIso();
  for (const conv of conversations.values()) {
    const score = computeActivityScore(conv, n);
    const idleMin = minutesBetween(conv.lastActivityAt, n);
    const pastExpiry = new Date(conv.expiresAt).getTime() <= now().getTime();
    conv.status = nextStatus(conv.status, score, idleMin, pastExpiry);
  }
}

function getConversationThreads(conversationId: string): Thread[] {
  return Array.from(threads.values()).filter((t) => t.conversationId === conversationId);
}

function getConversationMessages(conversationId: string): Message[] {
  return getConversationThreads(conversationId).flatMap((t) => messages.get(t.id) ?? []);
}

function toSummary(conv: Conversation, userLocation?: GeoPoint): ConversationSummary {
  const score = computeActivityScore(conv, nowIso());
  const dist = userLocation ? distanceMeters(conv.location, userLocation) : undefined;
  const convThreads = getConversationThreads(conv.id);
  const convMessages = convThreads.flatMap((t) => messages.get(t.id) ?? []);
  const last = convMessages.reduce<Message | undefined>(
    (latest, m) => (!latest || m.createdAt > latest.createdAt ? m : latest),
    undefined
  );
  return {
    ...conv,
    activityScore: score,
    renderSize: computeRenderSize(score, dist),
    lastMessagePreview: last ? `${last.username}: ${last.body}` : undefined,
    threadCount: convThreads.length,
    // No UI that reads isParticipant is ever wired to mockBackend (only
    // DevPanelScreen's dev*-prefixed exports are) - static false just
    // satisfies the shared ConversationSummary shape.
    isParticipant: false,
  };
}

// ---------------------------------------------------------------------------
// Map queries
// ---------------------------------------------------------------------------
// Visibility is eligibility-gated, not merely proximity-gated: a conversation
// only appears for a location if that location would register as "inside"
// it (see checkEligibility) - same radius, same rule, at every category
// tier. There is no separate "discovery radius" that lets you see a chat
// exists before you're actually within it.
export async function getVisibleConversations(userLocation: GeoPoint): Promise<ConversationSummary[]> {
  recomputeAll();
  return Array.from(conversations.values())
    .filter((c) => c.status !== "archived" && c.status !== "deleted")
    .filter((c) => distanceMeters(c.location, userLocation) <= c.participationRadiusM)
    .map((c) => toSummary(c, userLocation))
    .sort((a, b) => b.activityScore - a.activityScore);
}

export async function getConversation(id: string, userLocation?: GeoPoint): Promise<ConversationSummary | undefined> {
  const c = conversations.get(id);
  if (!c) return undefined;
  return toSummary(c, userLocation);
}

// ---------------------------------------------------------------------------
// Duplicate suggestion - naive keyword + proximity match, as specified in
// Phase 1 section 3 (explicitly not semantic/embedding-based for MVP).
// Radius is now arbitrary per chat rather than one of a few fixed tiers, so
// there's no meaningful "same category" filter anymore - proximity
// (against the candidate's own discoveryRadiusM) plus keyword overlap is
// the whole match now.
// ---------------------------------------------------------------------------
function keywordOverlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let shared = 0;
  wa.forEach((w) => {
    if (wb.has(w)) shared++;
  });
  return shared / Math.max(1, Math.min(wa.size, wb.size));
}

export async function suggestDuplicates(
  location: GeoPoint,
  title: string
): Promise<ConversationSummary[]> {
  return Array.from(conversations.values())
    .filter((c) => c.status !== "archived" && c.status !== "deleted")
    .filter((c) => distanceMeters(c.location, location) <= c.discoveryRadiusM)
    .map((c) => ({ conv: c, overlap: keywordOverlap(c.title, title) }))
    .filter((x) => x.overlap > 0.25)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3)
    .map((x) => toSummary(x.conv, location));
}

// ---------------------------------------------------------------------------
// Supersession warning - a new conversation at this location/radius would
// immediately become the "macro chat" (see clustering.ts's
// supersedeBroaderConversations) for any existing, smaller-radius
// conversation whose location falls within its own participation radius.
// Checked at creation time so the creator can confirm that's intended
// before it happens.
// ---------------------------------------------------------------------------
export async function findConversationsToSupersede(
  location: GeoPoint,
  radiusM: number
): Promise<ConversationSummary[]> {
  return Array.from(conversations.values())
    .filter((c) => c.status !== "archived" && c.status !== "deleted")
    .filter((c) => c.participationRadiusM < radiusM)
    .filter((c) => distanceMeters(c.location, location) <= radiusM)
    .map((c) => toSummary(c, location));
}

export async function createConversation(input: CreateConversationInput): Promise<CreateConversationResult> {
  const suggestions = await suggestDuplicates(input.location, input.title);
  if (suggestions.length > 0) {
    // Real behavior: return suggestions and let the client prompt
    // "join one of these instead?" before calling createConversation again
    // with a forceCreate flag. Kept simple here: caller decides.
    return { suggestions };
  }

  const id = nextId("conv");
  const snapped = snapToGrid(input.location, snapCellForRadius(input.radiusM));
  const n = nowIso();
  const conv: Conversation = {
    id,
    title: input.title,
    status: "new",
    location: snapped,
    venueLabel: undefined,
    discoveryRadiusM: discoveryRadiusForRadius(input.radiusM),
    participationRadiusM: input.radiusM,
    createdBy: input.createdBy,
    createdAt: n,
    expiresAt: new Date(now().getTime() + ttlHoursForRadius(input.radiusM) * 3600 * 1000).toISOString(),
    lastActivityAt: n,
    participantCount: 0,
    messagesLast15Min: 0,
  };
  conversations.set(id, conv);
  participants.set(id, new Map());
  createThreadRecord(id, "General", input.createdBy, true);
  notifyMap();
  return { conversation: toSummary(conv, input.location), suggestions: [] };
}

// ---------------------------------------------------------------------------
// Threads - every conversation always has exactly one "General" thread
// (created alongside the conversation, cannot be removed); participants can
// spin up additional threads scoped to the same location conversation.
// ---------------------------------------------------------------------------
function createThreadRecord(conversationId: string, title: string, createdBy: string, isGeneral: boolean): Thread {
  const id = nextId("thread");
  const n = nowIso();
  const thread: Thread = { id, conversationId, title, isGeneral, createdBy, createdAt: n, lastActivityAt: n };
  threads.set(id, thread);
  messages.set(id, []);
  return thread;
}

export async function createThread(conversationId: string, title: string, userId: string): Promise<Thread> {
  const thread = createThreadRecord(conversationId, title, userId, false);
  notifyConversation(conversationId);
  notifyMap();
  return thread;
}

export async function getThreads(conversationId: string): Promise<Thread[]> {
  return getConversationThreads(conversationId).sort((a, b) => {
    if (a.isGeneral !== b.isGeneral) return a.isGeneral ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

// ---------------------------------------------------------------------------
// Eligibility / join / leave - the one part of the mock that most carefully
// mirrors "never trust the client." The caller passes a raw coordinate; this
// function is the only place that ever sees it, and it is not persisted -
// only the resulting state is.
// ---------------------------------------------------------------------------
export async function checkEligibility(
  userId: string,
  conversationId: string,
  rawLocation: GeoPoint
): Promise<EligibilityResult> {
  const conv = conversations.get(conversationId);
  if (!conv) return { state: "left", canPost: false, canRead: false, muted: false };

  const graceMin = graceMinutesForRadius(conv.participationRadiusM);
  const dist = distanceMeters(rawLocation, conv.location); // computed, then rawLocation is discarded
  const convParticipants = participants.get(conversationId)!;
  const existing = convParticipants.get(userId);

  const inside = dist <= conv.participationRadiusM;

  let state: ParticipantState;
  if (inside) {
    state = "inside";
  } else if (existing && (existing.state === "inside" || existing.state === "grace")) {
    const graceStart = existing.graceStartedAt ?? nowIso();
    const minutesInGrace = minutesBetween(graceStart, nowIso());
    if (minutesInGrace <= graceMin) {
      state = "grace";
      convParticipants.set(userId, { ...existing, state, graceStartedAt: graceStart });
    } else {
      state = "read_only";
      convParticipants.set(userId, { ...existing, state });
    }
  } else if (existing) {
    state = "read_only";
  } else {
    // Never been inside: can see (discovery radius already filtered this in
    // getVisibleConversations) but cannot join to post from outside the
    // participation radius.
    state = "read_only";
  }

  return {
    state,
    canPost: state === "inside" || state === "grace",
    canRead: true,
    // No mute UI/flow exists in dev mode (ConversationScreen only ever
    // imports supabaseBackend, never mockBackend, so nothing exercises this
    // in practice) - static false just satisfies the shared EligibilityResult
    // shape.
    muted: false,
  };
}

export async function joinConversation(
  userId: string,
  conversationId: string,
  rawLocation: GeoPoint
): Promise<EligibilityResult> {
  const eligibility = await checkEligibility(userId, conversationId, rawLocation);
  const convParticipants = participants.get(conversationId)!;
  const existing = convParticipants.get(userId);
  convParticipants.set(userId, {
    userId,
    state: eligibility.state,
    joinedAt: existing?.joinedAt ?? nowIso(),
    graceStartedAt: eligibility.state === "grace" ? existing?.graceStartedAt ?? nowIso() : undefined,
  });
  recomputeParticipantCount(conversationId);
  notifyMap();
  notifyConversation(conversationId);
  return eligibility;
}

export async function leaveConversation(userId: string, conversationId: string): Promise<void> {
  const convParticipants = participants.get(conversationId);
  convParticipants?.delete(userId);
  recomputeParticipantCount(conversationId);
  notifyMap();
  notifyConversation(conversationId);
}

function recomputeParticipantCount(conversationId: string) {
  const conv = conversations.get(conversationId);
  const convParticipants = participants.get(conversationId);
  if (!conv || !convParticipants) return;
  conv.participantCount = Array.from(convParticipants.values()).filter(
    (p) => p.state === "inside" || p.state === "grace"
  ).length;
}

export function getParticipantState(userId: string, conversationId: string): ParticipantState | undefined {
  return participants.get(conversationId)?.get(userId)?.state;
}

// ---------------------------------------------------------------------------
// Messages / reactions / confirmations
// ---------------------------------------------------------------------------
export async function getMessages(threadId: string): Promise<Message[]> {
  return messages.get(threadId) ?? [];
}

export async function sendMessage(
  threadId: string,
  user: User,
  body: string,
  replyToId?: string
): Promise<Message> {
  const thread = threads.get(threadId);
  if (!thread) throw new Error(`Unknown thread: ${threadId}`);

  const msg: Message = {
    id: nextId("msg"),
    conversationId: thread.conversationId,
    threadId,
    userId: user.id,
    username: user.username,
    authorLevel: user.level,
    authorAvatarIcon: user.avatarIcon,
    body,
    createdAt: nowIso(),
    replyToId,
  };
  const list = messages.get(threadId) ?? [];
  list.push(msg);
  messages.set(threadId, list);
  thread.lastActivityAt = msg.createdAt;

  const conv = conversations.get(thread.conversationId);
  if (conv) {
    conv.lastActivityAt = msg.createdAt;
    conv.messagesLast15Min = getConversationMessages(thread.conversationId).filter(
      (m) => minutesBetween(m.createdAt, nowIso()) <= 15
    ).length;
  }
  notifyMap();
  notifyConversation(thread.conversationId);
  notifyThread(threadId);
  return msg;
}

function pointsForVote(type: ConfirmationType): number {
  return type === "upvote" ? 1 : -1;
}

/**
 * Reddit-style up/down vote on a message - never reorders anything, only
 * feeds the author's helpfulPoints/level (computeLevel). Any click while a
 * vote is already active - same direction or the opposite one - just clears
 * it back to neutral; a vote is only ever applied by clicking while neutral.
 * That means switching your vote from up to down takes two clicks (cancel,
 * then apply) rather than jumping straight from +1 to -1 in one - the net
 * score always passes through 0 instead of skipping it. helpfulPoints is
 * floored at 0 so a pile-on of downvotes can't push an author deeply
 * negative.
 */
export async function voteMessage(
  messageId: string,
  userId: string,
  type: ConfirmationType
): Promise<{ upvotes: number; downvotes: number; myVote?: ConfirmationType }> {
  const list = confirmations.get(messageId) ?? [];
  const existing = list.find((c) => c.userId === userId);
  const withoutUser = list.filter((c) => c.userId !== userId);
  const applying = !existing;
  if (applying) {
    withoutUser.push({ messageId, userId, type });
  }
  confirmations.set(messageId, withoutUser);

  const allMessages = Array.from(messages.values()).flat();
  const msg = allMessages.find((m) => m.id === messageId);
  if (msg) {
    const author = users.get(msg.userId);
    if (author) {
      const oldDelta = existing ? pointsForVote(existing.type) : 0;
      const newDelta = applying ? pointsForVote(type) : 0;
      author.helpfulPoints = Math.max(0, author.helpfulPoints + newDelta - oldDelta);
      author.level = computeLevel(author.helpfulPoints);
    }
    notifyConversation(msg.conversationId);
    notifyThread(msg.threadId);
  }

  return {
    upvotes: withoutUser.filter((c) => c.type === "upvote").length,
    downvotes: withoutUser.filter((c) => c.type === "downvote").length,
    myVote: applying ? type : undefined,
  };
}

export async function getConfirmations(messageId: string): Promise<Confirmation[]> {
  return confirmations.get(messageId) ?? [];
}

// ---------------------------------------------------------------------------
// Reports / blocks
// ---------------------------------------------------------------------------
export async function reportTarget(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string
): Promise<Report> {
  const report: Report = {
    id: nextId("report"),
    reporterId,
    targetType,
    targetId,
    reason,
    createdAt: nowIso(),
    status: "open",
  };
  reports.push(report);
  return report;
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (!blocks.has(blockerId)) blocks.set(blockerId, new Set());
  blocks.get(blockerId)!.add(blockedId);
}

export function isBlocked(blockerId: string, otherUserId: string): boolean {
  return blocks.get(blockerId)?.has(otherUserId) ?? false;
}

// ---------------------------------------------------------------------------
// Dev / simulator mode - see src/dev for the UI. These functions are the
// same "seams" a QA or load-testing harness would use against a real
// backend's admin/test endpoints.
// ---------------------------------------------------------------------------
export async function devAddSyntheticParticipant(conversationId: string): Promise<void> {
  const user = await createUser();
  const conv = conversations.get(conversationId);
  if (!conv) return;
  await joinConversation(user.id, conversationId, jitter(conv.location, conv.participationRadiusM * 0.6));
}

export async function devAddSyntheticMessage(conversationId: string, body?: string): Promise<void> {
  const generalThread = getConversationThreads(conversationId).find((t) => t.isGeneral);
  if (!generalThread) return;

  const convParticipants = participants.get(conversationId);
  let userId = convParticipants && Array.from(convParticipants.keys())[0];
  let user: User | undefined = userId ? users.get(userId) : undefined;
  if (!user) {
    user = await createUser();
    const conv = conversations.get(conversationId);
    if (conv) await joinConversation(user.id, conversationId, conv.location);
  }
  await sendMessage(generalThread.id, user, body ?? "Anyone have an update?");
}

// Bulk participant seeding for demo purposes. Bypasses the full
// joinConversation path (which notifies on every call) - at counts in the
// hundreds/thousands that would mean that many redundant re-renders, so this
// sets participant records directly and notifies once at the end instead.
// Jittering within 0.6x the radius (same bound devAddSyntheticParticipant
// uses) makes "inside" a safe assumption without an eligibility check per
// participant.
export async function devSeedParticipants(conversationId: string, count: number): Promise<void> {
  const conv = conversations.get(conversationId);
  const convParticipants = participants.get(conversationId);
  if (!conv || !convParticipants) return;
  for (let i = 0; i < count; i++) {
    const user = await createUser();
    convParticipants.set(user.id, {
      userId: user.id,
      state: "inside",
      joinedAt: nowIso(),
      graceStartedAt: undefined,
    });
  }
  recomputeParticipantCount(conversationId);
  notifyMap();
  notifyConversation(conversationId);
}

const FOO_FIGHTERS_THREADS: { title: string; messages: string[] }[] = [
  {
    title: "🚗 Parking / Traffic",
    messages: [
      "Prairie Ave lot is already half full, get here early",
      "Lot C is closed for VIP tonight, use Lot D instead",
    ],
  },
  {
    title: "🎸 Set Times",
    messages: ["Doors at 5:30, opener at 7, Foo Fighters at 8:45", "Looks like no opener tonight, just FF at 8"],
  },
  {
    title: "🎟️ Venue Questions",
    messages: [
      "Will call is at the north box office, not the main gate",
      "Bag policy is clear bags only, they're checking hard tonight",
    ],
  },
  {
    title: "🍺 Food & Drinks",
    messages: [
      "Beer lines on the club level are way shorter right now",
      "Loaded fries stand by section 120 is open, no line yet",
    ],
  },
  {
    title: "🚕 Rideshare",
    messages: [
      "Uber/Lyft pickup moved to Lot J, not the main entrance",
      "Surge already at 2.5x - might be faster to walk to Lot P",
    ],
  },
  {
    title: "🛍️ Merch",
    messages: [
      "Merch tent by gate 3 still has tour shirts, gate 1 sold out of mediums",
      "They're taking Apple Pay at the merch stands now, not just cash",
    ],
  },
];

async function seedThreadMessages(conversationId: string, threadId: string, lines: string[]): Promise<void> {
  const conv = conversations.get(conversationId);
  if (!conv) return;
  for (const line of lines) {
    const user = await createUser();
    await joinConversation(user.id, conversationId, conv.location);
    await sendMessage(threadId, user, line);
  }
}

// One-off demo seeding for an already-created conversation: a large
// participant count plus a set of topic threads (parking, set times, etc.),
// each pre-seeded with a couple of realistic messages - built for taking
// representative screenshots of a big, active event chat.
export async function devSeedFooFightersDemo(conversationId: string): Promise<void> {
  await devSeedParticipants(conversationId, 1400);

  const generalThread = getConversationThreads(conversationId).find((t) => t.isGeneral);
  if (generalThread) {
    await seedThreadMessages(conversationId, generalThread.id, ["Anyone else here early?", "This crowd is huge tonight"]);
  }

  for (const { title, messages } of FOO_FIGHTERS_THREADS) {
    const thread = await createThread(conversationId, title, "seed");
    await seedThreadMessages(conversationId, thread.id, messages);
  }
}

export async function devExpireConversation(conversationId: string): Promise<void> {
  const conv = conversations.get(conversationId);
  if (!conv) return;
  conv.expiresAt = nowIso();
  recomputeAll();
  notifyMap();
}

export async function devLoadScenario(name: ScenarioName, center: GeoPoint): Promise<void> {
  const scenario = SCENARIOS[name];
  for (const seed of scenario.conversations) {
    const location = { lat: center.lat + seed.dLat, lng: center.lng + seed.dLng };
    const result = await createConversation({
      title: seed.title,
      radiusM: seed.radiusM,
      location,
      createdBy: "seed",
    });
    if (!result.conversation) continue;
    const convId = result.conversation.id;
    // backdate creation slightly and seed participants/messages so the
    // scenario doesn't render as suspiciously brand-new
    const convRecord = conversations.get(convId)!;
    convRecord.createdAt = new Date(now().getTime() - seed.ageMinutes * 60000).toISOString();
    convRecord.lastActivityAt = new Date(now().getTime() - Math.min(seed.ageMinutes, 2) * 60000).toISOString();
    for (let i = 0; i < seed.participants; i++) {
      await devAddSyntheticParticipant(convId);
    }
    for (const line of seed.seedMessages) {
      await devAddSyntheticMessage(convId, line);
    }
  }
  notifyMap();
}

export function devResetAll(): void {
  users.clear();
  conversations.clear();
  threads.clear();
  messages.clear();
  participants.clear();
  confirmations.clear();
  reports.length = 0;
  blocks.clear();
  clockOffsetMs = 0;
  notifyMap();
}

export function devListConversationIds(): string[] {
  return Array.from(conversations.keys());
}

export function devListConversations(): { id: string; title: string }[] {
  return Array.from(conversations.values()).map((c) => ({ id: c.id, title: c.title }));
}
