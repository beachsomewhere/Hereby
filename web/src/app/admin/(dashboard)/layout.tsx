import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import { SignOutButton } from "./SignOutButton";

// proxy.ts already redirects an unauthenticated request to /admin/login
// before this ever renders, but per Next's own guidance (see proxy.ts's
// comment) a matcher change could silently remove that coverage - this is
// the real enforcement point, re-checked here on every /admin/* page via
// this layout. is_moderator() (schema.sql) is the actual security
// boundary regardless (SECURITY DEFINER, checked again inside every admin
// RPC) - this redirect is just so a non-moderator sees a clear message
// instead of an empty/broken dashboard.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: isModerator, error } = await supabase.rpc("is_moderator");
  // A schema-side problem (function/column missing, e.g. schema.sql's admin
  // section not applied yet) would otherwise look identical to "you're not
  // a moderator" - surface it distinctly instead of silently redirecting.
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F5] px-4">
        <p className="max-w-md text-sm text-[#A32D2D]">
          Couldn&rsquo;t check moderator access: {error.message}. Has schema.sql&rsquo;s admin dashboard
          section been applied yet?
        </p>
      </div>
    );
  }
  if (!isModerator) redirect("/admin/not-authorized");

  // Same visual language as the marketing site's sticky TopNav (see
  // (marketing)/TopNav.tsx) - same palette, same sticky/border treatment -
  // kept as Tailwind rather than importing marketing.css directly, since
  // that file's broader resets are deliberately scoped away from /admin
  // (see its own header comment).
  return (
    <div className="min-h-screen bg-[#FAF9F5]">
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EDEBE3] bg-[#FAF9F5] px-6 py-3.5">
        <div className="flex items-center gap-5">
          <a href="/admin" className="text-base font-semibold tracking-tight text-[#2C2C2A]">
            Hereby admin
          </a>
          <a href="/admin" className="text-sm text-[#5F5E5A] hover:text-[#2C2C2A]">
            Dashboard
          </a>
          <a href="/admin/reports" className="text-sm text-[#5F5E5A] hover:text-[#2C2C2A]">
            Reports
          </a>
        </div>
        <div className="flex items-center gap-5">
          <a href="/" className="text-sm text-[#5F5E5A] hover:text-[#2C2C2A]">
            Hereby.help
          </a>
          <SignOutButton />
        </div>
      </nav>
      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
