import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY - add them to web/.env.local"
  );
}

// For use in Client Components. Session lives in cookies (via @supabase/ssr)
// rather than localStorage, so it's readable server-side by supabaseServer.ts
// and proxy.ts - required for gating /admin/* before a page even renders.
// mobile-app/src/services/supabaseClient.ts can't be reused here: it's built
// on AsyncStorage + React Native's AppState, neither of which exists in a
// browser.
export function createClient() {
  return createBrowserClient(url!, anonKey!);
}
