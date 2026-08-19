import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Region } from "react-native-maps";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/mockBackend";
import { ConversationCategory, ConversationSummary, GeoPoint } from "../services/types";
import { BubbleMarker, HEAT_COLORS } from "../components/BubbleMarker";
import { ClusterMarker } from "../components/ClusterMarker";
import { ConversationPreviewSheet } from "../components/ConversationPreviewSheet";
import { CreateConversationSheet } from "../components/CreateConversationSheet";
import {
  bboxFromRegion,
  buildClusterIndex,
  categoryForZoom,
  deltaForZoom,
  dominantVenueLabel,
  isVisibleAtZoom,
  supersedeBroaderConversations,
  ZOOM_VISIBILITY,
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

  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(
    location ? { ...DEFAULT_REGION, latitude: location.lat, longitude: location.lng } : DEFAULT_REGION
  );
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary>();
  const [previewNearby, setPreviewNearby] = useState<ConversationSummary[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [createLocation, setCreateLocation] = useState<GeoPoint>();
  const [createCategory, setCreateCategory] = useState<ConversationCategory>("micro_location");

  const refresh = useCallback(async () => {
    const center: GeoPoint = location ?? { lat: region.latitude, lng: region.longitude };
    const results = await backend.getVisibleConversations(center);
    setConversations(results);
  }, [location, region.latitude, region.longitude]);

  useEffect(() => {
    refresh();
    const unsubscribe = backend.subscribeToMap(refresh);
    const interval = setInterval(refresh, 5000); // mirrors the periodic activity-score broadcast
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  // Recenter whenever location changes (app load, dev-mode teleport, real
  // movement). If nothing would be visible at the zoom we're already at -
  // e.g. the only conversation here is a specific gate chat with no
  // broader venue/area one covering it - zoom in enough to reveal the
  // nearest available one instead of landing on an apparently-empty map.
  // Only kicks in when the current zoom shows nothing, so it never fights
  // deliberate manual zooming once something's already in view.
  useEffect(() => {
    if (!location) return;
    (async () => {
      const results = await backend.getVisibleConversations(location);
      const currentZoom = zoomFromRegion(region.longitudeDelta);
      const alreadyVisible = results.some((c) => ZOOM_VISIBILITY[c.category] <= currentZoom);
      const nearestThreshold =
        results.length > 0 && !alreadyVisible ? Math.min(...results.map((c) => ZOOM_VISIBILITY[c.category])) : undefined;
      setRegion((r) => {
        const next = {
          ...r,
          latitude: location.lat,
          longitude: location.lng,
          ...(nearestThreshold !== undefined
            ? { latitudeDelta: deltaForZoom(nearestThreshold), longitudeDelta: deltaForZoom(nearestThreshold) }
            : {}),
        };
        mapRef.current?.animateToRegion(next, 500);
        return next;
      });
    })();
  }, [location?.lat, location?.lng]);

  const zoom = zoomFromRegion(region.longitudeDelta);

  // Zoom-visible, then superseded: a broader conversation (e.g. "airport
  // wide") only shows up until something more specific covering the same
  // spot is also zoom-visible, at which point it transforms into that one
  // instead of showing alongside it. Zooming back out drops the more
  // specific one out of the zoom-visible set again, so the broader one
  // naturally reappears.
  const visibleConversations = useMemo(() => {
    const zoomVisible = conversations.filter((c) => isVisibleAtZoom(c.category, zoom));
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
    const zoomHidden = conversations.filter((c) => c.id !== conversation.id && !isVisibleAtZoom(c.category, zoom));
    setPreviewNearby(zoomHidden);
  }

  const clusterIndex = useMemo(() => {
    if (visibleConversations.length === 0) return undefined;
    return buildClusterIndex(visibleConversations);
  }, [visibleConversations]);

  const clusterItems = useMemo(() => {
    if (!clusterIndex) return [];
    const bbox = bboxFromRegion(region);
    return clusterIndex.getClusters(bbox, zoom);
  }, [clusterIndex, region, zoom]);

  function handleLongPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setCreateLocation({ lat: latitude, lng: longitude });
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
    setCreateLocation(center);
    setCreateVisible(true);
  }

  function handleRecenter() {
    if (!location) return;
    const next = { ...region, latitude: location.lat, longitude: location.lng };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 400);
  }

  // The user is always the center of their own map - there's no reason to
  // ever show them somewhere off to the side of it. scrollEnabled=false
  // would be the obvious way to enforce that, but on-device that also
  // disables pinch-zoom (iOS MapKit couples them more tightly than the
  // simulator's synthetic gestures let on), so panning and zooming are
  // both left enabled and instead corrected after the fact: any gesture -
  // a drag, or a pinch pivoting around the touch midpoint rather than the
  // current center - snaps back to the user's location once it completes,
  // keeping only the zoom level it produced.
  function handleRegionChangeComplete(r: Region) {
    if (!location) {
      setRegion(r);
      return;
    }
    const next = { ...r, latitude: location.lat, longitude: location.lng };
    setRegion(next);
    if (Math.abs(r.latitude - location.lat) > 1e-6 || Math.abs(r.longitude - location.lng) > 1e-6) {
      mapRef.current?.animateToRegion(next, 200);
    }
  }

  async function handleJoin(conversation: ConversationSummary) {
    if (!currentUser || !location) return;
    setSelected(undefined);
    setPreviewNearby([]);
    await backend.joinConversation(currentUser.id, conversation.id, location);
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
            radius={backend.RADII[createCategory].participation}
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
            // Every conversation here has already survived
            // supersedeBroaderConversations, so a cluster is always genuine
            // siblings (no member covers the others) - just several
            // same-ish-tier chats rendering close together. Tapping zooms
            // in rather than opening one, since it isn't any single one of
            // them.
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

      <View style={styles.topBar}>
        <Pressable style={styles.devButton} onPress={() => navigation.navigate("DevPanel")}>
          <Text style={styles.devButtonText}>{devModeEnabled ? "Dev mode: ON" : "Dev mode"}</Text>
        </Pressable>
      </View>

      {location && (
        <Pressable style={styles.recenterButton} onPress={handleRecenter}>
          <Text style={styles.recenterButtonText}>⌖</Text>
        </Pressable>
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
        defaultCategory={categoryForZoom(zoom)}
        onCategoryChange={setCreateCategory}
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
  recenterButton: {
    position: "absolute",
    bottom: 36,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#D3D1C7",
    alignItems: "center",
    justifyContent: "center",
  },
  recenterButtonText: { fontSize: 22, color: "#2C2C2A" },
  emptyState: { position: "absolute", top: 100, left: 24, right: 24, alignItems: "center" },
  emptyStateText: { fontSize: 13, color: "#5F5E5A", textAlign: "center", backgroundColor: "rgba(255,255,255,0.9)", padding: 12, borderRadius: 10 },
});
