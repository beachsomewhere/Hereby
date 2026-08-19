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

`.env` (gitignored) needs `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` for a live Supabase
project — auth, conversations, threads, messages, and votes are all real now (see below), not mocked.
`react-native-maps` uses its platform default provider. The web target (`npm run web` / pressing `w`) does
**not** render the map screen; `react-native-maps` is a native module with no web shim wired up here. Use a
simulator, emulator, or Expo Go on a device.

There's no automated test suite currently — verification is `npm run typecheck` plus manually exercising
the app. Dev mode (`DevPanelScreen`, described below) is the primary way to exercise the UI without waiting
on real time/location, but it's gated behind `__DEV__` and talks only to the in-memory mock — it never
touches the real backend or its shared data, by design (see below).

## Architecture

### Two backend implementations behind one function-signature contract

Every screen and component talks to the backend only through named function imports
(`getVisibleConversations`, `createConversation`, `joinConversation`, `sendMessage`, `getThreads`, ...) —
never to storage directly. Two modules implement that exact same function surface:

- `src/services/supabaseBackend.ts` — the real, production backend. All non-dev screens/components import
  from here. Reads/writes real Postgres tables (`supabase/schema.sql`) directly for non-trust-sensitive
  operations, and calls Postgres RPCs or `supabase/functions/*/index.ts` Edge Functions for anything
  trust-sensitive (location eligibility, conversation creation, voting, avatar-icon selection) — RLS blocks
  the client from writing to `conversations`, `conversation_participants`, and `confirmations` directly, so
  those paths are the only way in. Realtime subscriptions (`subscribeToMap`/`subscribeToConversation`/
  `subscribeToThread`) replace the mock's in-memory pub-sub with `supabase.channel(...).on('postgres_changes', ...)`,
  keeping the same `(listener) => unsubscribe` shape so call sites didn't need to change.
- `src/services/mockBackend.ts` — pure in-memory, used **only** by `DevPanelScreen.tsx` now (every
  `dev*`-prefixed export — `devSeedFooFightersDemo`, `devLoadScenario`, `devResetAll`, etc. — plus
  `advanceClockMinutes`). Nothing else imports it. `DevPanelScreen`'s entry point on `MapScreen` is wrapped
  in `{__DEV__ && ...}` so it can't ship to a release/TestFlight build and pollute the real shared database
  with synthetic data.

`supabase/schema.sql` is the real, applied schema (Postgres/PostGIS + RLS + several `SECURITY DEFINER` RPCs:
`vote_message`, `create_conversation_with_general_thread`, `leave_conversation`, `update_avatar_icon`, plus
read-only geo RPCs like `nearby_conversations_by_participation`). It's written idempotently throughout
(`if not exists` / `drop ... if exists` before `create` / `duplicate_object` exception guards) since it gets
re-run against a project that already has some of it applied, rather than tracked via versioned migrations.
`supabase/functions/*/index.ts` are the real, deployed Edge Functions (Supabase CLI's required layout —
`supabase/functions/<name>/index.ts`, one `index.ts` per function directory) and is excluded from `tsc` via
`tsconfig.json`'s `exclude` (Deno code — URL imports, the `Deno` global — don't try to typecheck it with the
Node toolchain). `moderationAction/index.ts` exists but isn't deployed — no moderator role/UI exists
anywhere in the app yet.

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
