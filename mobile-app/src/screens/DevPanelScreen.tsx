import React, { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from "react-native";
import { useAppStore } from "../state/useAppStore";
import * as backend from "../services/mockBackend";
import { SCENARIOS, ScenarioName } from "../dev/scenarios";

/**
 * Developer / QA mode, required by the Phase 1 brief: simulate GPS
 * coordinates, geofence enter/exit, drift, multiple synthetic users, bubble
 * growth/decay, clustering, and expiration - all against the same mock
 * backend the rest of the app uses, so what you see here is exactly what
 * the map screen will render.
 */
export function DevPanelScreen() {
  const devModeEnabled = useAppStore((s) => s.devModeEnabled);
  const toggleDevMode = useAppStore((s) => s.toggleDevMode);
  const devSimulatedLocation = useAppStore((s) => s.devSimulatedLocation);
  const setDevSimulatedLocation = useAppStore((s) => s.setDevSimulatedLocation);

  const [lat, setLat] = useState(String(devSimulatedLocation?.lat ?? 37.6213));
  const [lng, setLng] = useState(String(devSimulatedLocation?.lng ?? -122.3790));
  const [conversationIds, setConversationIds] = useState<string[]>(backend.devListConversationIds());

  function applyLocation() {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      setDevSimulatedLocation({ lat: parsedLat, lng: parsedLng });
    }
  }

  function simulateDrift() {
    if (!devSimulatedLocation) return;
    const driftMeters = 40;
    const metersPerDeg = 111320;
    setDevSimulatedLocation({
      lat: devSimulatedLocation.lat + (Math.random() - 0.5) * (driftMeters / metersPerDeg),
      lng: devSimulatedLocation.lng + (Math.random() - 0.5) * (driftMeters / metersPerDeg),
    });
  }

  function simulateWalkAway() {
    if (!devSimulatedLocation) return;
    // ~600m away - enough to leave participation radius for most categories
    setDevSimulatedLocation({ lat: devSimulatedLocation.lat + 0.0055, lng: devSimulatedLocation.lng });
  }

  async function loadScenario(name: ScenarioName) {
    if (!devSimulatedLocation) applyLocation();
    const center = devSimulatedLocation ?? { lat: parseFloat(lat), lng: parseFloat(lng) };
    await backend.devLoadScenario(name, center);
    setConversationIds(backend.devListConversationIds());
  }

  async function resetAll() {
    backend.devResetAll();
    setConversationIds([]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Text style={styles.label}>Dev mode enabled</Text>
        <Switch value={devModeEnabled} onValueChange={toggleDevMode} />
      </View>
      <Text style={styles.hint}>
        When on, the map uses the simulated location below instead of real GPS. Everything else in the app behaves
        identically to production - the mock backend runs the same eligibility, activity-scoring, and lifecycle
        logic described in the Phase 1 architecture doc.
      </Text>

      <Text style={styles.sectionTitle}>Simulated location</Text>
      <View style={styles.row}>
        <TextInput style={styles.coordInput} value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" placeholder="lat" />
        <TextInput style={styles.coordInput} value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" placeholder="lng" />
      </View>
      <Pressable style={styles.button} onPress={applyLocation}>
        <Text style={styles.buttonText}>Set location</Text>
      </Pressable>
      <View style={styles.buttonRow}>
        <Pressable style={styles.buttonSecondary} onPress={simulateDrift}>
          <Text style={styles.buttonSecondaryText}>Simulate GPS drift</Text>
        </Pressable>
        <Pressable style={styles.buttonSecondary} onPress={simulateWalkAway}>
          <Text style={styles.buttonSecondaryText}>Walk outside geofence</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Scenario presets</Text>
      <Text style={styles.hint}>Seeds several conversations with synthetic participants and messages around the location above.</Text>
      <View style={styles.scenarioGrid}>
        {(Object.keys(SCENARIOS) as ScenarioName[]).map((key) => (
          <Pressable key={key} style={styles.scenarioChip} onPress={() => loadScenario(key)}>
            <Text style={styles.scenarioChipText}>{SCENARIOS[key].label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Time and activity</Text>
      <View style={styles.buttonRow}>
        <Pressable style={styles.buttonSecondary} onPress={() => backend.advanceClockMinutes(15)}>
          <Text style={styles.buttonSecondaryText}>+15 min</Text>
        </Pressable>
        <Pressable style={styles.buttonSecondary} onPress={() => backend.advanceClockMinutes(60)}>
          <Text style={styles.buttonSecondaryText}>+1 hour</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Active conversations ({conversationIds.length})</Text>
      {conversationIds.map((id) => (
        <View key={id} style={styles.convRow}>
          <Text style={styles.convId}>{id}</Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.smallButton} onPress={() => backend.devAddSyntheticParticipant(id)}>
              <Text style={styles.smallButtonText}>+1 participant</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => backend.devAddSyntheticMessage(id)}>
              <Text style={styles.smallButtonText}>+1 message</Text>
            </Pressable>
            <Pressable style={styles.smallButtonDanger} onPress={() => backend.devExpireConversation(id)}>
              <Text style={styles.smallButtonDangerText}>Expire now</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Pressable style={styles.resetButton} onPress={resetAll}>
        <Text style={styles.resetButtonText}>Reset all mock data</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "white" },
  content: { padding: 20, paddingBottom: 48 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  label: { fontSize: 14, fontWeight: "500" },
  hint: { fontSize: 12, color: "#888780", marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "500", marginTop: 16, marginBottom: 8 },
  coordInput: { flex: 1, borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  button: { backgroundColor: "#2C2C2A", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 10 },
  buttonText: { color: "white", fontSize: 13, fontWeight: "500" },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  buttonSecondary: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  buttonSecondaryText: { fontSize: 12, color: "#444441" },
  scenarioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scenarioChip: { backgroundColor: "#F1EFE8", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  scenarioChipText: { fontSize: 12, color: "#2C2C2A" },
  convRow: { borderTopWidth: 1, borderTopColor: "#EDEBE3", paddingVertical: 10 },
  convId: { fontSize: 11, color: "#888780", marginBottom: 6, fontFamily: "Courier" },
  smallButton: { borderWidth: 1, borderColor: "#D3D1C7", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  smallButtonText: { fontSize: 11, color: "#444441" },
  smallButtonDanger: { borderWidth: 1, borderColor: "#F09595", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  smallButtonDangerText: { fontSize: 11, color: "#A32D2D" },
  resetButton: { marginTop: 24, alignItems: "center" },
  resetButtonText: { fontSize: 13, color: "#A32D2D", textDecorationLine: "underline" },
});
