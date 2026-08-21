"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className="text-sm text-[#888780] hover:text-[#2C2C2A]">
      Sign out
    </button>
  );
}
