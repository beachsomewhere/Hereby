// Waze-style unlockable avatar icons - a way to stand out in chat without
// compromising the app's anonymity (no photos, no real names). Two icons
// per level, escalating from common to "rare," gated against the level
// thresholds in mockBackend.ts#computeLevel.

export interface AvatarIconOption {
  id: string;
  icon: string;
  requiredLevel: number;
}

export const AVATAR_ICONS: AvatarIconOption[] = [
  { id: "sprout", icon: "🌱", requiredLevel: 1 },
  { id: "spark", icon: "✨", requiredLevel: 1 },
  { id: "fox", icon: "🦊", requiredLevel: 2 },
  { id: "owl", icon: "🦉", requiredLevel: 2 },
  { id: "wolf", icon: "🐺", requiredLevel: 3 },
  { id: "falcon", icon: "🦅", requiredLevel: 3 },
  { id: "lion", icon: "🦁", requiredLevel: 4 },
  { id: "dragon", icon: "🐉", requiredLevel: 4 },
  { id: "crown", icon: "👑", requiredLevel: 5 },
  { id: "phoenix", icon: "🔥", requiredLevel: 5 },
];

export function unlockedIcons(level: number): AvatarIconOption[] {
  return AVATAR_ICONS.filter((i) => i.requiredLevel <= level);
}
