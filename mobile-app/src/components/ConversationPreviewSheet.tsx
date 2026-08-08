import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ConversationSummary } from "../services/types";
import { heatLevel } from "../services/activityScore";

interface Props {
  conversation?: ConversationSummary;
  onClose: () => void;
  onJoin: (conversation: ConversationSummary) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  micro_location: "Micro-location",
  venue: "Venue",
  area: "Area",
  corridor: "Traffic / corridor",
};

/**
 * Tap-to-preview bottom sheet. Deliberately a lightweight Modal + slide-up
 * View rather than a full navigation push, so the map stays visible
 * underneath - reinforces "you're looking at the world," not "you're
 * browsing a list."
 */
export function ConversationPreviewSheet({ conversation, onClose, onJoin }: Props) {
  if (!conversation) return null;
  const level = heatLevel(conversation.activityScore);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{conversation.title}</Text>
        <Text style={styles.subtitle}>
          {CATEGORY_LABELS[conversation.category]}
          {conversation.venueLabel ? ` · ${conversation.venueLabel}` : ""}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Participants</Text>
            <Text style={styles.statValue}>{conversation.participantCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Activity</Text>
            <Text style={styles.statValue}>{level === "hot" ? "Hot" : level === "active" ? "Active" : "New"}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Threads</Text>
            <Text style={styles.statValue}>{conversation.threadCount}</Text>
          </View>
        </View>

        {conversation.lastMessagePreview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {conversation.lastMessagePreview}
          </Text>
        ) : (
          <Text style={styles.previewMuted}>No messages yet - be the first to say something.</Text>
        )}

        <Pressable style={styles.joinButton} onPress={() => onJoin(conversation)}>
          <Text style={styles.joinButtonText}>Join</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D3D1C7",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "500" },
  subtitle: { fontSize: 13, color: "#5F5E5A", marginTop: 2, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  stat: {},
  statLabel: { fontSize: 11, color: "#888780" },
  statValue: { fontSize: 18, fontWeight: "500", marginTop: 2 },
  preview: { fontSize: 14, color: "#444441", marginBottom: 20 },
  previewMuted: { fontSize: 14, color: "#888780", fontStyle: "italic", marginBottom: 20 },
  joinButton: { backgroundColor: "#2C2C2A", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  joinButtonText: { color: "white", fontSize: 15, fontWeight: "500" },
});
