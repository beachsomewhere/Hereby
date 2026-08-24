import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const netVotes = upvotes - downvotes;

  // The Herebie lives outside the bubble now (left of others' messages,
  // right of the user's own, via row/rowOwn's flex-direction-driven
  // ordering below) - both it and the username open the same profile
  // card, no separate navigation path.
  const herebie = (
    <Pressable
      onPress={onOpenProfile}
      hitSlop={4}
      style={styles.herebieButton}
      accessibilityRole="button"
      accessibilityLabel={`Open ${message.username}'s profile`}
    >
      <Avatar username={message.username} herebieId={message.authorAvatarIcon} size={44} />
    </Pressable>
  );

  // A reported message stays in place (so the conversation doesn't visibly
  // jump/reflow) but its content is replaced entirely - visible that
  // something was here and hidden, without still showing what it said.
  // Keeps the Herebie so the layout doesn't jump when a message in the
  // middle of a conversation gets reported.
  if (isReported) {
    return (
      <View style={[styles.row, isOwn && styles.rowOwn]}>
        {!isOwn && herebie}
        <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
          <Text style={[styles.reportedText, isOwn && styles.reportedTextOwn]}>Message reported</Text>
        </View>
        {isOwn && herebie}
      </View>
    );
  }

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && herebie}
      <Pressable
        style={[styles.bubble, isOwn && styles.bubbleOwn]}
        onLongPress={() => setContextMenuVisible(true)}
        delayLongPress={350}
      >
        <Pressable onPress={onOpenProfile} style={styles.authorRow}>
          <View style={styles.authorRowLeft}>
            <Text style={[styles.username, isOwn && styles.usernameOwn]} numberOfLines={1}>
              {message.username} <Text style={[styles.level, isOwn && styles.levelOwn]}>· Lv {message.authorLevel}</Text>
            </Text>
          </View>
          {/* Moved here from the actions row below, where it had no
              dedicated space of its own and ran directly into "Reply" with
              no visible gap between them - confirmed live as "Reply1:07 PM"
              reading like one word. There's natural room for it here,
              opposite the username. */}
          <Text style={[styles.time, isOwn && styles.timeOwn]}>{time}</Text>
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
            {/* Outline icon on a plain gray chip when not your vote, solid
                icon on a solid colored chip when it is - confirmed live as
                a real problem: the previous subtle tint-on-active state was
                too easy to miss at a glance. Shrunk from the first pass at
                this redesign (26px) to keep the message itself the visually
                dominant element, not the controls - hitSlop makes up the
                difference so the real touch target doesn't shrink with it. */}
            <Pressable
              onPress={() => onVote("upvote")}
              hitSlop={10}
              style={[styles.voteButton, myVote === "upvote" && styles.voteButtonUpActive]}
            >
              <Ionicons
                name={myVote === "upvote" ? "thumbs-up" : "thumbs-up-outline"}
                size={11}
                color={myVote === "upvote" ? "white" : "#2C2C2A"}
              />
            </Pressable>
            <Text style={styles.voteCount}>{netVotes}</Text>
            <Pressable
              onPress={() => onVote("downvote")}
              hitSlop={10}
              style={[styles.voteButton, myVote === "downvote" && styles.voteButtonDownActive]}
            >
              <Ionicons
                name={myVote === "downvote" ? "thumbs-down" : "thumbs-down-outline"}
                size={11}
                color={myVote === "downvote" ? "white" : "#2C2C2A"}
              />
            </Pressable>
          </View>
          {/* Always visible - a reply is a normal, frequent interaction
              with no real downside to a stray tap, unlike Report (which
              only lives in the long-press menu below, since it already
              goes through its own confirm dialog in ConversationScreen and
              doesn't need to compete for space here). Placeholder icon
              (arrow-redo) until a custom reply asset replaces it - no
              longer the bare "↪" glyph. */}
          <Pressable onPress={onReply} hitSlop={10} style={styles.replyButton}>
            <Ionicons name="arrow-redo-outline" size={11} color="#2C2C2A" />
          </Pressable>
        </View>
      </Pressable>
      {isOwn && herebie}

      <Modal visible={contextMenuVisible} transparent animationType="fade" onRequestClose={() => setContextMenuVisible(false)}>
        <Pressable style={styles.contextMenuBackdrop} onPress={() => setContextMenuVisible(false)} />
        <View style={styles.contextMenuWrap} pointerEvents="box-none">
          <View style={styles.contextMenu}>
            <Pressable
              style={styles.contextMenuRow}
              onPress={() => {
                setContextMenuVisible(false);
                onReply();
              }}
            >
              <Text style={styles.contextMenuRowText}>Reply</Text>
            </Pressable>
            <Pressable
              style={[styles.contextMenuRow, styles.contextMenuRowLast]}
              onPress={() => {
                setContextMenuVisible(false);
                onReport();
              }}
            >
              <Text style={styles.contextMenuRowTextDanger}>Report message</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  // alignItems: flex-start (not center) so the Herebie sits at the TOP of
  // the bubble rather than vertically centering against a long/multiline
  // message - confirmed against a deliberately long test message.
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginVertical: 4, paddingHorizontal: 12 },
  rowOwn: { justifyContent: "flex-end" },
  // maxWidth trimmed from 82% to make room for the 44pt Herebie + gap now
  // living outside the bubble (previously the only thing in the row).
  bubble: { backgroundColor: "#F1EFE8", borderRadius: 14, padding: 10, maxWidth: "74%" },
  bubbleOwn: { backgroundColor: "#2C2C2A" },
  // No background/border of its own - just a tap target around the
  // Herebie itself, sized to the 44pt spec with a little slop for the tap
  // area without inflating the visible artwork.
  herebieButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  reportedText: { fontSize: 13, fontStyle: "italic", color: "#888780" },
  reportedTextOwn: { color: "#B4B2A9" },
  authorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  authorRowLeft: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
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
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  // Circular pill chips (matching a reference upvote/downvote + reply
  // treatment the user liked) rather than the previous plain
  // padding-and-radius buttons and a bare text link - a light gray circle
  // regardless of isOwn (reads fine as a subtle inset chip on both the
  // light and the dark "own message" bubble, so no separate isOwn variant
  // needed for the chrome itself, only for the active vote states below).
  // Shrunk from the first pass at this redesign (26px) per "the message
  // should visually dominate the controls" - hitSlop (see the Pressables
  // above) keeps the real touch target close to its previous size even as
  // the visible chip shrinks.
  voteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  voteButton: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EDEBE3",
  },
  // Solid fill (not a light tint) once it's your vote - the icon itself
  // switches to the solid Ionicons variant in white to match, per the
  // reference: outline-on-gray when unselected, solid-on-color when
  // selected.
  voteButtonUpActive: { backgroundColor: "#2C6B2F" },
  voteButtonDownActive: { backgroundColor: "#A32D2D" },
  // Bold teal regardless of isOwn/vote state, same reasoning as the chip
  // background above - bright enough to read clearly on both the light and
  // dark bubble.
  voteCount: { fontSize: 12, fontWeight: "700", color: "#14B8A6", minWidth: 18, textAlign: "center" },
  replyButton: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EDEBE3",
  },
  time: { fontSize: 10, color: "#888780", marginLeft: 8 },
  timeOwn: { color: "#B4B2A9" },
  contextMenuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  contextMenuWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  contextMenu: { backgroundColor: "white", borderRadius: 12, width: 200, overflow: "hidden" },
  contextMenuRow: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#EDEBE3" },
  contextMenuRowLast: { borderBottomWidth: 0 },
  contextMenuRowText: { fontSize: 15, color: "#2C2C2A", textAlign: "center" },
  contextMenuRowTextDanger: { fontSize: 15, color: "#A32D2D", textAlign: "center" },
});
