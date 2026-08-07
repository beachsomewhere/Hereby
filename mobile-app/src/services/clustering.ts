import Supercluster from "supercluster";
import { ConversationSummary } from "./types";

// Thin wrapper around supercluster (the same library used in Mapbox's own
// clustering examples). This is purely a display concern - see Phase 1
// section 7. It never touches conversation content, only positions.

export interface ClusterPoint {
  type: "Feature";
  properties: { cluster: false; conversation: ConversationSummary };
  geometry: { type: "Point"; coordinates: [number, number] };
}

export function buildClusterIndex(conversations: ConversationSummary[]) {
  const index = new Supercluster<{ conversation: ConversationSummary }>({
    radius: 60,
    maxZoom: 17,
  });
  index.load(
    conversations.map((c) => ({
      type: "Feature",
      properties: { conversation: c },
      geometry: { type: "Point", coordinates: [c.location.lng, c.location.lat] },
    }))
  );
  return index;
}

export function bboxFromRegion(region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }): [number, number, number, number] {
  return [
    region.longitude - region.longitudeDelta / 2,
    region.latitude - region.latitudeDelta / 2,
    region.longitude + region.longitudeDelta / 2,
    region.latitude + region.latitudeDelta / 2,
  ];
}

/** Rough zoom estimate from a react-native-maps region delta, good enough for supercluster's getClusters(bbox, zoom). */
export function zoomFromRegion(longitudeDelta: number): number {
  const zoom = Math.log2(360 / longitudeDelta);
  return Math.max(0, Math.min(20, Math.round(zoom)));
}

/** Best-guess label for a cluster: the most common venueLabel among its points, falling back to undefined. */
export function dominantVenueLabel(conversations: ConversationSummary[]): string | undefined {
  const counts = new Map<string, number>();
  conversations.forEach((c) => {
    if (!c.venueLabel) return;
    counts.set(c.venueLabel, (counts.get(c.venueLabel) ?? 0) + 1);
  });
  let best: string | undefined;
  let bestCount = 0;
  counts.forEach((count, label) => {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  });
  return best;
}
