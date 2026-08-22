import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { navigationRef, handleColdStartNotification } from "./src/services/pushNotifications";

export default function App() {
  useEffect(() => {
    handleColdStartNotification();
  }, []);

  return (
    // Required for useSafeAreaInsets() (see ConversationScreen's input row)
    // to return real device insets rather than throwing/defaulting to zero -
    // nothing previously provided this context anywhere in the tree.
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="auto" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
