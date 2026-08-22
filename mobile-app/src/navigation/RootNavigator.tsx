import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as Location from "expo-location";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAppStore } from "../state/useAppStore";
import * as authService from "../services/authService";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { MapScreen } from "../screens/MapScreen";
import { ConversationScreen } from "../screens/ConversationScreen";
import { DevPanelScreen } from "../screens/DevPanelScreen";
import { NearbyBadge } from "../components/NearbyBadge";

export type RootStackParamList = {
  Onboarding: undefined;
  Map: undefined;
  Conversation: { conversationId: string; threadId?: string };
  DevPanel: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const devModeEnabled = useAppStore((s) => s.devModeEnabled);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    authService.restoreSession().then((user) => {
      if (user) setCurrentUser(user);
      setSessionChecked(true);
    });
  }, [setCurrentUser]);

  // Lives here (not MapScreen) so it keeps running for the whole
  // authenticated session, not just while MapScreen happens to be the
  // screen on top. Confirmed live: an earlier version of this gated on
  // MapScreen's own focus, which meant userLocation silently stopped
  // updating the moment a user opened a conversation - exactly when
  // ConversationScreen's eligibility poll needs live location most, to
  // correctly notice "user has left this chat's boundary" and start its
  // grace period. Balanced accuracy/10s/15m mirrors what this app's
  // smallest participation radii (as small as 5m, see
  // mockBackend.ts#RADII) actually need without polling GPS harder than
  // that.
  useEffect(() => {
    if (!currentUser || devModeEnabled) return;
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 15 },
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      );
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [currentUser, devModeEnabled, setUserLocation]);

  if (!sessionChecked) {
    return <View style={{ flex: 1, backgroundColor: "white" }} />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      {!currentUser ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Map" component={MapScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Conversation"
            component={ConversationScreen}
            options={{ title: "" }}
          />
          <Stack.Screen
            name="DevPanel"
            component={DevPanelScreen}
            options={{ title: "Developer mode", headerRight: () => <NearbyBadge /> }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
