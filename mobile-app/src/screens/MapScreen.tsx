import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/RootNavigator";
import { useAppStore, effectiveLocation } from "../state/useAppStore";
import * as backend from "../services/mockBackend";
import { ConversationSummary, GeoPoint } from "../services/types";
import { BubbleMarker } from "../components/BubbleMarker";
import { ClusterMarker } from "../components/ClusterMarker";
import { ConversationPreviewSheet } from "../components/ConversationPreviewSheet";
import { CreateConversationSheet } from "../components/CreateConversationSheet";
import { bboxFromRegion, buildClusterIndex, dominantVenueLabel, isVisibleAtZoom, zoomFromRegion } from "../services/clustering";
import { computeRenderSize } from "../services/activityScore";

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
  const [createVisible, setCreateVisible] = useState(false);
  const [createLocation, setCreateLocation] = useState<GeoPoint>();

  const refresh = useCallback(async () => {
    const center: GeoPoint = location ?? { lat: region.latitude, lng: region.longitude };
    const results = await backend.getVisibleConversations(center, { radiusM: 4000 });
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

  useEffect(() => {
    if (!location) return;
    setRegion((r) => {
      const next = { ...r, latitude: location.lat, longitude: location.lng };
      mapRef.current?.animateToRegion(next, 500);
      return next;
    });
  }, [location?.lat, location?.lng]);

  const zoom = zoomFromRegion(region.longitudeDelta);

  const visibleConversations = useMemo(
    () => conversations.filter((c) => isVisibleAtZoom(c.category, zoom)),
    [conversations, zoom]
  );

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

  async function handleJoin(conversation: ConversationSummary) {
    if (!currentUser || !location) return;
    setSelected(undefined);
    await backend.joinConversation(currentUser.id, conversation.id, location);
    navigation.navigate("Conversation", { conversationId: conversation.id });
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={setRegion}
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

        {clusterItems.map((item) => {
          const [lng, lat] = item.geometry.coordinates;
          const props = item.properties as any;
          if (props.cluster) {
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
          return <BubbleMarker key={conversation.id} conversation={conversation} onPress={setSelected} />;
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

      <Pressable style={styles.startChatButton} onPress={handleStartChatPress}>
        <Text style={styles.startChatButtonText}>Start chat</Text>
      </Pressable>

      <ConversationPreviewSheet conversation={selected} onClose={() => setSelected(undefined)} onJoin={handleJoin} />

      <CreateConversationSheet
        visible={createVisible}
        location={createLocation}
        userId={currentUser?.id}
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
