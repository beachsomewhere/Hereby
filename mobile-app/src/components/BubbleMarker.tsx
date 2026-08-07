import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "react-native-maps";
import { ConversationSummary } from "../services/types";
import { heatLevel } from "../services/activityScore";

const HEAT_COLORS: Record<ReturnType<typeof heatLevel>, { bg: string; border: string; text: string }> = {
  new: { bg: "#E1F5EE", border: "#5DCAA5", text: "#04342C" },
  active: { bg: "#FAEEDA", border: "#EF9F27", text: "#412402" },
  hot: { bg: "#FAECE7", border: "#D85A30", text: "#4A1B0C" },
};

interface Props {
  conversation: ConversationSummary;
  onPress: (conversation: ConversationSummary) => void;
}

/**
 * Renders one conversation as a chat-bubble-shaped marker. Size comes from
 * ConversationSummary.renderSize (already log-scaled and capped - see
 * services/activityScore.ts). Kept as a plain custom marker view rather than
 * an image so size/color changes animate cheaply as the score updates.
 */
export function BubbleMarker({ conversation, onPress }: Props) {
  const level = heatLevel(conversation.activityScore);
  const colors = HEAT_COLORS[level];
  const size = conversation.renderSize;

  return (
    <Marker
      coordinate={{ latitude: conversation.location.lat, longitude: conversation.location.lng }}
      onPress={() => onPress(conversation)}
      tracksViewChanges={false}
    >
      <View
        style={[
          styles.bubble,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.bg,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.text }]} numberOfLines={2}>
          {conversation.title}
        </Text>
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
});
