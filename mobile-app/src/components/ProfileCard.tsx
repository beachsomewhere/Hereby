import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { User } from "../services/types";
import { Avatar } from "./Avatar";
import { AVATAR_ICONS } from "../services/avatarIcons";
import { ReportReasonPicker, resolveReportReason } from "./ReportReasonPicker";

interface Props {
  user?: User;
  visible: boolean;
  isSelf?: boolean;
  onClose: () => void;
  onBlock: () => void;
  onReport: (reason: string) => void;
  onSelectIcon?: (icon: string) => void;
  onLogOut?: () => void;
}

/**
 * Intentionally shallow, per Phase 1 section 11: username, avatar, level,
 * helpfulness points, a couple of badges, coarse account age, block/report.
 * No feed, no history, no location, no real name - and there is nowhere
 * else in the app to see more about a user than this.
 */
export function ProfileCard({ user, visible, isSelf, onClose, onBlock, onReport, onSelectIcon, onLogOut }: Props) {
  // Unlike a message report (the reported message itself is the context a
  // moderator sees on the dashboard), reporting a user has no inherent
  // context - without asking why here, every user report would show up
  // identically as "reported from profile card," telling a moderator
  // nothing. Reset whenever the card closes: it doesn't unmount between
  // opens (same instance, `user` just toggles undefined/defined), so stale
  // state would otherwise carry over to the next profile opened.
  const [reportMode, setReportMode] = useState(false);
  const [reportSelected, setReportSelected] = useState<string>();
  const [reportCustomText, setReportCustomText] = useState("");
  const reportReason = resolveReportReason(reportSelected, reportCustomText);
  useEffect(() => {
    if (!visible) {
      setReportMode(false);
      setReportSelected(undefined);
      setReportCustomText("");
    }
  }, [visible]);

  if (!user) return null;
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000));
  const ageLabel = accountAgeDays < 1 ? "New today" : accountAgeDays < 30 ? `${accountAgeDays}d on Hereby` : `${Math.floor(accountAgeDays / 30)}mo on Hereby`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.cardWrap} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.avatarWrap}>
            <Avatar username={user.username} avatarIcon={user.avatarIcon} size={56} />
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

          {isSelf && (
            <View style={styles.iconPickerSection}>
              <Text style={styles.iconPickerTitle}>Your icon</Text>
              <View style={styles.iconGrid}>
                {AVATAR_ICONS.map((option) => {
                  const unlocked = option.requiredLevel <= user.level;
                  const selected = user.avatarIcon === option.icon;
                  return (
                    <View key={option.id} style={styles.iconChipWrap}>
                      <Pressable
                        style={[styles.iconChip, selected && styles.iconChipSelected, !unlocked && styles.iconChipLocked]}
                        onPress={() => unlocked && onSelectIcon?.(option.icon)}
                        disabled={!unlocked}
                      >
                        <Text style={[styles.iconChipEmoji, !unlocked && styles.iconChipEmojiLocked]}>{option.icon}</Text>
                      </Pressable>
                      <Text style={styles.iconChipLevel}>{unlocked ? "" : `Lv ${option.requiredLevel}`}</Text>
                    </View>
                  );
                })}
              </View>
              {onLogOut && (
                <Pressable style={styles.logOutButton} onPress={onLogOut}>
                  <Text style={styles.logOutButtonText}>Log out</Text>
                </Pressable>
              )}
            </View>
          )}

          {!isSelf && !reportMode && (
            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton} onPress={onBlock}>
                <Text style={styles.actionButtonText}>Block</Text>
              </Pressable>
              <Pressable style={styles.actionButtonDanger} onPress={() => setReportMode(true)}>
                <Text style={styles.actionButtonDangerText}>Report</Text>
              </Pressable>
            </View>
          )}

          {!isSelf && reportMode && (
            <View style={styles.reportSection}>
              <Text style={styles.reportPrompt}>Why are you reporting this user?</Text>
              <ReportReasonPicker
                selected={reportSelected}
                onSelect={setReportSelected}
                customText={reportCustomText}
                onCustomTextChange={setReportCustomText}
              />
              <View style={styles.actionsRow}>
                <Pressable style={styles.actionButton} onPress={() => setReportMode(false)}>
                  <Text style={styles.actionButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionButtonDanger, !reportReason && styles.actionButtonDisabled]}
                  onPress={() => reportReason && onReport(reportReason)}
                  disabled={!reportReason}
                >
                  <Text style={styles.actionButtonDangerText}>Submit report</Text>
                </Pressable>
              </View>
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
  avatarWrap: { marginBottom: 12 },
  username: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 12, color: "#888780", marginTop: 2 },
  statsRow: { flexDirection: "row", marginTop: 16 },
  stat: { alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "500" },
  statLabel: { fontSize: 11, color: "#888780", marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 14 },
  iconPickerSection: { marginTop: 16, alignItems: "center" },
  iconPickerTitle: { fontSize: 12, fontWeight: "500", color: "#5F5E5A", marginBottom: 8 },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  iconChipWrap: { alignItems: "center", width: 44 },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1EFE8",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  iconChipSelected: { borderColor: "#2C2C2A" },
  iconChipLocked: { backgroundColor: "#F7F6F2" },
  iconChipEmoji: { fontSize: 20 },
  iconChipEmojiLocked: { opacity: 0.3 },
  iconChipLevel: { fontSize: 9, color: "#888780", marginTop: 2, height: 12 },
  logOutButton: { marginTop: 18 },
  logOutButtonText: { fontSize: 13, color: "#A32D2D" },
  badgeChip: { backgroundColor: "#F1EFE8", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeChipText: { fontSize: 11, color: "#444441" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  closeText: { fontSize: 13, color: "#888780", marginTop: 14 },
  actionButton: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  actionButtonText: { fontSize: 13, color: "#444441" },
  actionButtonDanger: { borderWidth: 1, borderColor: "#F09595", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  actionButtonDangerText: { fontSize: 13, color: "#A32D2D" },
  actionButtonDisabled: { opacity: 0.4 },
  reportSection: { width: "100%", marginTop: 18 },
  reportPrompt: { fontSize: 12, color: "#5F5E5A", marginBottom: 8, textAlign: "center" },
});
