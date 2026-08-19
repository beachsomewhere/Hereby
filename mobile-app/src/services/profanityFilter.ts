// Display-only profanity mask - a first pass per phase1-strategy.md section
// 12 ("automated profanity/abuse filtering as a first pass"), not a full
// NLP/slur-detection system. Never mutates stored message bodies - only
// applied where text renders, so a moderator reviewing a report still sees
// the real text (mirrors how raw GPS coordinates are only ever used
// in-memory in checkEligibility and never stored - see geo.ts).

const PROFANE_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "damn",
  "crap",
  "dick",
  "piss",
  "cunt",
  "whore",
  "slut",
  "douche",
  "prick",
];

// Matches the root plus any trailing word characters (fuck -> fucking,
// fucked, fucks), not just the exact word - masks the whole inflected
// span. A word-boundary-on-both-ends match would miss "fucking" entirely.
const PATTERN = new RegExp(`\\b(${PROFANE_WORDS.join("|")})\\w*`, "gi");

export function maskProfanity(text: string): string {
  return text.replace(PATTERN, (match) => match[0] + "*".repeat(match.length - 1));
}
