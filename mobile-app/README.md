# Hereby - mobile prototype

Temporary, location-based group conversations. The map is the social network: users see and join conversations happening around them, not other people.

This is the Phase 2 build against the strategy in `../phase1-strategy.md`. It's a real Expo/React Native/TypeScript app, structured so the mock in-memory backend can be swapped for the real Supabase + PostGIS + Edge Functions backend (see `supabase/`) without touching any screen or component.

## Running it

```
npm install
npm run start      # then press i (iOS simulator) or a (Android emulator), or scan the QR code with Expo Go on a device
npm run typecheck  # tsc --noEmit
```

No API keys are required to run the prototype - it uses `react-native-maps`'s default provider (Apple Maps on iOS, Google's default map on Android/Expo Go) and the in-memory mock backend described below, so there's nothing to configure before you can see it working.

Note: the web target (`npm run web` / pressing `w`) will NOT render the map screen - `react-native-maps` is a native module and doesn't work on Expo web without additional shimming (e.g. `react-native-web-maps`) that isn't wired up in this prototype. Use an iOS simulator, Android emulator, or a physical device with Expo Go.

## What's real vs. mocked

| Layer | This prototype | Production (per Phase 1 architecture) |
|---|---|---|
| Map rendering, bubbles, clustering, chat UI, dev panel | Real, fully implemented | Same |
| Activity scoring, lifecycle transitions, grace periods, duplicate suggestion | Real logic (`src/services/activityScore.ts`, `src/services/geo.ts`) | Same logic, ported to `supabase/edge-functions/*.ts` (already stubbed 1:1) |
| Data storage | In-memory (`src/services/mockBackend.ts`) | Postgres + PostGIS (`supabase/schema.sql`) |
| Realtime updates | `setInterval` polling + a simple pub/sub | Supabase Realtime channels |
| Auth | A `createUser()` call that fabricates a pseudonym | Supabase Auth (anonymous, upgradeable to Apple/Google/email/phone) |
| Location eligibility | `mockBackend.checkEligibility` - same algorithm as `supabase/edge-functions/checkEligibility.ts` | Real Edge Function + PostGIS `ST_DWithin` |

Swapping the mock for the real backend is meant to be mechanical: every screen imports from `src/services/mockBackend.ts` by function name (`getVisibleConversations`, `joinConversation`, `sendMessage`, ...). A future `src/services/supabaseBackend.ts` implementing the same function signatures, wired up in place of the mock import, is the whole migration.

## Folder guide

```
App.tsx                          Entry point, navigation container
src/
  navigation/RootNavigator.tsx   Onboarding -> Map -> Conversation / DevPanel
  screens/
    OnboardingScreen.tsx         Pseudonymous account + location permission
    MapScreen.tsx                Live map, bubbles, clustering, create flow
    ConversationScreen.tsx       Chat: messages, replies, reactions, confirmations
    DevPanelScreen.tsx           Developer/simulator mode (see below)
  components/
    BubbleMarker.tsx             Sized/colored chat-bubble map marker
    ClusterMarker.tsx            "Terminal B - 5 conversations" badge
    ConversationPreviewSheet.tsx Tap-to-preview bottom sheet
    CreateConversationSheet.tsx  Start-chat flow with duplicate suggestions
    MessageBubble.tsx            Chat row: reactions, confirm, reply, report
    ProfileCard.tsx               Compact pseudonymous profile card
  services/
    types.ts                     Domain types, mirror schema.sql 1:1
    mockBackend.ts                In-memory backend (the whole "server" for this prototype)
    activityScore.ts              Bubble scoring + lifecycle formulas
    clustering.ts                  supercluster wrapper
    geo.ts                         Distance + location-generalization helpers
  state/useAppStore.ts             Zustand store (current user, location, dev overrides)
  dev/scenarios.ts                 Airport / concert / traffic / stadium / conference presets
supabase/
  schema.sql                      Full Postgres + PostGIS DDL, RLS sketch, eligibility RPC
  edge-functions/                  1:1 reference implementations of the trust-sensitive logic
```

## Developer / simulator mode

Tap "Dev mode" on the map to open the panel. It can:

- Set an arbitrary simulated GPS coordinate (overrides real location app-wide while dev mode is on).
- Simulate GPS drift (small random jitter) and "walk outside the geofence" (jump ~600m away, enough to trigger the grace-period/read-only flow).
- Load a scenario preset (airport, concert, traffic, stadium, conference) - seeds several conversations with synthetic participants and messages around the current simulated location.
- Add a synthetic participant or message to any active conversation, to watch its bubble grow on the map in real time.
- Advance the mock clock by 15 minutes or 1 hour, to watch bubbles decay/cool down and conversations expire without waiting in real time.
- Reset all mock data.

Everything the dev panel does goes through the same `mockBackend` functions the rest of the app uses - there's no separate "fake" code path, so what you see in dev mode is exactly what the real interaction model looks like under load.

## What's intentionally not built yet

Per the "defer to post-MVP" list in `../phase1-strategy.md` section 3: verified official accounts, real flight/traffic/event data integrations, semantic (embedding-based) duplicate detection, automatic merge-suggestion for already-created duplicates, and sophisticated ML fraud detection. The schema reserves space for some of these (e.g., a `role` concept can be added to `users` later) without requiring a migration of existing data.
