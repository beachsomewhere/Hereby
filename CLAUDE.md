# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`nearby-mobile`: an Expo/React Native/TypeScript prototype of "Nearby," a temporary, location-based
group-chat app (the map *is* the app — you see and join conversations happening around you, not people).
The product/technical design doc is `phase1-strategy.md` at the repo root; the app itself lives in
`mobile-app/`.

## Commands

All commands run from `mobile-app/`:

```
npm install
npm run start      # then press i (iOS simulator) or a (Android emulator), or scan the QR with Expo Go
npm run typecheck  # tsc --noEmit — no separate lint/test scripts exist yet
```

No API keys or `.env` are required — `react-native-maps` uses its platform default provider, and the
backend is fully in-memory (see below). The web target (`npm run web` / pressing `w`) does **not** render
the map screen; `react-native-maps` is a native module with no web shim wired up here. Use a simulator,
emulator, or Expo Go on a device.

There's no automated test suite currently — verification is `npm run typecheck` plus manually exercising
the app (dev mode, described below, is the primary way to do this without waiting on real time/location).

## Architecture

### The mock-backend swap is the central design constraint

Every screen and component talks to the backend only through named function imports from
`src/services/mockBackend.ts` (`getVisibleConversations`, `createConversation`, `joinConversation`,
`sendMessage`, `getThreads`, ...) — never to storage directly. The intent is that a future
`src/services/supabaseBackend.ts` implementing the same function signatures is a drop-in replacement.
`supabase/schema.sql` and `supabase/edge-functions/*.ts` are reference implementations of what that real
backend would look like, meant to mirror the mock's data shapes and logic 1:1 — `src/services/types.ts`
says so explicitly in its header comment. `supabase/edge-functions/` is Deno code (URL imports, the `Deno`
global) and is excluded from `tsc` via `tsconfig.json`'s `exclude` — don't try to typecheck it with the
Node toolchain.

**Known gap:** the edge-function stubs were not updated when threads were added to the mock backend (see
below) — they still model one flat conversation → messages, not conversation → threads → messages. If you're
touching the Supabase side, check `mockBackend.ts` first for current behavior.

### Domain model: Conversation → Thread → Message

A `Conversation` is a location-scoped chat container (`src/services/types.ts`). It always has exactly one
`Thread` with `isGeneral: true`, created automatically alongside it (`mockBackend.createConversation` →
`createThreadRecord`); participants can create additional threads scoped to the same conversation
(`createThread`). Eligibility/participation (`ParticipantState`: `inside` / `grace` / `read_only` / `left`)
is computed and stored at the **conversation** level, not per-thread — being "inside" a location grants
access to every thread in it. Messages belong to a thread (`Message.threadId`) but also carry
`conversationId` for cheap rollups (e.g. computing a conversation's `lastMessagePreview` across all its
threads).

### Location privacy: generalize, never store raw coordinates

`checkEligibility` is the only place a raw GPS coordinate is ever seen; it's used for one distance
computation and discarded. `createConversation` snaps the input location to a grid
(`geo.ts#snapToGrid`) before storing it. The grid cell size is **per-category**
(`mockBackend.ts#SNAP_CELL_M`) and must stay small enough that the worst-case snap offset can't exceed
that category's own `participationRadiusM` (`RADII` in the same file) — otherwise a chat's own creator can
end up just outside their own new chat's eligibility radius. If you add a category or change a radius,
check this invariant.

### Activity scoring and lifecycle

`src/services/activityScore.ts` implements the scoring/lifecycle formulas from
`phase1-strategy.md` §6/§10 (`computeActivityScore`, `computeRenderSize`, `heatLevel`, `nextStatus`) as
pure functions. In production these run server-side on a schedule (`recomputeActivity` edge function);
here they're called synchronously by the mock backend and by map components, so the whole app agrees on
one implementation. `nextStatus` drives the `new → active → cooling_down → archived` lifecycle plus a hard
TTL cut.

### Map zoom, clustering, and category visibility

`src/services/clustering.ts` wraps `supercluster` and adds a display-only concern on top of it:
`ZOOM_VISIBILITY` maps each `ConversationCategory` to a minimum zoom level, so broader categories
(`area`, `corridor`) stay visible when zoomed way out while narrower ones (`micro_location`) only appear
once you've zoomed in — `MapScreen` filters conversations through `isVisibleAtZoom` before feeding them to
supercluster. When several conversations cluster into one marker, `findWiderConversation` checks whether a
genuinely broader conversation already covers that spot (lower zoom threshold than every clustered item,
cluster centroid within its discovery radius); if so, tapping the cluster opens *that* conversation
directly (with the clustered ones surfaced as "more specific chats nearby") instead of just zooming in —
that fallback (`onPress` in `MapScreen`) only fires when no covering conversation exists yet.

### State and navigation

`src/state/useAppStore.ts` is a single Zustand store. Location has two sources — real `userLocation` and a
dev-mode `devSimulatedLocation` override — reconciled by the `effectiveLocation` selector (dev override
wins whenever `devModeEnabled` is on). Almost everything in the app should read location through this
selector, not the raw store fields, so dev mode transparently substitutes for real GPS everywhere.
`RootNavigator` is a single stack that renders only `Onboarding` until `currentUser` is set, then swaps to
`Map` / `Conversation` / `DevPanel` — there's no auth-gate middleware, just that one conditional.

### Developer/simulator mode

`DevPanelScreen` + `src/dev/scenarios.ts` (airport/concert/traffic/stadium/conference presets) exist so
the interaction model — bubble growth/decay, clustering, geofence grace periods, conversation expiry — can
be exercised without waiting on real time or moving around physically. It calls the exact same
`mockBackend` functions the rest of the app uses (`devAddSyntheticParticipant`,
`devAddSyntheticMessage`, `advanceClockMinutes`, `devLoadScenario`, `devResetAll`) — there is no separate
fake code path, so what dev mode shows is what production interaction would look like under load.
