import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { RootNavigator } from "./src/navigation/RootNavigator";

// Entry point. Real Supabase client initialization would happen here (or in
// src/services/backend.ts) behind an environment flag; in this prototype
// src/services/mockBackend.ts stands in for the whole Supabase + Edge
// Functions layer described in the Phase 1 architecture doc, so the app is
// runnable with zero external accounts or API keys.
export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <RootNavigator />
    </NavigationContainer>
  );
}
