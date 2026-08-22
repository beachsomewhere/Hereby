import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// Shared between the message-report flow (ReportMessageSheet, triggered
// from MessageBubble's long-press menu) and the user-report flow
// (ProfileCard) - canned reasons are faster to file than a blank text box
// and give the admin dashboard consistent, filterable categories instead
// of freeform prose every time.
export const REPORT_REASONS = ["Spam", "Harassment", "Trolling", "Vulgarity", "Hate speech", "Misinformation", "Other"] as const;

interface Props {
  selected?: string;
  onSelect: (reason: string) => void;
  customText: string;
  onCustomTextChange: (text: string) => void;
}

export function ReportReasonPicker({ selected, onSelect, customText, onCustomTextChange }: Props) {
  return (
    <View>
      <View style={styles.chipRow}>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => onSelect(r)}
            style={[styles.chip, selected === r && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected === r && styles.chipTextSelected]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      {selected === "Other" && (
        <TextInput
          style={styles.customInput}
          value={customText}
          onChangeText={onCustomTextChange}
          placeholder="Briefly describe why"
          multiline
          autoFocus
        />
      )}
    </View>
  );
}

// Given a picker's current selection, the actual reason string to submit -
// the canned label itself, or the typed detail when "Other" is picked.
export function resolveReportReason(selected: string | undefined, customText: string): string | undefined {
  if (!selected) return undefined;
  if (selected === "Other") return customText.trim() || undefined;
  return selected;
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#D3D1C7",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipSelected: { backgroundColor: "#2C2C2A", borderColor: "#2C2C2A" },
  chipText: { fontSize: 13, color: "#444441" },
  chipTextSelected: { color: "white", fontWeight: "500" },
  customInput: {
    marginTop: 12,
    width: "100%",
    borderWidth: 1,
    borderColor: "#D3D1C7",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: "top",
  },
});
