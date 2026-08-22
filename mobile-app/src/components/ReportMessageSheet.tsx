import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ReportReasonPicker, resolveReportReason } from "./ReportReasonPicker";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

// Replaces the old Alert.alert confirm-only flow - a message report now
// picks a canned reason the same way a user report does (ProfileCard),
// rather than always sending the same fixed "reported from chat" string.
export function ReportMessageSheet({ visible, onClose, onSubmit }: Props) {
  const [selected, setSelected] = useState<string>();
  const [customText, setCustomText] = useState("");
  const reason = resolveReportReason(selected, customText);

  function reset() {
    setSelected(undefined);
    setCustomText("");
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={reset} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Report message</Text>
          <Text style={styles.subtitle}>Why are you reporting this message?</Text>

          <ReportReasonPicker
            selected={selected}
            onSelect={setSelected}
            customText={customText}
            onCustomTextChange={setCustomText}
          />

          <Pressable
            style={[styles.submitButton, !reason && styles.submitButtonDisabled]}
            disabled={!reason}
            onPress={() => {
              if (!reason) return;
              onSubmit(reason);
              reset();
            }}
          >
            <Text style={styles.submitButtonText}>Submit report</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D3D1C7", alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "500" },
  subtitle: { fontSize: 13, color: "#5F5E5A", marginTop: 2, marginBottom: 16 },
  submitButton: { marginTop: 18, backgroundColor: "#A32D2D", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: "white", fontSize: 15, fontWeight: "500" },
});
