import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { User } from "../services/types";

interface Props {
  user?: User;
  visible: boolean;
  isSelf?: boolean;
  onClose: () => void;
  onBlock: () => void;
  onReport: () => void;
}

/**
 * Intentionally shallow, per Phase 1 section 11: username, avatar, level,
 * helpfulness points, a couple of badges, coarse account age, block/report.
 * No feed, no history, no location, no real name - and there is nowhere
 * else in the app to see more about a user than this.
 */
export function ProfileCard({ user, visible, isSelf, onClose, onBlock, onReport }: Props) {
  if (!user) return null;
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000));
  const ageLabel = accountAgeDays < 1 ? "New today" : accountAgeDays < 30 ? `${accountAgeDays}d on Hereby` : `${Math.floor(accountAgeDays / 30)}mo on Hereby`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.cardWrap} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.username.slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={styles.username}>{user.username}</Text>
          <Text style={styles.meta}>Level {user.level} · {ageLabel}</Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{user.helpfulPoints}</Text>
              <Text style={styles.statLabel}>Helpfulness points</Text>
            </View>
          </View>

          {user.badgeIds.length > 0 && (
            <View style={styles.badgeRow}>
              {user.badgeIds.map((b) => (
                <View key={b} style={styles.badgeChip}>
                  <Text style={styles.badgeChipText}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {!isSelf && (
            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton} onPress={onBlock}>
                <Text style={styles.actionButtonText}>Block</Text>
              </Pressable>
              <Pressable style={styles.actionButtonDanger} onPress={onReport}>
                <Text style={styles.actionButtonDangerText}>Report</Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  cardWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: "white", borderRadius: 16, padding: 24, width: 260, alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#CECBF6", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontSize: 18, fontWeight: "500", color: "#26215C" },
  username: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 12, color: "#888780", marginTop: 2 },
  statsRow: { flexDirection: "row", marginTop: 16 },
  stat: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "500" },
  statLabel: { fontSize: 11, color: "#888780", marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 14 },
  badgeChip: { backgroundColor: "#F1EFE8", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeChipText: { fontSize: 11, color: "#444441" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  closeText: { fontSize: 13, color: "#888780", marginTop: 14 },
  actionButton: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  actionButtonText: { fontSize: 13, color: "#444441" },
  actionButtonDanger: { borderWidth: 1, borderColor: "#F09595", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  actionButtonDangerText: { fontSize: 13, color: "#A32D2D" },
});
