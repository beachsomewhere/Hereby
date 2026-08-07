import { create } from "zustand";
import { GeoPoint, ParticipantState, User } from "../services/types";

interface AppState {
  currentUser?: User;
  setCurrentUser: (u: User) => void;

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

  blockedUserIds: Set<string>;
  blockUser: (userId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: undefined,
  setCurrentUser: (u) => set({ currentUser: u }),

  userLocation: undefined,
  setUserLocation: (p) => set({ userLocation: p }),

  devModeEnabled: false,
  toggleDevMode: () => set((s) => ({ devModeEnabled: !s.devModeEnabled })),
  devSimulatedLocation: undefined,
  setDevSimulatedLocation: (p) => set({ devSimulatedLocation: p }),

  participantStates: {},
  setParticipantState: (conversationId, state) =>
    set((s) => ({ participantStates: { ...s.participantStates, [conversationId]: state } })),

  blockedUserIds: new Set(),
  blockUser: (userId) =>
    set((s) => {
      const next = new Set(s.blockedUserIds);
      next.add(userId);
      return { blockedUserIds: next };
    }),
}));

/** Effective location: dev override wins when dev mode is on, otherwise real GPS. */
export function effectiveLocation(state: AppState): GeoPoint | undefined {
  if (state.devModeEnabled && state.devSimulatedLocation) return state.devSimulatedLocation;
  return state.userLocation;
}
