import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabaseProxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
