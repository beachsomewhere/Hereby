import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "react-native-maps";
import { heatLevel } from "../services/activityScore";

const HEAT_COLORS: Record<ReturnType<typeof heatLevel>, { bg: string; border: string; text: string }> = {
  new: { bg: "#E1F5EE", border: "#5DCAA5", text: "#04342C" },
  active: { bg: "#FAEEDA", border: "#EF9F27", text: "#412402" },
  hot: { bg: "#FAECE7", border: "#D85A30", text: "#4A1B0C" },
};

interface Props {
  coordinate: { latitude: number; longitude: number };
  count: number;
  label?: string;
  activityScore: number;
  renderSize: number;
  onPress: () => void;
}

/**
 * A cluster of nearby conversations that are too close together to render
 * as separate bubbles at this zoom level. Styled in the same bubble
 * language as BubbleMarker (heat-colored, sized by combined activity) so it
 * reads as "one big bubble" rather than navigation chrome - see
 * services/clustering.ts. Tapping still zooms the map into the cluster
 * rather than opening a conversation, since it represents several distinct
 * topics, not one.
 */
export function ClusterMarker({ coordinate, count, label, activityScore, renderSize, onPress }: Props) {
  const level = heatLevel(activityScore);
  const colors = HEAT_COLORS[level];

  return (
    <Marker coordinate={coordinate} onPress={onPress} tracksViewChanges={false}>
      <View
        style={[
          styles.bubble,
          {
            width: renderSize,
            height: renderSize,
            borderRadius: renderSize / 2,
            backgroundColor: colors.bg,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.text }]} numberOfLines={2}>
          {label ?? `${count} chats`}
        </Text>
        <Text style={[styles.count, { color: colors.text }]}>{count}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
  },
  count: {
    fontSize: 9,
    fontWeight: "600",
    marginTop: 1,
  },
});
