import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/supabaseBackend";

// Header badge for every screen that isn't the map itself - MapScreen
// already shows nearby chats directly as bubbles, so a count there would
// be redundant. Elsewhere (inside a conversation, dev panel, ...) this is
// the only signal that something's available nearby. Deliberately its own
// poll+subscribe, gated on useIsFocused the same way MapScreen gates its
// own - MapScreen's poll already stops the moment it loses focus (see its
// own comment on why), so this one picks up exactly when that one stops,
// rather than the two ever competing for the same network/CPU at once.
export function NearbyBadge() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const location = useAppStore(effectiveLocation);
  const [count, setCount] = useState(0);

  const inFlightRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!location || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const results = await backend.getVisibleConversations(location);
      setCount(results.filter((c) => !c.isParticipant).length);
    } finally {
      inFlightRef.current = false;
    }
  }, [location]);

  useEffect(() => {
    if (!isFocused || !location) {
      setCount(0);
      return;
    }
    refresh();
    const unsubscribe = backend.subscribeToMap(refresh);
    // Slower than MapScreen's own 5s poll - this is a passive nudge, not
    // the live map, so it doesn't need to be as tight.
    const interval = setInterval(refresh, 15000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh, isFocused, location]);

  if (count === 0) return null;

  return (
    <Pressable
      onPress={() => navigation.navigate("Map")}
      hitSlop={10}
      style={styles.badge}
    >
      <Text style={styles.badgeText}>{count} nearby</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#2C2C2A",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  badgeText: { color: "white", fontSize: 12, fontWeight: "600" },
});
