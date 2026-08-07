import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ConversationCategory, ConversationSummary, GeoPoint } from "../services/types";
import * as backend from "../services/mockBackend";

interface Props {
  visible: boolean;
  location?: GeoPoint;
  userId?: string;
  onClose: () => void;
  onCreated: (conversation: ConversationSummary) => void;
  onJoinExisting: (conversation: ConversationSummary) => void;
}

const CATEGORIES: { key: ConversationCategory; label: string }[] = [
  { key: "micro_location", label: "A specific spot (gate, table, section)" },
  { key: "venue", label: "A whole venue" },
  { key: "area", label: "A wider area / event" },
  { key: "corridor", label: "Traffic / road" },
];

/**
 * Create-conversation flow, triggered from the map's "Start Chat" button or
 * a long-press. Before creating, checks for nearby similar conversations
 * (services/mockBackend.suggestDuplicates) and offers to join one of those
 * instead - per Phase 1 section 3, this only happens at creation time; the
 * MVP does not auto-merge already-created duplicates.
 */
export function CreateConversationSheet({ visible, location, userId, onClose, onCreated, onJoinExisting }: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ConversationCategory>("micro_location");
  const [suggestions, setSuggestions] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleCreate(forceCreate = false) {
    if (!location || !userId || !title.trim()) return;
    setLoading(true);
    try {
      if (!forceCreate) {
        const found = await backend.suggestDuplicates(location, category, title.trim());
        if (found.length > 0) {
          setSuggestions(found);
          setLoading(false);
          return;
        }
      }
      const result = await backend.createConversation({ title: title.trim(), category, location, createdBy: userId });
      if (result.conversation) {
        setTitle("");
        setSuggestions([]);
        onCreated(result.conversation);
      }
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTitle("");
    setSuggestions([]);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <Pressable style={styles.backdrop} onPress={reset} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Start a chat</Text>
        <Text style={styles.subtitle}>Short topic - what's happening right here, right now?</Text>

        <TextInput
          style={styles.input}
          placeholder='e.g. "Why is traffic stopped?"'
          value={title}
          onChangeText={setTitle}
          maxLength={80}
        />

        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setCategory(c.key)}
              style={[styles.categoryChip, category === c.key && styles.categoryChipActive]}
            >
              <Text style={[styles.categoryChipText, category === c.key && styles.categoryChipTextActive]}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {suggestions.length > 0 && (
          <View style={styles.suggestionsBox}>
            <Text style={styles.suggestionsTitle}>Already talking about this nearby:</Text>
            {suggestions.map((s) => (
              <Pressable key={s.id} style={styles.suggestionRow} onPress={() => onJoinExisting(s)}>
                <Text style={styles.suggestionTitle}>{s.title}</Text>
                <Text style={styles.suggestionMeta}>{s.participantCount} participants - tap to join</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => handleCreate(true)}>
              <Text style={styles.createAnywayText}>Create a new conversation anyway</Text>
            </Pressable>
          </View>
        )}

        {suggestions.length === 0 && (
          <Pressable
            style={[styles.createButton, (!title.trim() || loading) && styles.createButtonDisabled]}
            onPress={() => handleCreate(false)}
            disabled={!title.trim() || loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.createButtonText}>Start chat</Text>}
          </Pressable>
        )}
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
    marginBottom: 14,
  },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  categoryChip: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  categoryChipActive: { backgroundColor: "#2C2C2A", borderColor: "#2C2C2A" },
  categoryChipText: { fontSize: 12, color: "#444441" },
  categoryChipTextActive: { color: "white" },
  suggestionsBox: { backgroundColor: "#F1EFE8", borderRadius: 12, padding: 14 },
  suggestionsTitle: { fontSize: 13, fontWeight: "500", marginBottom: 10 },
  suggestionRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E3E1D8" },
  suggestionTitle: { fontSize: 14, fontWeight: "500" },
  suggestionMeta: { fontSize: 12, color: "#888780", marginTop: 2 },
  createAnywayText: { fontSize: 13, color: "#5F5E5A", marginTop: 10, textDecorationLine: "underline" },
  createButton: { backgroundColor: "#2C2C2A", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  createButtonDisabled: { opacity: 0.4 },
  createButtonText: { color: "white", fontSize: 15, fontWeight: "500" },
});
