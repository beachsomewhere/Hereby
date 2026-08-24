import { ImageSourcePropType } from "react-native";

// Herebies: unlockable mascot characters, replacing the old plain-emoji
// avatar icons (see git history for avatarIcons.ts). Same level-gated
// unlock shape as before, just backed by real artwork instead of an emoji
// string. `asset` is deliberately optional - no Herebie has real exported
// artwork yet, so Avatar.tsx falls back to a plain neutral placeholder
// until a real file is dropped in and wired up here. That's a one-line
// change per character (asset: require("../../assets/herebies/<id>.png")),
// not a restructuring - Avatar already knows how to render a real asset
// the moment one exists.
export interface Herebie {
  id: string;
  name: string;
  levelRequired: number;
  asset?: ImageSourcePropType;
}

export const HEREBIES: Herebie[] = [{ id: "basic", name: "Original Herebie", levelRequired: 1 }];

export function unlockedHerebies(level: number): Herebie[] {
  return HEREBIES.filter((h) => h.levelRequired <= level);
}

// Basic is always unlocked (levelRequired: 1, and every account starts at
// level 1) - the correct, permanent fallback for a missing/invalid id, an
// old pre-Herebie emoji value, or no selection at all.
export function getHerebie(id: string | undefined): Herebie {
  return HEREBIES.find((h) => h.id === id) ?? HEREBIES[0];
}
