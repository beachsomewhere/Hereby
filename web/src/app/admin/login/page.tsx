"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

// Mirrors mobile-app/src/services/authService.ts's requestEmailCode/
// verifyEmailCode two-step flow, reimplemented against the web browser
// client (mobile's supabaseClient.ts is RN-only, can't be shared - see its
// own header comment). There's no signup path here: an account only gets
// admin access by already existing (created via the mobile app) and being
// promoted to moderator via manual SQL - see schema.sql. A login for an
// unrecognized or non-moderator account still succeeds at the auth layer,
// it's admin/layout.tsx's is_moderator() check that turns it away.
export default function AdminLoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF9F5] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-[#2C2C2A]">Hereby admin</h1>
        <p className="mb-6 text-sm text-[#5F5E5A]">
          {step === "email" ? "Sign in with your Hereby account email." : `Enter the code sent to ${email}.`}
        </p>

        {step === "email" ? (
          <form onSubmit={handleRequestCode} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-[#D3D1C7] bg-white px-3 py-2 text-sm text-[#2C2C2A] outline-none focus:border-[#2C2C2A]"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#2C2C2A] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="w-full rounded-lg border border-[#D3D1C7] bg-white px-3 py-2 text-sm text-[#2C2C2A] outline-none focus:border-[#2C2C2A]"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#2C2C2A] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="w-full text-center text-xs text-[#888780]"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-[#A32D2D]">{error}</p>}
      </div>
    </div>
  );
}
