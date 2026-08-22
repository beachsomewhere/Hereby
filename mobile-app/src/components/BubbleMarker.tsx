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
      <View
        style={[
          styles.card,
          { width, backgroundColor: colors.bg, borderColor: colors.border },
          conversation.isParticipant && styles.cardJoined,
        ]}
      >
        {conversation.isParticipant && (
          <View style={[styles.joinedBadge, { backgroundColor: colors.border }]}>
            <Text style={styles.joinedBadgeText}>✓</Text>
          </View>
        )}
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {conversation.title}
        </Text>
        <Text style={[styles.meta, { color: colors.text }]} numberOfLines={1}>
          {/* "active" (not "people"/"participants") - deliberately: this
              counts who's currently inside/grace right now, not everyone
              who's ever joined, so a joined-but-read_only member seeing
              their own conversation show 0 here read as a contradiction
              next to their own join checkmark. */}
          {conversation.participantCount} active · {heatLabel}
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
  cardJoined: {
    borderWidth: 2.5,
  },
  joinedBadge: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "white",
  },
  joinedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "white",
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
