import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Thread } from "../services/types";
import * as backend from "../services/mockBackend";

interface Props {
  visible: boolean;
  conversationId?: string;
  userId?: string;
  onClose: () => void;
  onCreated: (thread: Thread) => void;
}

/**
 * Minimal create-thread flow, triggered from the "+ New thread" chip inside
 * a conversation. Unlike CreateConversationSheet, there's no category or
 * duplicate-suggestion step - a thread is just a named sub-topic scoped to
 * the location conversation it's created in.
 */
export function CreateThreadSheet({ visible, conversationId, userId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!conversationId || !userId || !title.trim()) return;
    setLoading(true);
    try {
      const thread = await backend.createThread(conversationId, title.trim(), userId);
      setTitle("");
      onCreated(thread);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTitle("");
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <Pressable style={styles.backdrop} onPress={reset} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>New thread</Text>
        <Text style={styles.subtitle}>A focused topic within this chat - everyone here can see and join it.</Text>

        <TextInput
          style={styles.input}
          placeholder='e.g. "food?"'
          value={title}
          onChangeText={setTitle}
          maxLength={60}
          autoFocus
        />

        <Pressable
          style={[styles.createButton, (!title.trim() || loading) && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={!title.trim() || loading}
        >
          {loading ? <ActivityIndicator color="white" /> : <Text style={styles.createButtonText}>Create thread</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D3D1C7", alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "500" },
  subtitle: { fontSize: 13, color: "#5F5E5A", marginTop: 2, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#D3D1C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  createButton: { backgroundColor: "#2C2C2A", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  createButtonDisabled: { opacity: 0.4 },
  createButtonText: { color: "white", fontSize: 15, fontWeight: "500" },
});
