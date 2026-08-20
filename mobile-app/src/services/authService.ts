// Real account layer, backed by Supabase Auth (email OTP) + a `public.users`
// profile table - see supabase/schema.sql for the users-table SQL this
// expects to already exist. supabaseBackend.ts reads/writes the same real
// `users` table directly (no mock bridge needed - see its own header
// comment for why that's no longer necessary now that conversations,
// threads, and messages are real too).

import { supabase } from "./supabaseClient";
import { validateUsername } from "./usernameValidation";
import { User } from "./types";

interface UsersRow {
  id: string;
  auth_id: string;
  username: string;
  avatar_seed: string;
  avatar_icon: string | null;
  level: number;
  helpful_points: number;
  created_at: string;
  is_deleted: boolean;
  age_verified: boolean;
}

function mapRow(row: UsersRow): User {
  return {
    id: row.id,
    username: row.username,
    avatarSeed: row.avatar_seed,
    avatarIcon: row.avatar_icon ?? undefined,
    level: row.level,
    helpfulPoints: row.helpful_points,
    createdAt: row.created_at,
    badgeIds: [],
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function requestEmailCode(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.signInWithOtp({ email: normalizeEmail(email) });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyEmailCode(
  email: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: code.trim(),
    type: "email",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createProfile(
  username: string,
  ageVerified: boolean
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  if (!ageVerified) {
    return { ok: false, error: "You must confirm you're 18 or older to use Hereby." };
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, error: "Not signed in - verify your email first." };
  }

  // This auth account may already have a profile - e.g. local session
  // storage was lost (Expo Go scopes it per project slug) but the account
  // itself, tied to the verified email, still exists server-side. Use the
  // existing profile rather than attempting a second insert, which would
  // fail on the auth_id unique constraint and get misread as "username
  // taken" below.
  const { data: existing } = await supabase
    .from("users")
    .select()
    .eq("auth_id", authData.user.id)
    .maybeSingle();
  if (existing) {
    return { ok: true, user: mapRow(existing as UsersRow) };
  }

  const validation = validateUsername(username, authData.user.email ?? undefined);
  if (!validation.ok) return validation;

  const { data, error } = await supabase
    .from("users")
    .insert({
      auth_id: authData.user.id,
      username: username.trim(),
      avatar_seed: authData.user.id,
      age_verified: ageVerified,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That username is taken." };
    return { ok: false, error: error.message };
  }

  return { ok: true, user: mapRow(data as UsersRow) };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function restoreSession(): Promise<User | undefined> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return undefined;

  const { data, error } = await supabase
    .from("users")
    .select()
    .eq("auth_id", sessionData.session.user.id)
    .maybeSingle();

  if (error || !data) return undefined;

  return mapRow(data as UsersRow);
}
