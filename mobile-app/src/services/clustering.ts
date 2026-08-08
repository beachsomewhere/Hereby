import Supercluster from "supercluster";
import { ConversationCategory, ConversationSummary, GeoPoint } from "./types";
import { distanceMeters } from "./geo";

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

// Minimum zoom (see zoomFromRegion, 0-20 scale) at which each category's
// conversations become visible on the map - the wider/broader a category,
// the further out it stays visible; more specific ones only appear once
// you've zoomed in past them. Purely a display concern, tunable.
export const ZOOM_VISIBILITY: Record<ConversationCategory, number> = {
  area: 9,
  corridor: 9,
  venue: 12,
  micro_location: 15,
};

export function isVisibleAtZoom(category: ConversationCategory, zoom: number): boolean {
  return zoom >= ZOOM_VISIBILITY[category];
}

/**
 * A cluster of nearby conversations isn't a real, persistent entity - it's
 * just several already-real conversations that happen to render close
 * together at this zoom. If a genuinely broader conversation already
 * covers that spot (lower zoom threshold than every clustered item, and the
 * cluster's centroid falls inside its discovery radius), that's what
 * "the cluster's own chat" should be - preferring the narrowest such match.
 * Returns undefined if no covering conversation exists yet.
 */
export function findWiderConversation(
  leaves: ConversationSummary[],
  centroid: GeoPoint,
  all: ConversationSummary[]
): ConversationSummary | undefined {
  if (leaves.length === 0) return undefined;
  const leafIds = new Set(leaves.map((l) => l.id));
  const leafMinThreshold = Math.min(...leaves.map((l) => ZOOM_VISIBILITY[l.category]));
  const candidates = all.filter(
    (c) =>
      !leafIds.has(c.id) &&
      ZOOM_VISIBILITY[c.category] < leafMinThreshold &&
      distanceMeters(c.location, centroid) <= c.discoveryRadiusM
  );
  candidates.sort((a, b) => ZOOM_VISIBILITY[b.category] - ZOOM_VISIBILITY[a.category]);
  return candidates[0];
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
