import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useAppStore } from "../state/useAppStore";
import * as backend from "../services/mockBackend";
import * as authService from "../services/authService";
import { validateUsername } from "../services/usernameValidation";

type Step = "email" | "code" | "username";

/**
 * Real account creation: email OTP (Supabase Auth) followed by a mandatory,
 * validated username - no participation is possible without both. Identity
 * (auth + the users profile row) is real; everything else in the app still
 * runs against the mock backend (see mockBackend.ts#registerUser, called
 * from authService once the profile is created).
 */
export function OnboardingScreen() {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setUserLocation = useAppStore((s) => s.setUserLocation);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState(backend.generatePseudonym());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const usernameCheck = validateUsername(username, email);

  async function handleSendCode() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await authService.requestEmailCode(email);
      if (result.ok) {
        setStep("code");
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await authService.verifyEmailCode(email, code);
      if (result.ok) {
        setStep("username");
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProfile() {
    if (!usernameCheck.ok) {
      setError(usernameCheck.error);
      return;
    }
    setLoading(true);
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
      const result = await authService.createProfile(username);
      if (result.ok) {
        setCurrentUser(result.user);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Nearby</Text>
        <Text style={styles.subtitle}>See what people around you are talking about, right now.</Text>

        {step === "email" && (
          <>
            <Text style={styles.label}>Your email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
            />
            <Text style={styles.hint}>
              Used to verify you're a real person and to keep one account per email - never shown to other users.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.button, (loading || !email.trim()) && styles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={loading || !email.trim()}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Send code</Text>}
            </Pressable>
          </>
        )}

        {step === "code" && (
          <>
            <Text style={styles.label}>Enter the code we sent to {email}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.button, (loading || !code.trim()) && styles.buttonDisabled]}
              onPress={handleVerifyCode}
              disabled={loading || !code.trim()}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Verify</Text>}
            </Pressable>
            <Pressable
              onPress={() => {
                setStep("email");
                setCode("");
                setError(undefined);
              }}
            >
              <Text style={styles.linkText}>Change email</Text>
            </Pressable>
          </>
        )}

        {step === "username" && (
          <>
            <Text style={styles.label}>Your username</Text>
            <TextInput style={styles.input} value={username} onChangeText={setUsername} maxLength={24} />
            <Text style={styles.hint}>Pick something that doesn't identify you - not your name, email, or phone number.</Text>
            <Pressable onPress={() => setUsername(backend.generatePseudonym())}>
              <Text style={styles.linkText}>Shuffle suggestion</Text>
            </Pressable>
            {!usernameCheck.ok && username.trim().length > 0 && (
              <Text style={styles.error}>{usernameCheck.error}</Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.button, (loading || !usernameCheck.ok) && styles.buttonDisabled]}
              onPress={handleCreateProfile}
              disabled={loading || !usernameCheck.ok}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Continue</Text>}
            </Pressable>
          </>
        )}
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
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "500" },
  linkText: { fontSize: 13, color: "#5F5E5A", textDecorationLine: "underline", marginTop: 12 },
});
