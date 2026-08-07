import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "react-native-maps";

interface Props {
  coordinate: { latitude: number; longitude: number };
  count: number;
  label?: string;
  onPress: () => void;
}

/**
 * Purely a display concern - see services/clustering.ts. Tapping zooms the
 * map into the cluster rather than opening a conversation, since a cluster
 * isn't content, it's navigation.
 */
export function ClusterMarker({ coordinate, count, label, onPress }: Props) {
  return (
    <Marker coordinate={coordinate} onPress={onPress} tracksViewChanges={false}>
      <View style={styles.badge}>
        <Text style={styles.text}>{label ? `${label} — ${count}` : `${count} conversations`}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#F1EFE8",
    borderColor: "#B4B2A9",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  text: {
    fontSize: 12,
    fontWeight: "500",
    color: "#2C2C2A",
  },
});
