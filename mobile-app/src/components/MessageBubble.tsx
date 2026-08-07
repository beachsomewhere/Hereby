import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ConfirmationType, Message } from "../services/types";

interface Props {
  message: Message;
  isOwn: boolean;
  onConfirm: (type: ConfirmationType) => void;
  onReport: () => void;
  onReply: () => void;
  onOpenProfile: () => void;
  confirmedCount?: number;
}

const CONFIRM_OPTIONS: { type: ConfirmationType; label: string }[] = [
  { type: "helpful", label: "Helpful" },
  { type: "confirm", label: "Confirm" },
  { type: "cannot_confirm", label: "Can't confirm" },
  { type: "incorrect", label: "Incorrect" },
];

export function MessageBubble({ message, isOwn, onConfirm, onReport, onReply, onOpenProfile, confirmedCount }: Props) {
  const [showActions, setShowActions] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
        {!isOwn && (
          <Pressable onPress={onOpenProfile}>
            <Text style={styles.username}>{message.username}</Text>
          </Pressable>
        )}
        <Text style={[styles.body, isOwn && styles.bodyOwn]}>{message.body}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.time}>{time}</Text>
          {!!confirmedCount && confirmedCount > 0 && (
            <Text style={styles.confirmed}>Community confirmed by {confirmedCount} nearby participants</Text>
          )}
        </View>

        <Pressable onPress={() => setShowActions((v) => !v)} hitSlop={8}>
          <Text style={styles.actionsToggle}>{showActions ? "Hide actions" : "..."}</Text>
        </Pressable>

        {showActions && (
          <View style={styles.actionsRow}>
            {CONFIRM_OPTIONS.map((opt) => (
              <Pressable key={opt.type} style={styles.actionChip} onPress={() => onConfirm(opt.type)}>
                <Text style={styles.actionChipText}>{opt.label}</Text>
              </Pressable>
            ))}
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginVertical: 4, paddingHorizontal: 12 },
  rowOwn: { justifyContent: "flex-end" },
  bubble: { backgroundColor: "#F1EFE8", borderRadius: 14, padding: 10, maxWidth: "82%" },
  bubbleOwn: { backgroundColor: "#2C2C2A" },
  username: { fontSize: 11, fontWeight: "500", color: "#5F5E5A", marginBottom: 2 },
  body: { fontSize: 14, color: "#2C2C2A" },
  bodyOwn: { color: "white" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4, alignItems: "center" },
  time: { fontSize: 10, color: "#888780" },
  confirmed: { fontSize: 10, color: "#3B6D11", fontWeight: "500" },
  actionsToggle: { fontSize: 11, color: "#888780", marginTop: 2 },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  actionChip: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  actionChipText: { fontSize: 11, color: "#444441" },
  actionChipDanger: { borderWidth: 1, borderColor: "#F09595", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  actionChipDangerText: { fontSize: 11, color: "#A32D2D" },
});
