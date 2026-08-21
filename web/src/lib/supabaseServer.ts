import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY - add them to web/.env.local"
  );
}

// For use in Server Components and Server Functions. Writes here only take
// effect when called from a Server Function/Route Handler - a plain Server
// Component can't set cookies, so setAll's failure there is expected and
// harmless as long as proxy.ts is refreshing the session on every request.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(url!, anonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component - fine, proxy.ts refreshes the
          // session cookie on the next request regardless.
        }
      },
    },
  });
}
