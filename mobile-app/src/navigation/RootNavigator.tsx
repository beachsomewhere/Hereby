import React, { useEffect, useState } from "react";
import { View } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAppStore } from "../state/useAppStore";
import * as authService from "../services/authService";
import * as backend from "../services/supabaseBackend";
import { registerForPushNotifications } from "../services/pushNotifications";
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

// Must be defined at module scope (before any component mounts) per
// TaskManager's own requirement - it can't be registered from inside a
// component render. Started/stopped imperatively below, only while the user
// has an active conversation membership (Location.startLocationUpdatesAsync
// only requires foreground permission when started as a "user-initiated
// foreground service" - see node_modules/expo-location/ios/LocationModule.swift's
// own comment on this exact distinction - so this needs no "Always" prompt).
// Reads the store directly via getState() since a module-scope task can't
// close over component props/state.
const BACKGROUND_PRESENCE_TASK = "hereby-background-presence";

TaskManager.defineTask(BACKGROUND_PRESENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error("background presence task error:", error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  const latest = locations?.[locations.length - 1];
  if (latest) {
    useAppStore.getState().setUserLocation({ lat: latest.coords.latitude, lng: latest.coords.longitude });
  }

  const currentUser = useAppStore.getState().currentUser;
  if (!currentUser) return;

  try {
    const ids = await backend.getMyActiveConversationIds();
    useAppStore.getState().setHasActiveMembership(ids.length > 0);
    if (ids.length === 0) {
      // Self-correcting: nothing left to track, stop the background task
      // rather than waiting on the component effect below to notice.
      await Location.stopLocationUpdatesAsync(BACKGROUND_PRESENCE_TASK).catch(() => {});
      return;
    }
    const location = latest
      ? { lat: latest.coords.latitude, lng: latest.coords.longitude }
      : useAppStore.getState().userLocation;
    if (!location) return;
    for (const conversationId of ids) {
      await backend.checkEligibility(currentUser.id, conversationId, location);
    }
  } catch (err) {
    console.error("background presence re-check failed:", err instanceof Error ? err.message : err);
  }
});

export function RootNavigator() {
  const currentUser = useAppStore((s) => s.currentUser);
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const devModeEnabled = useAppStore((s) => s.devModeEnabled);
  const setUserLocation = useAppStore((s) => s.setUserLocation);
  const hasActiveMembership = useAppStore((s) => s.hasActiveMembership);
  const setHasActiveMembership = useAppStore((s) => s.setHasActiveMembership);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    authService.restoreSession().then(async (user) => {
      if (user) {
        setCurrentUser(user);
        // Covers relaunching while already an active participant somewhere
        // (e.g. from earlier the same day) - without this, the background
        // watcher below would stay off until the next join/leave action
        // happened to refresh it.
        try {
          const ids = await backend.getMyActiveConversationIds();
          setHasActiveMembership(ids.length > 0);
        } catch (err) {
          console.error("getMyActiveConversationIds on launch failed:", err instanceof Error ? err.message : err);
        }
        // Previously onboarding-only (OnboardingScreen.tsx) - a returning
        // user who declined the permission prompt, or whose registration
        // failed/never ran, had no way back to a working state even after
        // later granting permission via iOS Settings, since nothing ever
        // retried. Safe to call every launch: it's a no-op if permission is
        // already denied or on a simulator, and only re-prompts if the OS
        // hasn't recorded a decision yet.
        registerForPushNotifications().catch((err) =>
          console.error("registerForPushNotifications on launch failed:", err instanceof Error ? err.message : err)
        );
      }
      setSessionChecked(true);
    });
  }, [setCurrentUser, setHasActiveMembership]);

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

  // Starts/stops the background presence task (defined at module scope
  // above) so it runs only while genuinely active somewhere, not for the
  // whole session regardless of chat membership. timeInterval here mirrors
  // the foreground watcher above and is what actually guarantees periodic
  // re-verification for a genuinely stationary user (like an overnight
  // test) - distanceInterval alone could mean no further callbacks at all
  // once someone stops moving.
  useEffect(() => {
    // Every reason this could turn off (logout, dev mode, or dropping to
    // zero active memberships) needs to reach the stop branch below - not
    // just an early return - or the task keeps running invisibly until the
    // next time hasActiveMembership happens to flip.
    const shouldRun = !!currentUser && !devModeEnabled && hasActiveMembership;
    let cancelled = false;
    (async () => {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_PRESENCE_TASK).catch(
        () => false
      );
      if (shouldRun) {
        if (alreadyStarted) return;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        await Location.startLocationUpdatesAsync(BACKGROUND_PRESENCE_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 4 * 60 * 1000,
          distanceInterval: 15,
          showsBackgroundLocationIndicator: true,
        });
      } else if (alreadyStarted && !cancelled) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_PRESENCE_TASK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, devModeEnabled, hasActiveMembership]);

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
