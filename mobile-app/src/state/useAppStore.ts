import { create } from "zustand";
import { GeoPoint, ParticipantState, User } from "../services/types";

interface AppState {
  currentUser?: User;
  setCurrentUser: (u: User | undefined) => void;
  // Clears currentUser plus every other piece of session-scoped state below
  // (blocks, reports, location) - logging out and back in as a different
  // account on the same device must not carry over the previous account's
  // blocked/reported lists onto the new one.
  logOut: () => void;

  userLocation?: GeoPoint;
  setUserLocation: (p: GeoPoint) => void;

  // Real GPS location vs. the dev-mode simulated override. When devOverride
  // is set, screens should use it instead of live GPS - this is what lets
  // the dev panel "teleport" the app without touching a real device's
  // location services.
  devModeEnabled: boolean;
  toggleDevMode: () => void;
  devSimulatedLocation?: GeoPoint;
  setDevSimulatedLocation: (p?: GeoPoint) => void;

  // conversationId -> last known participant state, used to render banners
  // like "You've left this area - read-only" without re-fetching.
  participantStates: Record<string, ParticipantState>;
  setParticipantState: (conversationId: string, state: ParticipantState) => void;

  // Whether the calling user currently has an active (non-'left') row in
  // any conversation - drives RootNavigator's background location watcher
  // (allowsBackgroundLocationUpdates only turns on while this is true, see
  // its own comment) and the periodic background re-check timer. Always
  // re-derived from backend.getMyActiveConversationIds(), never assumed.
  hasActiveMembership: boolean;
  setHasActiveMembership: (v: boolean) => void;

  blockedUserIds: Set<string>;
  blockUser: (userId: string) => void;

  // Messages the current user has reported - hidden from their own feed
  // immediately, same in-memory-only treatment as blockedUserIds above.
  reportedMessageIds: Set<string>;
  reportMessage: (messageId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: undefined,
  setCurrentUser: (u) => set({ currentUser: u }),
  logOut: () =>
    set({
      currentUser: undefined,
      userLocation: undefined,
      devSimulatedLocation: undefined,
      participantStates: {},
      hasActiveMembership: false,
      blockedUserIds: new Set(),
      reportedMessageIds: new Set(),
    }),

  userLocation: undefined,
  setUserLocation: (p) => set({ userLocation: p }),

  devModeEnabled: false,
  toggleDevMode: () => set((s) => ({ devModeEnabled: !s.devModeEnabled })),
  devSimulatedLocation: undefined,
  setDevSimulatedLocation: (p) => set({ devSimulatedLocation: p }),

  participantStates: {},
  setParticipantState: (conversationId, state) =>
    set((s) => ({ participantStates: { ...s.participantStates, [conversationId]: state } })),

  hasActiveMembership: false,
  setHasActiveMembership: (v) => set({ hasActiveMembership: v }),

  blockedUserIds: new Set(),
  blockUser: (userId) =>
    set((s) => {
      const next = new Set(s.blockedUserIds);
      next.add(userId);
      return { blockedUserIds: next };
    }),

  reportedMessageIds: new Set(),
  reportMessage: (messageId) =>
    set((s) => {
      const next = new Set(s.reportedMessageIds);
      next.add(messageId);
      return { reportedMessageIds: next };
    }),
}));

/** Effective location: dev override wins when dev mode is on, otherwise real GPS. */
export function effectiveLocation(state: AppState): GeoPoint | undefined {
  if (state.devModeEnabled && state.devSimulatedLocation) return state.devSimulatedLocation;
  return state.userLocation;
}
