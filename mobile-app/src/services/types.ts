// Shared domain types. These mirror the Postgres schema in
// supabase/schema.sql 1:1 on purpose, so the mock backend and a future real
// Supabase-backed implementation can share the same shapes.

export type ConversationStatus =
  | "new"
  | "active"
  | "cooling_down"
  | "archived"
  | "deleted";

export type ParticipantState = "inside" | "grace" | "read_only" | "left";

// Reddit-style vote on a message. Never reorders messages - it's purely a
// signal that feeds the author's helpfulPoints/level (see
// mockBackend.ts#voteMessage, computeLevel).
export type ConfirmationType = "upvote" | "downvote";

export type ReportTargetType = "message" | "user" | "conversation";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  username: string;
  avatarSeed: string;
  // Chosen unlockable icon (see avatarIcons.ts) - undefined until the user
  // picks one, which falls back to initials-in-a-circle.
  avatarIcon?: string;
  level: number;
  helpfulPoints: number;
  createdAt: string; // ISO timestamp, only "member since" is ever shown publicly
  badgeIds: string[];
}

// The private trust score. Never sent to any client UI in the real system —
// included here only so the mock backend has somewhere to model it.
export interface UserTrustScore {
  userId: string;
  trustScore: number;
  signals: Record<string, number>;
}

export interface Badge {
  id: string;
  code: string;
  label: string;
  icon: string;
}

export interface Thread {
  id: string;
  conversationId: string;
  title: string;
  isGeneral: boolean;
  createdBy: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  status: ConversationStatus;
  location: GeoPoint; // already generalized/snapped - never a raw creator coordinate
  venueLabel?: string; // e.g. "Terminal B", "I-90 corridor"
  discoveryRadiusM: number;
  participationRadiusM: number;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  // Fields the activity score is computed from (see services/activityScore.ts)
  participantCount: number;
  messagesLast15Min: number;
}

export interface ConversationSummary extends Conversation {
  activityScore: number;
  renderSize: number;
  lastMessagePreview?: string;
  threadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  threadId: string;
  userId: string;
  username: string;
  // Author's level at send time (see mockBackend.ts#computeLevel) - a
  // snapshot, like username, not a live-updating value. A user leveling up
  // doesn't retroactively relabel their older messages.
  authorLevel: number;
  // Same snapshot treatment for the author's chosen avatar icon.
  authorAvatarIcon?: string;
  body: string;
  createdAt: string;
  replyToId?: string;
  deletedAt?: string;
  flagged?: boolean;
}

export interface Reaction {
  messageId: string;
  userId: string;
  type: string; // e.g. "up", "laugh"
}

export interface Confirmation {
  messageId: string;
  userId: string;
  type: ConfirmationType;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  createdAt: string;
  status: "open" | "upheld" | "dismissed";
}

export interface EligibilityResult {
  state: ParticipantState;
  canPost: boolean;
  canRead: boolean;
  muted: boolean;
}

export interface CreateConversationInput {
  title: string;
  radiusM: number;
  location: GeoPoint;
  createdBy: string;
}

export interface CreateConversationResult {
  conversation?: ConversationSummary;
  suggestions: ConversationSummary[];
}
