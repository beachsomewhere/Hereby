import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "react-native-maps";
import { computeCardWidth, heatLevel } from "../services/activityScore";

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
 * as separate cards at this zoom level. Styled as an info card in the same
 * language as BubbleMarker (heat-colored, width scaled by combined
 * activity, fixed readable text) so it reads as "one big bubble" rather
 * than navigation chrome - see services/clustering.ts. Tapping still zooms
 * the map into the cluster rather than opening a conversation, since it
 * represents several distinct topics, not one.
 */
export function ClusterMarker({ coordinate, count, label, activityScore, renderSize, onPress }: Props) {
  const level = heatLevel(activityScore);
  const colors = HEAT_COLORS[level];
  const width = computeCardWidth(renderSize);

  return (
    <Marker coordinate={coordinate} onPress={onPress} tracksViewChanges={false}>
      <View style={[styles.card, { width, backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {label ?? "Nearby chats"}
        </Text>
        <Text style={[styles.meta, { color: colors.text }]} numberOfLines={1}>
          {count} {count === 1 ? "chat" : "chats"}
        </Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 15,
  },
  meta: {
    fontSize: 10.5,
    marginTop: 3,
    opacity: 0.8,
  },
});
