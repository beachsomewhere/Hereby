import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAppStore } from "../state/useAppStore";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { MapScreen } from "../screens/MapScreen";
import { ConversationScreen } from "../screens/ConversationScreen";
import { DevPanelScreen } from "../screens/DevPanelScreen";

export type RootStackParamList = {
  Onboarding: undefined;
  Map: undefined;
  Conversation: { conversationId: string };
  DevPanel: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const currentUser = useAppStore((s) => s.currentUser);

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
