import Supercluster from "supercluster";
import { ConversationCategory, ConversationSummary } from "./types";
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

/** Inverse of zoomFromRegion - the region delta that renders at roughly the given zoom. */
export function deltaForZoom(zoom: number): number {
  return 360 / Math.pow(2, zoom);
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
 * Which category tier is "currently in view" at a given zoom - the most
 * specific one that's actually visible right now. Used to default a newly
 * created conversation's category to whatever you're actually looking at,
 * so it renders immediately instead of defaulting to the narrowest tier and
 * staying invisible until you zoom in far past where you created it.
 */
export function categoryForZoom(zoom: number): ConversationCategory {
  const visible = (Object.keys(ZOOM_VISIBILITY) as ConversationCategory[])
    .filter((cat) => zoom >= ZOOM_VISIBILITY[cat])
    .sort((a, b) => ZOOM_VISIBILITY[b] - ZOOM_VISIBILITY[a]);
  return visible[0] ?? "area";
}

/**
 * A broader conversation should only represent a spot until something more
 * specific covering the same spot becomes zoom-visible too - then it should
 * transform into that more specific one, not keep showing alongside it.
 * Zooming back out makes the more specific one drop out of `visible` again
 * (its own threshold no longer met), so the broader one naturally
 * reappears. If nothing more specific exists yet, the broader one just
 * keeps showing - "show whatever is available."
 *
 * Call with the already zoom-filtered set (see isVisibleAtZoom); a
 * conversation is removed if some OTHER conversation in that same set has a
 * strictly more specific category and falls within its participation
 * radius (same eligibility rule as everywhere else - nesting, not mere
 * proximity).
 */
export function supersedeBroaderConversations(visible: ConversationSummary[]): ConversationSummary[] {
  return visible.filter(
    (c) =>
      !visible.some(
        (other) =>
          other.id !== c.id &&
          ZOOM_VISIBILITY[other.category] > ZOOM_VISIBILITY[c.category] &&
          distanceMeters(c.location, other.location) <= c.participationRadiusM
      )
  );
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
