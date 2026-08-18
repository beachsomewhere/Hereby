// Enforces "not identifiable" per the account-creation privacy stance:
// usernames must not leak the account's real email, look like an
// email/phone number, or contain whitespace (handles don't have spaces;
// real names usually do). This is a blocklist of clear signals, not a name
// detector - it can't reliably tell a pseudonym from a real first name, so
// it's paired with UI nudging (default to a generated suggestion) rather
// than relied on alone.

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const DIGIT_RUN_RE = /\d{6,}/; // phone-number-shaped

export function validateUsername(
  username: string,
  email?: string
): { ok: true } | { ok: false; error: string } {
  const trimmed = username.trim();

  if (trimmed.includes("@")) {
    return { ok: false, error: "Don't use an email address as your username." };
  }
  if (!USERNAME_RE.test(trimmed)) {
    return { ok: false, error: "3-24 characters: letters, numbers, underscore only." };
  }
  if (DIGIT_RUN_RE.test(trimmed)) {
    return { ok: false, error: "That looks like a phone number - pick something else." };
  }
  if (email) {
    const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (local.length >= 3 && normalized.includes(local)) {
      return { ok: false, error: "Too close to your email - pick something that doesn't identify you." };
    }
  }
  return { ok: true };
}
