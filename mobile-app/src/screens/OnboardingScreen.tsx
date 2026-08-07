import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useAppStore } from "../state/useAppStore";
import * as backend from "../services/mockBackend";

/**
 * Fast, low-friction onboarding per Phase 1: a pseudonymous account is
 * created immediately (no email/password required to start), with a single
 * clear location-permission ask. Real builds would offer an optional
 * upgrade to Apple/Google/email/phone via Supabase Auth without ever
 * exposing that identity publicly - out of scope for this prototype.
 */
export function OnboardingScreen() {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const [username, setUsername] = useState(backend.generatePseudonym());
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleContinue() {
    setRequesting(true);
    setError(undefined);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({});
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } else {
        // MVP behavior: the app is unusable without location, since the map
        // *is* the app. Still let them proceed to see the empty-state /
        // dev-mode path rather than dead-ending.
        setError("Location permission was denied. You can enable dev mode from the map to explore with a simulated location.");
      }
      const user = await backend.createUser(username.trim() || undefined);
      setCurrentUser(user);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Nearby</Text>
        <Text style={styles.subtitle}>See what people around you are talking about, right now.</Text>

        <Text style={styles.label}>Your username</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} maxLength={24} />
        <Text style={styles.hint}>Pseudonymous - no real name, email, or phone is ever shown to other users.</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.button} onPress={handleContinue} disabled={requesting}>
          {requesting ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Continue</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white", justifyContent: "flex-end" },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "500" },
  subtitle: { fontSize: 15, color: "#5F5E5A", marginTop: 8, marginBottom: 32 },
  label: { fontSize: 12, color: "#888780", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  hint: { fontSize: 12, color: "#888780", marginTop: 8 },
  error: { fontSize: 13, color: "#A32D2D", marginTop: 16 },
  button: { backgroundColor: "#2C2C2A", borderRadius: 10, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "500" },
});
