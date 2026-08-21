import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAppStore } from "../state/useAppStore";
import * as authService from "../services/authService";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { MapScreen } from "../screens/MapScreen";
import { ConversationScreen } from "../screens/ConversationScreen";
import { DevPanelScreen } from "../screens/DevPanelScreen";

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
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    authService.restoreSession().then((user) => {
      if (user) setCurrentUser(user);
      setSessionChecked(true);
    });
  }, [setCurrentUser]);

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
          <Stack.Screen name="DevPanel" component={DevPanelScreen} options={{ title: "Developer mode" }} />
        </>
      )}
    </Stack.Navigator>
  );
}
