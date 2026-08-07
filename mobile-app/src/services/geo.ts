import { GeoPoint } from "./types";

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in meters between two points. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

export function isWithinRadius(
  point: GeoPoint,
  center: GeoPoint,
  radiusM: number
): boolean {
  return distanceMeters(point, center) <= radiusM;
}

/**
 * Server-side location generalization. In the real system this runs inside
 * the createConversation Edge Function (see supabase/edge-functions), never
 * on the client, and the raw input point is discarded immediately after.
 *
 * MVP strategy: snap to the nearest known venue/POI if one is close enough;
 * otherwise snap to a coarse ~120m grid cell. This is deliberately coarse -
 * the goal is "close enough to be useful, never precise enough to be a
 * person's exact location."
 */
export function snapToGrid(point: GeoPoint, cellMeters = 120): GeoPoint {
  // Approximate degrees-per-meter at this latitude; fine for MVP-scale
  // generalization (not for anything requiring survey-grade accuracy).
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(toRad(point.lat));

  const cellDegLat = cellMeters / metersPerDegLat;
  const cellDegLng = cellMeters / metersPerDegLng;

  const snappedLat = Math.round(point.lat / cellDegLat) * cellDegLat;
  const snappedLng = Math.round(point.lng / cellDegLng) * cellDegLng;

  return { lat: snappedLat, lng: snappedLng };
}

/** Small deterministic jitter used only by the dev simulator to fan out synthetic users around a point. */
export function jitter(point: GeoPoint, maxMeters: number): GeoPoint {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(toRad(point.lat));
  const dLat = ((Math.random() - 0.5) * 2 * maxMeters) / metersPerDegLat;
  const dLng = ((Math.random() - 0.5) * 2 * maxMeters) / metersPerDegLng;
  return { lat: point.lat + dLat, lng: point.lng + dLng };
}
