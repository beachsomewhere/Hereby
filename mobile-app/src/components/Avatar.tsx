import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { getHerebie } from "../services/herebies";

interface Props {
  username: string;
  herebieId?: string;
  size: number;
}

/**
 * Shared Herebie renderer, used in both ProfileCard and MessageBubble so
 * the fallback logic lives in one place. See services/herebies.ts for the
 * unlockable character catalog. No Herebie has real exported artwork yet -
 * every id, valid or not, currently renders the same neutral placeholder
 * (initials in a circle) until real assets are wired into the registry,
 * at which point this component picks them up automatically.
 */
export function Avatar({ username, herebieId, size }: Props) {
  const herebie = getHerebie(herebieId);
  const label = `${username}'s Herebie avatar`;

  if (herebie.asset) {
    return (
      <Image
        source={herebie.asset}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel={label}
      />
    );
  }

  return (
    <View
      style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityLabel={label}
    >
      <Text style={[styles.initials, { fontSize: size * 0.32 }]}>{username.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: "#CECBF6", alignItems: "center", justifyContent: "center" },
  initials: { fontWeight: "500", color: "#26215C" },
});
