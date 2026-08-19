// Pure, stateless - shared by mockBackend.ts (dev-only) and
// supabaseBackend.ts (production) so neither has to import from the other.

const ADJECTIVES = ["Quiet", "Amber", "Coastal", "Rapid", "Gentle", "Bold", "Steady", "Curious"];
const NOUNS = ["Falcon", "Harbor", "Maple", "Ridge", "Comet", "Otter", "Lantern", "Cedar"];

export function generatePseudonym(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${a}${n}${num}`;
}
