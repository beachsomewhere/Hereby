import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Region } from "react-native-maps";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/supabaseBackend";
import { ConversationSummary, GeoPoint } from "../services/types";
import { BubbleMarker, HEAT_COLORS } from "../components/BubbleMarker";
import { ClusterMarker } from "../components/ClusterMarker";
import { ConversationPreviewSheet } from "../components/ConversationPreviewSheet";
import { CreateConversationSheet } from "../components/CreateConversationSheet";
import {
  bboxFromRegion,
  buildClusterIndex,
  defaultRadiusForZoom,
  deltaForZoom,
  dominantVenueLabel,
  isVisibleAtZoom,
  minZoomForRadius,
  MIN_RADIUS_M,
  supersedeBroaderConversations,
  zoomFromRegion,
} from "../services/clustering";
import { computeRenderSize, heatLevel } from "../services/activityScore";

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

const DEFAULT_REGION: Region = {
  latitude: 37.6213,
  longitude: -122.379,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

export function MapScreen({ navigation }: Props) {
  const currentUser = useAppStore((s) => s.currentUser);
  const location = useAppStore(effectiveLocation);
  const devModeEnabled = useAppStore((s) => s.devModeEnabled);
  const devSimulatedLocation = useAppStore((s) => s.devSimulatedLocation);
  const setDevSimulatedLocation = useAppStore((s) => s.setDevSimulatedLocation);

  // React Navigation's native stack keeps this screen mounted (not
  // unmounted) while ConversationScreen is pushed on top of it - gating the
  // poll effect below on focus avoids competing for the same network/CPU
  // as that screen's own polling while it's the one on top. Real GPS
  // watching now lives in RootNavigator instead of here, since it needs to
  // keep running for the whole session, not just while this screen is
  // focused - see its comment for why.
  const isFocused = useIsFocused();

  const mapRef = useRef<MapView>(null);
  // Shared across every animateToRegion call site (the GPS-follow effect
  // below and handleRegionChangeComplete's own gesture-correction) so at
  // most one is ever in flight at a time. Confirmed live as a real bug:
  // react-native-maps doesn't settle cleanly when a second animateToRegion
  // interrupts a first one still in progress - the JS-side `region` state
  // (which everything, including isVisibleAtZoom/getClusters for every
  // marker, is derived from) can end up permanently describing something
  // other than what's actually rendered natively, hiding a conversation's
  // marker until enough further gestures happen to accidentally resync it.
  // Longer animations (see the GPS-follow effect) widen the window a
  // colliding gesture can land in, so this matters more now than it used to.
  const animatingRef = useRef(false);
  function animateRegion(next: Region, duration: number) {
    if (animatingRef.current) {
      // Something's already animating - jump straight there instead of
      // stacking a second animateToRegion on top of it.
      mapRef.current?.animateToRegion(next, 0);
      return;
    }
    animatingRef.current = true;
    mapRef.current?.animateToRegion(next, duration);
    setTimeout(() => {
      animatingRef.current = false;
    }, duration + 50);
  }
  const [region, setRegion] = useState<Region>(
    location ? { ...DEFAULT_REGION, latitude: location.lat, longitude: location.lng } : DEFAULT_REGION
  );
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary>();
  const [previewNearby, setPreviewNearby] = useState<ConversationSummary[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLocation, setCreateLocation] = useState<GeoPoint>();
  const [createRadius, setCreateRadius] = useState<number>(MIN_RADIUS_M);
  // Zoom level right before the create-chat sheet opens, so closing it can
  // restore that framing instead of leaving the map at whatever zoom the
  // radius slider last set (e.g. closing right after dragging to "wide
  // area" would otherwise leave the user zoomed way out).
  const preOpenRegionRef = useRef<Region | null>(null);

  // Guards against overlapping poll ticks: if a request is still in flight
  // when the next 5s interval fires (slow network, cold start), skip that
  // tick instead of stacking a second concurrent request on top - unbounded
  // stacking here was confirmed live as the cause of steadily-compounding
  // request latency across the whole app during a session.
  const refreshInFlightRef = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const center: GeoPoint = location ?? { lat: region.latitude, lng: region.longitude };
      const results = await backend.getVisibleConversations(center);
      setConversations(results);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [location, region.latitude, region.longitude]);

  // Without gating on focus (isFocused, declared above) this poll +
  // realtime channel would keep running indefinitely in the background the
  // whole time a user is inside a chat, competing for the same network/CPU
  // as that screen's own polling - see the note above on why this screen
  // stays mounted rather than unmounting.
  useEffect(() => {
    if (!isFocused) return;
    refresh();
    const unsubscribe = backend.subscribeToMap(refresh);
    const interval = setInterval(refresh, 5000); // mirrors the periodic activity-score broadcast
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh, isFocused]);

  // Recenter whenever location changes (app load, dev-mode teleport, real
  // movement). If nothing would be visible at the zoom we're already at -
  // e.g. the only conversation here is a specific gate chat with no
  // broader venue/area one covering it - zoom in enough to reveal the
  // nearest available one instead of landing on an apparently-empty map.
  // Only kicks in when the current zoom shows nothing, so it never fights
  // deliberate manual zooming once something's already in view.
  //
  // Animated over 1.5s rather than a quick snap - real GPS fixes only
  // arrive every ~10s/15m (see RootNavigator's watchPositionAsync config),
  // so a short animation reads as a jump-pause-jump; stretching it a bit
  // reads as drift instead. Kept well under the ~10s gap between fixes
  // (and routed through animateRegion above) so it's very unlikely to still
  // be running when the next update - or a manual gesture - arrives. True
  // nav-app-smooth motion would need dead-reckoning interpolation between
  // fixes plus much more frequent GPS polling than this app needs for a
  // stand-around-and-chat use case, so this is a cheap approximation, not
  // that.
  useEffect(() => {
    if (!location) return;
    (async () => {
      const results = await backend.getVisibleConversations(location);
      const currentZoom = zoomFromRegion(region.longitudeDelta);
      const alreadyVisible = results.some((c) => minZoomForRadius(c.participationRadiusM) <= currentZoom);
      const nearestThreshold =
        results.length > 0 && !alreadyVisible
          ? Math.min(...results.map((c) => minZoomForRadius(c.participationRadiusM)))
          : undefined;
      setRegion((r) => {
        const next = {
          ...r,
          latitude: location.lat,
          longitude: location.lng,
          ...(nearestThreshold !== undefined
            ? { latitudeDelta: deltaForZoom(nearestThreshold), longitudeDelta: deltaForZoom(nearestThreshold) }
            : {}),
        };
        animateRegion(next, 1500);
        return next;
      });
    })();
  }, [location?.lat, location?.lng]);

  const zoom = zoomFromRegion(region.longitudeDelta);

  // Zoom-visible, then superseded: a broader conversation (e.g. "airport
  // wide") only disappears in favor of narrower ones nested inside it when
  // there's a genuine CLUSTER of several of them - a single lone nested
  // conversation is a separate, independently useful chat (e.g. one house
  // inside a block-wide chat), not a stand-in the wide one should vanish
  // for. See supersedeBroaderConversations for the exact threshold.
  const visibleConversations = useMemo(() => {
    const zoomVisible = conversations.filter((c) => isVisibleAtZoom(c.participationRadiusM, zoom));
    return supersedeBroaderConversations(zoomVisible);
  }, [conversations, zoom]);

  // Opens the preview sheet for a conversation, alongside any nested ones
  // worth surfacing as "more specific chats to zoom in for" - whatever's
  // still hidden by zoom. No extra distance check needed here -
  // `conversations` is already eligibility-gated (see
  // getVisibleConversations), so everything in it is already something the
  // user's own pin is inside.
  function selectConversation(conversation: ConversationSummary) {
    setSelected(conversation);
    const zoomHidden = conversations.filter(
      (c) => c.id !== conversation.id && !isVisibleAtZoom(c.participationRadiusM, zoom)
    );
    setPreviewNearby(zoomHidden);
  }

  const clusterIndex = useMemo(() => {
    if (visibleConversations.length === 0) return undefined;
    return buildClusterIndex(visibleConversations);
  }, [visibleConversations]);

  const clusterItems = useMemo(() => {
    if (!clusterIndex) return [];
    const bbox = bboxFromRegion(region);
    // Pad the bbox by the widest currently zoom-visible conversation's own
    // radius - confirmed live as a real bug: getClusters only includes a
    // conversation whose plotted CENTER point falls inside the viewport
    // bbox, but a wide conversation is relevant to anyone standing within
    // its radius, not just someone whose view happens to contain its exact
    // center. Without this, a wide chat's card could disappear entirely
    // while zoomed in tight on a different, narrower nearby one, even
    // though you're still well within the wide one's own coverage area.
    const maxRadiusM = visibleConversations.reduce((max, c) => Math.max(max, c.participationRadiusM), 0);
    const padDegrees = maxRadiusM / 111320;
    const paddedBbox: [number, number, number, number] = [
      bbox[0] - padDegrees,
      bbox[1] - padDegrees,
      bbox[2] + padDegrees,
      bbox[3] + padDegrees,
    ];
    return clusterIndex.getClusters(paddedBbox, zoom);
  }, [clusterIndex, region, zoom, visibleConversations]);

  // Deliberately ignores the long-pressed coordinate for the conversation's
  // actual origin - confirmed live as a real bug: long-pressing anywhere on
  // the visible map (including somewhere the user isn't physically at) let
  // them create a conversation there, which then immediately showed as
  // read-only since checkEligibility correctly found them outside their own
  // new chat's radius. A conversation's origin must always be the user's
  // real current location, same rule as handleStartChatPress below - the
  // long-press gesture still opens the create sheet, it just can't be used
  // to place a chat somewhere other than where the user actually is.
  function handleLongPress() {
    if (!location) return;
    preOpenRegionRef.current = region;
    setCreateLocation(location);
    setCreateVisible(true);
  }

  // Dev-mode convenience: a plain tap on the map "teleports" the simulated
  // GPS location there, as an alternative to typing lat/lng into the dev
  // panel. Long-press (above) is a separate gesture and still creates a
  // conversation, so the two don't conflict.
  function handleMapPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    if (!devModeEnabled) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setDevSimulatedLocation({ lat: latitude, lng: longitude });
  }

  function handleStartChatPress() {
    const center = location ?? { lat: region.latitude, lng: region.longitude };
    preOpenRegionRef.current = region;
    setCreateLocation(center);
    setCreateVisible(true);
  }

  // The user is always the center of their own map - there's no reason to
  // ever show them somewhere off to the side of it. scrollEnabled=false
  // would be the obvious way to enforce that, but on-device that also
  // disables pinch-zoom (iOS MapKit couples them more tightly than the
  // simulator's synthetic gestures let on), so panning and zooming are
  // both left enabled and instead corrected after the fact: any gesture -
  // a drag, or a pinch pivoting around the touch midpoint rather than the
  // current center - snaps back to the user's location once it completes,
  // keeping only the zoom level it produced. Suspended while the create-chat
  // sheet is open, since that flow deliberately drives the camera itself
  // (see the radius-fit effect below) and may be framing a long-pressed
  // spot that isn't the user's own location.
  // Guards against a real, confirmed-live bug: animateToRegion below
  // changes the region, which itself fires another onRegionChangeComplete -
  // and with the ~11cm epsilon below, virtually any zoom gesture's natural
  // imprecision re-triggers it. Routed through the shared animateRegion
  // above (not a local guard) so this also can't collide with the
  // GPS-follow effect's own animateToRegion call - a fast zoom gesture
  // landing while a location update is still mid-animation was exactly
  // the confirmed-live failure mode: the JS-side `region` state could end
  // up permanently describing something other than what's actually
  // rendered natively, which then feeds isVisibleAtZoom/getClusters the
  // wrong viewport - a conversation's marker disappearing at some zoom
  // levels and not reappearing until further gestures happened to
  // accidentally resync it.
  function handleRegionChangeComplete(r: Region) {
    if (createVisible || !location) {
      setRegion(r);
      return;
    }
    const next = { ...r, latitude: location.lat, longitude: location.lng };
    setRegion(next);
    if (Math.abs(r.latitude - location.lat) > 1e-6 || Math.abs(r.longitude - location.lng) > 1e-6) {
      animateRegion(next, 200);
    }
  }

  // While the create-chat sheet is open, keep the whole radius preview
  // circle framed as the slider moves - zoomed way in for a "specific spot"
  // pick, zoomed out for a "wide area" one - rather than leaving the map
  // wherever it happened to be and letting a big circle run off-screen.
  useEffect(() => {
    if (!createVisible || !createLocation) return;
    const spanMeters = createRadius * 2 * 3; // circle diameter, with padding around it
    const span = spanMeters / 111320; // meters -> degrees (good enough at map scale)
    const next = {
      latitude: createLocation.lat,
      longitude: createLocation.lng,
      latitudeDelta: span,
      longitudeDelta: span,
    };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 0);
  }, [createVisible, createLocation, createRadius]);

  // Once the sheet closes, hand the camera back to the always-centered-on-
  // me behavior above instead of leaving it at whatever zoom the radius
  // slider last framed - restore the zoom from just before the sheet
  // opened. Deliberately only reacts to createVisible itself, not the
  // region it reads - otherwise this would re-fire on every subsequent pan/
  // zoom.
  useEffect(() => {
    if (createVisible || !location) return;
    const base = preOpenRegionRef.current ?? region;
    const next = { ...base, latitude: location.lat, longitude: location.lng };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 300);
  }, [createVisible]);

  async function handleJoin(conversation: ConversationSummary) {
    if (!currentUser || !location) return;
    setSelected(undefined);
    setPreviewNearby([]);
    // Already a participant (conversation.isParticipant, computed
    // server-side) - go straight in. ConversationScreen's own refresh()
    // calls checkEligibility on mount regardless, so re-calling it here
    // first would just be a redundant round-trip before the same work
    // happens again.
    if (!conversation.isParticipant) {
      const t0 = Date.now();
      await backend.joinConversation(currentUser.id, conversation.id, location);
      console.log(`[timing] joinConversation: ${Date.now() - t0}ms`);
    }
    navigation.navigate("Conversation", { conversationId: conversation.id });
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChangeComplete}
        onLongPress={handleLongPress}
        onPress={handleMapPress}
        showsUserLocation={!devModeEnabled}
      >
        {devModeEnabled && devSimulatedLocation && (
          <Marker
            coordinate={{ latitude: devSimulatedLocation.lat, longitude: devSimulatedLocation.lng }}
            pinColor="dodgerblue"
            title="Simulated location"
            description="Tap anywhere on the map to move this"
          />
        )}

        {createVisible && createLocation && (
          <Circle
            center={{ latitude: createLocation.lat, longitude: createLocation.lng }}
            radius={createRadius}
            strokeColor="rgba(44,44,42,0.5)"
            fillColor="rgba(44,44,42,0.08)"
          />
        )}

        {clusterItems.map((item) => {
          const props = item.properties as any;
          if (props.cluster) return null;
          const conversation: ConversationSummary = props.conversation;
          const colors = HEAT_COLORS[heatLevel(conversation.activityScore)];
          return (
            <Circle
              key={`radius-${conversation.id}`}
              center={{ latitude: conversation.location.lat, longitude: conversation.location.lng }}
              radius={conversation.participationRadiusM}
              strokeColor={`${colors.border}B3`}
              fillColor={`${colors.border}26`}
              strokeWidth={1.5}
            />
          );
        })}

        {clusterItems.map((item) => {
          const [lng, lat] = item.geometry.coordinates;
          const props = item.properties as any;
          if (props.cluster) {
            // Everything here survived supersedeBroaderConversations, but
            // that only removes a wider chat when 2+ narrower ones are
            // nested inside it - a wide chat with a single nested narrower
            // one both survive, and can still end up clustered together
            // here if they're close enough on screen. Either way, tapping
            // zooms in rather than opening one directly, since it isn't
            // unambiguously any single one of them.
            const leaves = (clusterIndex?.getLeaves(props.cluster_id, Infinity) ?? []).map(
              (leaf) => (leaf.properties as any).conversation as ConversationSummary
            );
            const aggregateScore = leaves.reduce((sum, c) => sum + c.activityScore, 0);
            return (
              <ClusterMarker
                key={`cluster-${props.cluster_id}`}
                coordinate={{ latitude: lat, longitude: lng }}
                count={props.point_count}
                label={dominantVenueLabel(leaves)}
                activityScore={aggregateScore}
                renderSize={computeRenderSize(aggregateScore)}
                onPress={() =>
                  setRegion((r) => ({
                    ...r,
                    latitude: lat,
                    longitude: lng,
                    latitudeDelta: r.latitudeDelta / 3,
                    longitudeDelta: r.longitudeDelta / 3,
                  }))
                }
              />
            );
          }
          const conversation: ConversationSummary = props.conversation;
          return <BubbleMarker key={conversation.id} conversation={conversation} onPress={(c) => selectConversation(c)} />;
        })}
      </MapView>

      {conversations.length === 0 && (
        <View style={styles.emptyState} pointerEvents="none">
          <Text style={styles.emptyStateText}>
            It's quiet here right now. Be the first to start a chat, or open dev mode to load a demo scenario.
          </Text>
        </View>
      )}

      {conversations.length > 0 && visibleConversations.length === 0 && (
        <View style={styles.emptyState} pointerEvents="none">
          <Text style={styles.emptyStateText}>Zoom in to see more specific chats nearby.</Text>
        </View>
      )}

      {/* __DEV__ is false in any release/TestFlight build - dev mode fakes
          GPS location and seeds synthetic data against the mock backend
          only, neither of which should be reachable by a real tester on a
          real shared database. */}
      {__DEV__ && (
        <View style={styles.topBar}>
          <Pressable style={styles.devButton} onPress={() => navigation.navigate("DevPanel")}>
            <Text style={styles.devButtonText}>{devModeEnabled ? "Dev mode: ON" : "Dev mode"}</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={styles.startChatButton} onPress={handleStartChatPress}>
        <Text style={styles.startChatButtonText}>Start chat</Text>
      </Pressable>

      <ConversationPreviewSheet
        conversation={selected}
        hiddenNearby={previewNearby}
        onClose={() => {
          setSelected(undefined);
          setPreviewNearby([]);
        }}
        onJoin={handleJoin}
      />

      <CreateConversationSheet
        visible={createVisible}
        location={createLocation}
        userId={currentUser?.id}
        defaultRadius={defaultRadiusForZoom(zoom)}
        onRadiusChange={setCreateRadius}
        onClose={() => setCreateVisible(false)}
        onCreated={(conv) => {
          setCreateVisible(false);
          handleJoin(conv);
        }}
        onJoinExisting={(conv) => {
          setCreateVisible(false);
          handleJoin(conv);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { position: "absolute", top: 56, right: 16 },
  devButton: { backgroundColor: "white", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: "#D3D1C7" },
  devButtonText: { fontSize: 12, fontWeight: "500", color: "#444441" },
  startChatButton: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
    backgroundColor: "#2C2C2A",
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  startChatButtonText: { color: "white", fontSize: 15, fontWeight: "500" },
  emptyState: { position: "absolute", top: 100, left: 24, right: 24, alignItems: "center" },
  emptyStateText: { fontSize: 13, color: "#5F5E5A", textAlign: "center", backgroundColor: "rgba(255,255,255,0.9)", padding: 12, borderRadius: 10 },
});
