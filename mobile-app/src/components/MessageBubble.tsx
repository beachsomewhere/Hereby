import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ConfirmationType, Message } from "../services/types";
import { Avatar } from "./Avatar";
import { maskProfanity } from "../services/profanityFilter";

interface Props {
  message: Message;
  isOwn: boolean;
  isReported?: boolean;
  replyToMessage?: Message;
  onVote: (type: ConfirmationType) => void;
  onReport: () => void;
  onReply: () => void;
  onOpenProfile: () => void;
  upvotes?: number;
  downvotes?: number;
  myVote?: ConfirmationType;
}

function MessageBubbleImpl({
  message,
  isOwn,
  isReported,
  replyToMessage,
  onVote,
  onReport,
  onReply,
  onOpenProfile,
  upvotes = 0,
  downvotes = 0,
  myVote,
}: Props) {
  const [showActions, setShowActions] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const netVotes = upvotes - downvotes;

  // A reported message stays in place (so the conversation doesn't visibly
  // jump/reflow) but its content is replaced entirely - visible that
  // something was here and hidden, without still showing what it said.
  if (isReported) {
    return (
      <View style={[styles.row, isOwn && styles.rowOwn]}>
        <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
          <Text style={[styles.reportedText, isOwn && styles.reportedTextOwn]}>Message reported</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
        <Pressable onPress={onOpenProfile} style={styles.authorRow}>
          <Avatar username={message.username} avatarIcon={message.authorAvatarIcon} size={18} />
          <Text style={[styles.username, isOwn && styles.usernameOwn]}>
            {message.username} <Text style={[styles.level, isOwn && styles.levelOwn]}>· Lv {message.authorLevel}</Text>
          </Text>
        </Pressable>

        {replyToMessage && (
          <View style={[styles.replyQuote, isOwn && styles.replyQuoteOwn]}>
            <Text style={[styles.replyQuoteText, isOwn && styles.replyQuoteTextOwn]} numberOfLines={1}>
              ↩ {replyToMessage.username}: {maskProfanity(replyToMessage.body)}
            </Text>
          </View>
        )}

        <Text style={[styles.body, isOwn && styles.bodyOwn]}>{maskProfanity(message.body)}</Text>

        <View style={styles.metaRow}>
          <View style={styles.voteRow}>
            <Pressable
              onPress={() => onVote("upvote")}
              hitSlop={8}
              style={[styles.voteButton, myVote === "upvote" && styles.voteButtonUpActive]}
            >
              <Text style={[styles.voteButtonText, myVote === "upvote" && styles.voteButtonTextUpActive]}>▲</Text>
            </Pressable>
            <Text style={[styles.voteCount, isOwn && styles.voteCountOwn]}>{netVotes}</Text>
            <Pressable
              onPress={() => onVote("downvote")}
              hitSlop={8}
              style={[styles.voteButton, myVote === "downvote" && styles.voteButtonDownActive]}
            >
              <Text style={[styles.voteButtonText, myVote === "downvote" && styles.voteButtonTextDownActive]}>▼</Text>
            </Pressable>
          </View>
          <Text style={[styles.time, isOwn && styles.timeOwn]}>{time}</Text>
        </View>

        <Pressable onPress={() => setShowActions((v) => !v)} hitSlop={8}>
          <Text style={[styles.actionsToggle, isOwn && styles.actionsToggleOwn]}>
            {showActions ? "Hide actions" : "..."}
          </Text>
        </Pressable>

        {showActions && (
          <View style={styles.actionsRow}>
            <Pressable style={styles.actionChip} onPress={onReply}>
              <Text style={styles.actionChipText}>Reply</Text>
            </Pressable>
            <Pressable style={styles.actionChipDanger} onPress={onReport}>
              <Text style={styles.actionChipDangerText}>Report</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// Confirmed live: a message list with real volume took over 9 SECONDS to
// re-render on a single update (VirtualizedList's own "slow to update"
// warning), because every message bubble re-rendered on every refresh -
// switching threads, the 6s poll, or a single vote anywhere in the list.
// A plain React.memo wouldn't fix this on its own: getMessages/
// getConfirmationsForMessages both return freshly-mapped objects on every
// call (new object identity even for messages whose actual content hasn't
// changed at all), so a reference-equality memo would never skip a
// re-render either. This comparator checks the specific fields that affect
// what's on screen, not object identity - callback props (onVote etc.) are
// deliberately excluded, since renderItem always rebinds them fresh per
// item regardless of whether anything about that message changed.
export const MessageBubble = React.memo(MessageBubbleImpl, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.body === next.message.body &&
    prev.message.authorLevel === next.message.authorLevel &&
    prev.message.authorAvatarIcon === next.message.authorAvatarIcon &&
    prev.message.username === next.message.username &&
    prev.message.deletedAt === next.message.deletedAt &&
    prev.isOwn === next.isOwn &&
    prev.isReported === next.isReported &&
    prev.replyToMessage?.id === next.replyToMessage?.id &&
    prev.replyToMessage?.body === next.replyToMessage?.body &&
    prev.upvotes === next.upvotes &&
    prev.downvotes === next.downvotes &&
    prev.myVote === next.myVote
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginVertical: 4, paddingHorizontal: 12 },
  rowOwn: { justifyContent: "flex-end" },
  bubble: { backgroundColor: "#F1EFE8", borderRadius: 14, padding: 10, maxWidth: "82%" },
  bubbleOwn: { backgroundColor: "#2C2C2A" },
  reportedText: { fontSize: 13, fontStyle: "italic", color: "#888780" },
  reportedTextOwn: { color: "#B4B2A9" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  username: { fontSize: 11, fontWeight: "500", color: "#5F5E5A" },
  usernameOwn: { color: "#D3D1C7" },
  level: { fontWeight: "400", color: "#888780" },
  levelOwn: { color: "#9C9A92" },
  replyQuote: {
    borderLeftWidth: 2,
    borderLeftColor: "#B4B2A9",
    paddingLeft: 6,
    marginBottom: 4,
  },
  replyQuoteOwn: { borderLeftColor: "#8A8880" },
  replyQuoteText: { fontSize: 11, color: "#888780" },
  replyQuoteTextOwn: { color: "#B4B2A9" },
  body: { fontSize: 14, color: "#2C2C2A" },
  bodyOwn: { color: "white" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  voteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  voteButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  voteButtonText: { fontSize: 16, color: "#B4B2A9" },
  voteButtonUpActive: { backgroundColor: "#DCEFDC" },
  voteButtonTextUpActive: { color: "#2C6B2F" },
  voteButtonDownActive: { backgroundColor: "#F5DCDC" },
  voteButtonTextDownActive: { color: "#A32D2D" },
  voteCount: { fontSize: 13, fontWeight: "500", color: "#5F5E5A", minWidth: 18, textAlign: "center" },
  voteCountOwn: { color: "#D3D1C7" },
  time: { fontSize: 10, color: "#888780" },
  timeOwn: { color: "#B4B2A9" },
  actionsToggle: { fontSize: 11, color: "#888780", marginTop: 4 },
  actionsToggleOwn: { color: "#B4B2A9" },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  actionChip: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  actionChipText: { fontSize: 11, color: "#444441" },
  actionChipDanger: { borderWidth: 1, borderColor: "#F09595", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  actionChipDangerText: { fontSize: 11, color: "#A32D2D" },
});
