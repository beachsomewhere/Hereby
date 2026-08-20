import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useAppStore } from "../state/useAppStore";
import * as backend from "../services/supabaseBackend";
import * as authService from "../services/authService";
import { validateUsername } from "../services/usernameValidation";
import { registerForPushNotifications } from "../services/pushNotifications";

type Step = "birthdate" | "email" | "code" | "username";

const MIN_AGE = 18;

// Returns null for a calendar-invalid date (e.g. Feb 30) rather than letting
// it silently roll over to a different date, which `new Date(y, m, d)` would
// otherwise do.
function computeAge(year: number, month: number, day: number): number | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * Real account creation: a birthdate gate, then email OTP (Supabase Auth),
 * then a mandatory, validated username - no participation is possible
 * without all three. Both identity (auth + the users profile row) and
 * everything downstream (conversations, threads, messages) are real - see
 * supabaseBackend.ts. The birthdate step comes first, deliberately, so
 * eligibility is confirmed before any other information is collected.
 */
export function OnboardingScreen() {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setUserLocation = useAppStore((s) => s.setUserLocation);

  const [step, setStep] = useState<Step>("birthdate");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState(backend.generatePseudonym());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const usernameCheck = validateUsername(username, email);

  function handleSubmitBirthdate() {
    setError(undefined);
    const month = parseInt(birthMonth, 10);
    const day = parseInt(birthDay, 10);
    const year = parseInt(birthYear, 10);
    if (!month || !day || !year || year < 1900) {
      setError("Enter a valid date of birth.");
      return;
    }
    const age = computeAge(year, month, day);
    if (age === null) {
      setError("That's not a valid date.");
      return;
    }
    if (age < MIN_AGE) {
      setError(`Hereby is only available to people ${MIN_AGE} and older.`);
      return;
    }
    setStep("email");
  }

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
      // Reaching this step already required passing the birthdate gate
      // above - authService.createProfile still requires this explicitly
      // rather than trusting an implicit "got this far" assumption.
      const result = await authService.createProfile(username, true);
      if (result.ok) {
        setCurrentUser(result.user);
        // Best-effort - a denied permission or a simulator just means no
        // pushes, never a reason to block the user from finishing onboarding.
        registerForPushNotifications().catch((err) =>
          console.error("registerForPushNotifications failed:", err instanceof Error ? err.message : err)
        );
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.content}>
        <Text style={styles.title}>Hereby</Text>
        <Text style={styles.subtitle}>See what people around you are talking about, right now.</Text>

        {step === "birthdate" && (
          <>
            <Text style={styles.label}>Your date of birth</Text>
            <Text style={styles.hint}>Hereby is only available to people {MIN_AGE} and older.</Text>
            <View style={styles.birthdateRow}>
              <TextInput
                style={[styles.input, styles.birthdateInputSmall]}
                value={birthMonth}
                onChangeText={setBirthMonth}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="MM"
              />
              <TextInput
                style={[styles.input, styles.birthdateInputSmall]}
                value={birthDay}
                onChangeText={setBirthDay}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="DD"
              />
              <TextInput
                style={[styles.input, styles.birthdateInputLarge]}
                value={birthYear}
                onChangeText={setBirthYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="YYYY"
              />
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[styles.button, (!birthMonth || !birthDay || !birthYear) && styles.buttonDisabled]}
              onPress={handleSubmitBirthdate}
              disabled={!birthMonth || !birthDay || !birthYear}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </Pressable>
          </>
        )}

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
              maxLength={10}
              placeholder="Code from the email"
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white", justifyContent: "flex-end" },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "500" },
  subtitle: { fontSize: 15, color: "#5F5E5A", marginTop: 8, marginBottom: 32 },
  label: { fontSize: 12, color: "#888780", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  birthdateRow: { flexDirection: "row", gap: 10 },
  birthdateInputSmall: { flex: 1, textAlign: "center" },
  birthdateInputLarge: { flex: 1.5, textAlign: "center" },
  hint: { fontSize: 12, color: "#888780", marginTop: 8 },
  error: { fontSize: 13, color: "#A32D2D", marginTop: 16 },
  button: { backgroundColor: "#2C2C2A", borderRadius: 10, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "500" },
  linkText: { fontSize: 13, color: "#5F5E5A", textDecorationLine: "underline", marginTop: 12 },
});
