import { Conversation, ConversationStatus, GeoPoint } from "./types";
import { distanceMeters } from "./geo";

// Implements the scoring model from the Phase 1 doc, section 6:
//
//   score = w1*log(1 + participants)
//         + w2*log(1 + messagesLast15Min)
//         - w3*minutesSinceLastMessage
//         + w4*recencyBoost(createdAt)
//
// In the real system this same computation runs server-side on a schedule
// (Supabase pg_cron -> recomputeActivity Edge Function) and is broadcast to
// clients over a realtime channel; distance-based rendering adjustments stay
// client-only. Here it's called synchronously by the mock backend and by UI
// components so the whole app agrees on one implementation.

const W_PARTICIPANTS = 2.4;
const W_MESSAGES = 2.0;
const W_IDLE_PENALTY = 0.12;
const W_RECENCY_BOOST = 1.2;
const RECENCY_WINDOW_MIN = 6;

const MIN_RENDER_SIZE = 30;
const MAX_RENDER_SIZE = 78;
const RENDER_K = 16;

const CARD_MIN_WIDTH = 96;
const CARD_MAX_WIDTH = 168;

export function minutesBetween(aIso: string, bIso: string): number {
  return Math.max(0, (new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000);
}

export function computeActivityScore(
  conversation: Pick<
    Conversation,
    "participantCount" | "messagesLast15Min" | "createdAt" | "lastActivityAt"
  >,
  nowIso: string
): number {
  const minutesSinceLastMessage = minutesBetween(conversation.lastActivityAt, nowIso);
  const minutesSinceCreated = minutesBetween(conversation.createdAt, nowIso);
  const recencyBoost = Math.max(0, RECENCY_WINDOW_MIN - minutesSinceCreated) * W_RECENCY_BOOST;

  const raw =
    W_PARTICIPANTS * Math.log(1 + conversation.participantCount) +
    W_MESSAGES * Math.log(1 + conversation.messagesLast15Min) -
    W_IDLE_PENALTY * minutesSinceLastMessage +
    recencyBoost;

  return Math.max(0, raw);
}

/** Cosmetic-only scale. Distance can nudge the render size but never the canonical score. */
export function computeRenderSize(
  score: number,
  distanceFromUserM?: number
): number {
  const proximityBoost =
    distanceFromUserM !== undefined ? Math.max(0, 1 - distanceFromUserM / 3000) * 6 : 0;
  const size = MIN_RENDER_SIZE + RENDER_K * Math.log(1 + score) + proximityBoost;
  return Math.min(MAX_RENDER_SIZE, Math.max(MIN_RENDER_SIZE, size));
}

/**
 * Maps a render size (see computeRenderSize) to a card width for the map
 * markers. Markers are info cards, not plain dots - text needs to stay at a
 * fixed, readable size regardless of activity, so activity is expressed as
 * card width instead of font size or a shrinking circle.
 */
export function computeCardWidth(renderSize: number): number {
  const t = (renderSize - MIN_RENDER_SIZE) / (MAX_RENDER_SIZE - MIN_RENDER_SIZE);
  return CARD_MIN_WIDTH + t * (CARD_MAX_WIDTH - CARD_MIN_WIDTH);
}

export function heatLevel(score: number): "new" | "active" | "hot" {
  if (score > 9) return "hot";
  if (score > 4) return "active";
  return "new";
}

/**
 * Lifecycle transition, mirrors the pg_cron sweep described in the
 * architecture doc: new -> active -> cooling_down -> archived, plus a hard
 * TTL cut. This function is pure so it's trivially unit-testable.
 *
 * The TTL cut is withheld while anyone is still an active participant
 * (participantCount > 0, i.e. state 'inside' or 'grace') - a chat with
 * someone actually still in it doesn't get swept out from under them just
 * because its clock ran out. It archives on the first sweep after the last
 * participant's state genuinely drops to 0. This relies on that count being
 * accurate: a participant whose app never re-checks eligibility (screen
 * closed, app backgrounded) keeps whatever state it last had indefinitely
 * (see checkEligibility's Edge Function) - so a stale "inside" row would
 * also indefinitely block this expiry, not just undercount who's present.
 */
export function nextStatus(
  current: ConversationStatus,
  score: number,
  minutesSinceLastMessage: number,
  isPastExpiry: boolean,
  participantCount: number
): ConversationStatus {
  if (isPastExpiry && participantCount === 0) return "archived";
  if (current === "deleted" || current === "archived") return current;
  if (score < 1.5 && minutesSinceLastMessage > 45) return "cooling_down";
  if (score >= 4) return "active";
  if (current === "active" || current === "cooling_down") {
    return score < 1.5 ? "cooling_down" : "active";
  }
  return "new";
}

export function distanceFromUser(point: GeoPoint, user?: GeoPoint): number | undefined {
  if (!user) return undefined;
  return distanceMeters(point, user);
}
