import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "react-native-maps";
import { ConversationSummary } from "../services/types";
import { computeCardWidth, heatLevel } from "../services/activityScore";

export const HEAT_COLORS: Record<ReturnType<typeof heatLevel>, { bg: string; border: string; text: string }> = {
  new: { bg: "#E1F5EE", border: "#5DCAA5", text: "#04342C" },
  active: { bg: "#FAEEDA", border: "#EF9F27", text: "#412402" },
  hot: { bg: "#FAECE7", border: "#D85A30", text: "#4A1B0C" },
};

interface Props {
  conversation: ConversationSummary;
  onPress: (conversation: ConversationSummary) => void;
}

/**
 * Renders one conversation as an info card: title, participant count, and
 * activity level, always at a fixed readable font size. Activity
 * (services/activityScore.ts) scales the card's width, not its text - a
 * quiet conversation is a narrower card, never illegible text crammed into
 * a tiny circle.
 */
export function BubbleMarker({ conversation, onPress }: Props) {
  const level = heatLevel(conversation.activityScore);
  const colors = HEAT_COLORS[level];
  const width = computeCardWidth(conversation.renderSize);
  const heatLabel = level === "hot" ? "Hot" : level === "active" ? "Active" : "New";

  return (
    <Marker
      coordinate={{ latitude: conversation.location.lat, longitude: conversation.location.lng }}
      onPress={() => onPress(conversation)}
      tracksViewChanges={false}
    >
      <View style={[styles.card, { width, backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {conversation.title}
        </Text>
        <Text style={[styles.meta, { color: colors.text }]} numberOfLines={1}>
          {conversation.participantCount} {conversation.participantCount === 1 ? "person" : "people"} · {heatLabel}
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
