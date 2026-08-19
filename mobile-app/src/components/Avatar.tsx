import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  username: string;
  avatarIcon?: string;
  size: number;
}

/**
 * Shared "icon if chosen, else initials" avatar, used in both ProfileCard
 * and MessageBubble so the fallback logic lives in one place. See
 * services/avatarIcons.ts for the unlockable icon catalog.
 */
export function Avatar({ username, avatarIcon, size }: Props) {
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
        avatarIcon && styles.circleIcon,
      ]}
    >
      {avatarIcon ? (
        <Text style={{ fontSize: size * 0.55 }}>{avatarIcon}</Text>
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.32 }]}>{username.slice(0, 2).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: "#CECBF6", alignItems: "center", justifyContent: "center" },
  circleIcon: { backgroundColor: "#F1EFE8" },
  initials: { fontWeight: "500", color: "#26215C" },
});
