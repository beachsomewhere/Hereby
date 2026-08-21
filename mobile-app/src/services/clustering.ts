import Supercluster from "supercluster";
import { ConversationSummary } from "./types";
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

// Chats pick an arbitrary radius (a slider, not fixed tiers) from this
// range - small enough to mean "a specific spot" (~1000 sqft) up to a wide
// area/event.
export const MIN_RADIUS_M = 5;
export const MAX_RADIUS_M = 800;

// Minimum zoom (see zoomFromRegion, 0-20 scale) at which a conversation of a
// given radius becomes visible on the map - the wider it reaches, the
// further out it stays visible; narrower ones only appear once you've
// zoomed in past them. Log relationship tuned to feel roughly like the old
// fixed tiers did (25m -> ~15, 250m -> ~11, 800m -> 9), clamped to a sane
// range. Purely a display concern, tunable.
export function minZoomForRadius(radiusM: number): number {
  const raw = 20.6 - 1.73 * Math.log(Math.max(1, radiusM));
  return Math.max(7, Math.min(18, raw));
}

export function isVisibleAtZoom(radiusM: number, zoom: number): boolean {
  return zoom >= minZoomForRadius(radiusM);
}

/**
 * Inverse of minZoomForRadius - the radius that would just barely be
 * visible at a given zoom. Used to default a newly created conversation's
 * radius to whatever's already in view, so it renders immediately instead
 * of defaulting to the narrowest size and staying invisible until you zoom
 * in far past where you created it.
 */
export function defaultRadiusForZoom(zoom: number): number {
  const r = Math.exp((20.6 - zoom) / 1.73);
  return Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, r));
}

// Short, display-only size descriptor - never stored, just a friendlier
// gloss on the raw meter figure shown alongside it.
export function radiusDescriptor(radiusM: number): string {
  if (radiusM <= 40) return "A specific spot";
  if (radiusM <= 150) return "About venue-sized";
  if (radiusM <= 400) return "A wide area";
  return "Very wide";
}

/**
 * A broader conversation is only redundant with narrower ones nested inside
 * it when there's a genuine CLUSTER of several of them - one lone narrower
 * conversation (e.g. a single house's chat inside a block-wide one) is a
 * separate, independently useful conversation, not a stand-in the wide one
 * should disappear in favor of. Confirmed live: with the old "any nested
 * narrower conversation supersedes" rule, a legitimately separate
 * block-level chat became permanently invisible the moment a single nested
 * house chat also became zoom-visible, with no way back short of zooming
 * out past the wide chat's own threshold too.
 *
 * Zooming back out drops the narrower ones out of `visible` again (their
 * own threshold no longer met), so the broader one naturally reappears
 * regardless of the count involved.
 *
 * Call with the already zoom-filtered set (see isVisibleAtZoom); a
 * conversation is removed only if 2+ OTHER conversations in that same set
 * have a strictly smaller radius and fall within its participation radius
 * (same eligibility rule as everywhere else - nesting, not mere proximity).
 */
export function supersedeBroaderConversations(visible: ConversationSummary[]): ConversationSummary[] {
  return visible.filter((c) => {
    const nestedNarrower = visible.filter(
      (other) =>
        other.id !== c.id &&
        other.participationRadiusM < c.participationRadiusM &&
        distanceMeters(c.location, other.location) <= c.participationRadiusM
    );
    return nestedNarrower.length < 2;
  });
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
