import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY - add them to mobile-app/.env"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// supabase-js's auto-refresh timer relies on JS timers, which React Native
// throttles/suspends while backgrounded - a token due to refresh mid-
// background can sit stale until whatever the next call happens to be
// (confirmed live: a checkEligibility call right after foregrounding via a
// notification tap got 401'd this way). Per Supabase's own React Native
// guidance, tying start/stop to AppState forces an immediate refresh check
// on every foreground transition instead of waiting on that timer.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
