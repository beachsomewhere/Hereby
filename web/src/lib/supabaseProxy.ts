import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Refreshes the auth session cookie on every matched request (a plain Server
// Component can read cookies but can't write them, so without this an
// expired token would just sit stale until something else happens to
// refresh it) and redirects unauthenticated /admin/* requests to the login
// page. Deliberately does NOT check the moderator role here - that's a
// per-request DB round trip better placed once in admin/layout.tsx (a
// Server Component, runs for every /admin/* page anyway) than duplicated
// into proxy on top of the session refresh. This also matches Next's own
// guidance for proxy.ts: keep it thin, verify authorization again where the
// data is actually used - the real enforcement lives in is_moderator()
// inside the admin RPCs themselves (schema.sql), not here.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/admin/login";

  if (!user && !isLoginPage) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
