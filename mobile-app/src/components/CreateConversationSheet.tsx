import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";
import { ConversationSummary, GeoPoint } from "../services/types";
import { MIN_RADIUS_M, radiusDescriptor } from "../services/clustering";
import * as backend from "../services/supabaseBackend";

interface Props {
  visible: boolean;
  location?: GeoPoint;
  userId?: string;
  defaultRadius?: number;
  onClose: () => void;
  onCreated: (conversation: ConversationSummary) => void;
  onJoinExisting: (conversation: ConversationSummary) => void;
  onRadiusChange?: (radiusM: number) => void;
}

// A fixed set of round-number radii rather than a free-form continuous
// range. A continuous slider fired onValueChange on every pixel of drag,
// which (via MapScreen's live re-zoom to fit the preview circle) meant a
// native animateToRegion call for every pixel too - twitchy in practice,
// and more precision than anyone needs ("43m" vs "44m" isn't a real
// choice). Slider position is the array index with step={1}, so the native
// side only calls back into JS at each of these 9 boundaries during a
// drag instead of continuously.
const RADIUS_STEPS = [5, 10, 20, 40, 75, 125, 200, 350, 550, 800];

function radiusToStepIndex(radiusM: number): number {
  let closest = 0;
  let closestDist = Infinity;
  RADIUS_STEPS.forEach((r, i) => {
    const dist = Math.abs(r - radiusM);
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  });
  return closest;
}

function formatRadius(radiusM: number): string {
  return radiusM >= 1000 ? `${(radiusM / 1000).toFixed(1)}km` : `${radiusM}m`;
}

/**
 * Create-conversation flow, triggered from the map's "Start Chat" button or
 * a long-press. Before creating, checks for nearby similar conversations
 * (services/supabaseBackend.suggestDuplicates) and offers to join one of
 * those instead - per Phase 1 section 3, this only happens at creation
 * time; the MVP does not auto-merge already-created duplicates. Separately,
 * if the chosen radius would make this the covering/macro chat for
 * existing, smaller-radius conversations already here
 * (supabaseBackend.findConversationsToSupersede), confirms that's intended
 * before creating.
 */
export function CreateConversationSheet({
  visible,
  location,
  userId,
  defaultRadius,
  onClose,
  onCreated,
  onJoinExisting,
  onRadiusChange,
}: Props) {
  const [title, setTitle] = useState("");
  const [radiusM, setRadiusM] = useState<number>(
    () => RADIUS_STEPS[radiusToStepIndex(defaultRadius ?? MIN_RADIUS_M)]
  );
  const [suggestions, setSuggestions] = useState<ConversationSummary[]>([]);
  const [supersedeWarning, setSupersedeWarning] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  function selectRadius(next: number) {
    const snapped = RADIUS_STEPS[radiusToStepIndex(next)];
    setRadiusM(snapped);
    onRadiusChange?.(snapped);
  }

  // Re-sync to the zoom-appropriate default when the sheet transitions from
  // closed to open - otherwise a chat created while zoomed to, say,
  // venue-level would still default to the smallest radius and stay
  // invisible until zoomed in much further than where it was created.
  //
  // This must only fire on that open transition, not on every defaultRadius
  // change while already open: MapScreen re-zooms to fit the live radius
  // circle as the user drags (which changes its zoom level, which changes
  // defaultRadius, which is passed back in here as a prop). Re-syncing on
  // every defaultRadius change would fight the user's own drag - each tick
  // would reset radiusM back to the zoom-derived value, which nudges the
  // zoom again, which changes defaultRadius again, forever (this is exactly
  // what caused the "maximum update depth exceeded" / jumpy-zoom bug).
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      selectRadius(defaultRadius ?? MIN_RADIUS_M);
    }
    wasVisible.current = visible;
  }, [visible, defaultRadius]);

  // The `loading` state disables the button, but that alone doesn't stop a
  // double-tap that lands before React re-renders with the disabled state -
  // confirmed live as a real duplicate-conversation bug (two identical
  // conversations created ~1.5s apart from what should have been one tap).
  // A ref is checked synchronously, before any state update or async work,
  // so a second tap in the same event-loop tick can't possibly get through.
  const creatingRef = useRef(false);
  async function handleCreate(forceCreate = false) {
    if (!location || !userId || !title.trim()) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    setLoading(true);
    try {
      if (!forceCreate) {
        const found = await backend.suggestDuplicates(location, title.trim());
        if (found.length > 0) {
          setSuggestions(found);
          setLoading(false);
          return;
        }
        const superseded = await backend.findConversationsToSupersede(location, radiusM);
        if (superseded.length > 0) {
          setSupersedeWarning(superseded);
          setLoading(false);
          return;
        }
      }
      const result = await backend.createConversation({ title: title.trim(), radiusM, location, createdBy: userId });
      if (result.conversation) {
        setTitle("");
        setSuggestions([]);
        setSupersedeWarning([]);
        onCreated(result.conversation);
      }
    } catch (err) {
      // Was silently swallowed before - a real backend call can fail
      // (network, RLS, a bad Edge Function response) in ways the mock never
      // could, and a failure here should never look identical to success.
      Alert.alert("Couldn't start chat", err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
      creatingRef.current = false;
    }
  }

  function reset() {
    setTitle("");
    setSuggestions([]);
    setSupersedeWarning([]);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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

        <View style={styles.radiusHeaderRow}>
          <Text style={styles.radiusLabel}>{radiusDescriptor(radiusM)}</Text>
          <Text style={styles.radiusValue}>≈ {formatRadius(radiusM)}</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={RADIUS_STEPS.length - 1}
          step={1}
          value={radiusToStepIndex(radiusM)}
          onValueChange={(i) => selectRadius(RADIUS_STEPS[i])}
          minimumTrackTintColor="#2C2C2A"
          maximumTrackTintColor="#D3D1C7"
          thumbTintColor="#2C2C2A"
        />
        <View style={styles.sliderEndsRow}>
          <Text style={styles.sliderEndText}>A specific spot</Text>
          <Text style={styles.sliderEndText}>A wide area</Text>
        </View>

        {suggestions.length > 0 && (
          <View style={styles.suggestionsBox}>
            <Text style={styles.suggestionsTitle}>Already talking about this nearby:</Text>
            {suggestions.map((s) => (
              <Pressable key={s.id} style={styles.suggestionRow} onPress={() => onJoinExisting(s)}>
                <Text style={styles.suggestionTitle}>{s.title}</Text>
                <Text style={styles.suggestionMeta}>{s.participantCount} active - tap to join</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => handleCreate(true)}>
              <Text style={styles.createAnywayText}>Create a new conversation anyway</Text>
            </Pressable>
          </View>
        )}

        {suggestions.length === 0 && supersedeWarning.length > 0 && (
          <View style={styles.suggestionsBox}>
            <Text style={styles.suggestionsTitle}>
              This will become the overarching chat for {supersedeWarning.length} more specific{" "}
              {supersedeWarning.length === 1 ? "chat" : "chats"} already here:
            </Text>
            {supersedeWarning.map((s) => (
              <Pressable key={s.id} style={styles.suggestionRow} onPress={() => onJoinExisting(s)}>
                <Text style={styles.suggestionTitle}>{s.title}</Text>
                <Text style={styles.suggestionMeta}>{s.participantCount} active - tap to join instead</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => handleCreate(true)}>
              <Text style={styles.createAnywayText}>Create the overarching chat anyway</Text>
            </Pressable>
            <Pressable onPress={() => setSupersedeWarning([])}>
              <Text style={styles.createAnywayText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {suggestions.length === 0 && supersedeWarning.length === 0 && (
          <Pressable
            style={[styles.createButton, (!title.trim() || loading) && styles.createButtonDisabled]}
            onPress={() => handleCreate(false)}
            disabled={!title.trim() || loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.createButtonText}>Start chat</Text>}
          </Pressable>
        )}
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
  input: {
    borderWidth: 1,
    borderColor: "#D3D1C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 20,
  },
  radiusHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  radiusLabel: { fontSize: 14, fontWeight: "500", color: "#2C2C2A" },
  radiusValue: { fontSize: 13, color: "#5F5E5A" },
  slider: { width: "100%", height: 36, marginTop: 4 },
  sliderEndsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -4, marginBottom: 16 },
  sliderEndText: { fontSize: 11, color: "#888780" },
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
