// Shared domain types. These mirror the Postgres schema in
// supabase/schema.sql 1:1 on purpose, so the mock backend and a future real
// Supabase-backed implementation can share the same shapes.

export type ConversationCategory =
  | "micro_location" // gate, section, table
  | "venue" // terminal, stadium, convention center
  | "area" // festival, park, neighborhood event
  | "corridor"; // traffic, transit disruption

export type ConversationStatus =
  | "new"
  | "active"
  | "cooling_down"
  | "archived"
  | "deleted";

export type ParticipantState = "inside" | "grace" | "read_only" | "left";

export type ConfirmationType = "helpful" | "confirm" | "cannot_confirm" | "incorrect";

export type ReportTargetType = "message" | "user" | "conversation";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  username: string;
  avatarSeed: string;
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

export interface Conversation {
  id: string;
  title: string;
  category: ConversationCategory;
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
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  username: string;
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
}

export interface CreateConversationInput {
  title: string;
  category: ConversationCategory;
  location: GeoPoint;
  createdBy: string;
}

export interface CreateConversationResult {
  conversation?: ConversationSummary;
  suggestions: ConversationSummary[];
}
