# Nearby — Phase 1 Product & Technical Strategy

*Temporary, location-based group conversations. The map is the social network.*

## 1. Product Summary

Nearby is a mobile app where the map, not a feed, is the primary surface. Instead of showing people, it shows **conversations tied to what's happening in a specific place right now** — a delayed flight at a gate, a traffic jam, a concert crowd asking when the headliner starts. Conversations are created by proximity, live as long as the situation is relevant, and expire when it's over. Nobody builds a permanent profile, a friend graph, or a content archive. The product succeeds if a stranger can open the app in an unfamiliar situation and immediately understand what's going on around them and talk to the people going through it with them — then the conversation disappears and nobody thinks about it again.

The closest reference points are Waze (ephemeral, situational, pseudonymous, reputation-for-helpfulness) and group chat (real-time, threaded, reactions) — deliberately *not* Discord/Reddit/Facebook (persistent communities, followers, content permanence).

## 2. Recommended MVP Feature Set

Everything below is scoped to be buildable by a small team and to prove the core loop: **see a conversation near me → join it → it's useful → it goes away.**

- Fast, low-friction onboarding: anonymous/pseudonymous account (device + optional Apple/Google/email upgrade later), auto-generated username + illustrated avatar, single location-permission prompt with clear rationale.
- Live map centered on the user (Mapbox), with conversation bubbles rendered as markers.
- Bubble sizing driven by participants, recent activity, and recency (log-scaled, capped).
- Client-side clustering at low zoom (supercluster), splitting apart on zoom-in.
- Tap-to-preview bottom sheet (title, category, participant count, last message, activity level, Join button).
- Create conversation from map: tap "Start Chat" or long-press → short topic + category → server checks for nearby similar conversations and suggests joining before creating a new one.
- Server-side eligibility checks for join/post, using generalized (snapped) locations, never raw coordinates of other users.
- Two-radius model: discovery radius (visible) vs. participation radius (can post).
- Grace-period lifecycle: inside → recently left (full access) → grace expired (read-only) → archived.
- Real-time group chat: messages, threaded replies, emoji reactions, timestamps.
- "Confirm / Cannot confirm / Incorrect / Helpful" feedback on messages, with a simple "Community confirmed by N nearby participants" label at a threshold.
- Basic points/levels from unique-user-weighted helpfulness signals, with daily diminishing returns.
- Compact profile card only: username, avatar, level, helpfulness points, 2-3 badges, account age. No feed, no history, no followers.
- Report message / report user / block user, basic rate limiting, profanity/spam filtering, moderator lock & delete tools, suspension/ban.
- Conversation lifecycle & expiration (context-dependent durations, see §10).
- Cold start mitigations: seeded venue shells + demo content, expanding discovery radius when the area is quiet, one-tap create.
- Developer/debug mode: simulate GPS position, simulate multiple synthetic users, simulate geofence enter/exit and GPS drift, force bubble growth/decay and expiration, scenario presets (airport, concert, traffic, stadium, conference).

Everything else the brief mentions is real and worth building — it's just sequenced into v2+ below, because building it now would slow down validating the one thing that actually needs proving: *do people want to talk to physically-nearby strangers about a shared temporary situation, on a map.*

## 3. Deferred to Post-MVP

- **Automatic merge-suggestion for duplicate conversations.** MVP already suggests joining an existing conversation *before* creation (cheap, high value). Detecting and prompting a merge of two already-created duplicate conversations after the fact is a harder moderation/UX problem (message history reconciliation) — v2.
- **Verified official accounts** (venue staff, airline, event organizer, transit agency, emergency services). Needs a real verification pipeline and legal review of claims like "official." MVP reserves the schema field (`role`) but ships no verification flow or claim UI.
- **External data integrations** (flight status, live traffic incidents, concert schedules, transit disruptions). High value, but each is its own integration project. MVP substitutes seeded shells + user-created bubbles.
- **Sophisticated fraud/ML-based reputation abuse detection.** MVP ships the *structural* defenses (diminishing returns, unique-user weighting, daily caps, basic device/velocity checks) but not a trained fraud model.
- **Road-segment-accurate snapping for traffic conversations** (matching to actual live road network segments/incident feeds). MVP snaps to a coarse geographic grid cell + reverse-geocoded road name label, which is enough to group "the backup on I-90 eastbound" without needing a routing-engine integration.
- **Direct messages** — explicitly excluded per the brief, and it should stay excluded past MVP too unless the product goal changes, since it cuts against the "not a social network" premise.
- **Public activity histories, member directories, follower graphs, profile feeds** — not just deferred, likely never, per the core thesis.
- **Semantic/NLP duplicate detection.** MVP uses keyword overlap + category + proximity, not embeddings — much cheaper, and duplicate topics near each other in category/location are usually lexically similar anyway ("flight delay," "UA663 delay").
- **Advanced push notification targeting / digesting.** MVP sends a small, capped set of notifications (joined-conversation activity while backgrounded); smarter batching/relevance ranking is v2.

## 4. Primary User Journey

1. User opens the app for the first time. One screen explains the concept in a sentence, asks for location permission with a concrete reason ("see what's happening around you right now"), and auto-creates a pseudonymous profile (username + avatar), editable in ~10 seconds.
2. The map opens centered on the user's current location. Nearby bubbles are already visible (real ones, or seeded shells if the area is quiet) — the map is never empty.
3. User taps a bubble → preview sheet slides up (title, category, N participants, last message, activity level, Join).
4. User taps Join → drops into a familiar chat thread, can read immediately; posting is enabled if inside the participation radius.
5. User sends a message, reacts to others, marks a message "Confirmed." Their helpfulness points tick up (weighted, capped).
6. User walks away from the gate/venue. They stay in a grace period with full access for a while, then drop to read-only, then eventually the conversation scrolls out of their joined list as it expires.
7. Later, at a different location, the user sees a new set of bubbles. Nothing from the previous conversation persists on their profile or is browsable — it's gone, by design.
8. Optionally, at any point, the user long-presses an empty spot on the map or taps "Start Chat," types a short topic, and either joins a suggested existing conversation or creates a new bubble.

## 5. Map & Bubble Interaction Model

The map is always the home screen — there is no separate "list" home. Bubbles are semi-transparent, rounded chat-bubble-shaped markers (not pins), each showing a short title/emoji and a subtle size/glow tied to activity. Tapping opens a bottom sheet preview (not a full-screen navigation) so the map stays present underneath — reinforces "you're looking at the world," not "you're browsing a database." Dragging the map re-queries bubbles for the visible viewport + a margin; a "Search this area" affordance appears if the user pans far from their real location (support browsing elsewhere without implying the user *is* there — participation radius still gates posting).

Visual states:

- **New** (< 5 participants, just created): small, single soft pulse, muted color.
- **Active**: normal bubble, size reflects the scoring function below, gentle idle animation (slow scale breathing, capped amplitude) only for bubbles above an activity threshold, so the map doesn't feel jittery.
- **Hot** (top percentile of nearby activity): brighter accent color/border, a small flame or spark glyph — capped so it never dominates the screen.
- **Cooling/expiring soon**: reduced opacity, no animation.
- **Expired**: removed from the map (with a brief fade-out, not an abrupt pop).

Animations run on a shared, throttled tick (e.g., recompute every 5-10s from the realtime feed, not per-message) so the map doesn't thrash.

## 6. Bubble Sizing & Activity Logic

Bubble visual size and "heat" are driven by a single **activity score**, recomputed periodically (every ~15-30s server-side via a scheduled job, pushed to clients over a lightweight realtime channel), not per keystroke.

```
score = w1 * log(1 + unique_active_participants)
      + w2 * log(1 + messages_last_15min)
      - w3 * minutes_since_last_message
      + w4 * recency_boost(created_at)
      - w5 * distance_from_user_km      (map render only, not stored)
```

- Logarithms cap runaway growth from any one factor — a bubble with 500 participants shouldn't be visually 50x a bubble with 10.
- `distance_from_user_km` only affects the *client-side rendered radius/prominence* (closer things can render a touch bigger/brighter even at equal score) — it is not part of the canonical stored score, since that's shared across all viewers.
- Final size maps through a **clamped scale**: `render_size = min(MAX_SIZE, MIN_SIZE + k * log(1 + score))`. Hard min/max prevents both invisible bubbles and screen-dominating ones.
- Decay is explicit and monotonic: if no new messages/joins arrive, `messages_last_15min` and the recency term decay the score every tick, so bubbles visibly shrink and fade over minutes, not jump-cut.
- Server owns the canonical score (used for expiration/cooldown decisions); the client only owns the cosmetic render curve.

## 7. Clustering Behavior

Clustering is a **client-side, display-only** concern — it never touches the underlying conversation or message data.

- Use `supercluster` (the same library Mapbox's own clustering examples use) fed by the currently-visible bubble set. It buckets by zoom level and pixel radius, standard and battle-tested for this exact "many map markers, cluster at low zoom" problem.
- A cluster renders as a distinct shape (rounded rectangle badge, not a chat bubble) with a count and best-guess label, e.g., "Terminal B — 5 conversations," derived from the most common venue/POI reference among the clustered bubbles (falls back to "5 conversations nearby" if mixed).
- Tapping a cluster zooms/animates the map into that area rather than opening a chat — clusters are navigation, not content.
- Threshold-based: clusters only form when bubbles are close enough in screen-space at the current zoom (not a fixed geographic radius), so behavior feels natural while panning/zooming.
- No server-side pre-aggregation needed for MVP scale — client-side clustering over a few hundred visible bubbles is cheap. Revisit if a single viewport can contain tens of thousands of active bubbles (major foreseeable pinch point, but unlikely pre-scale).

## 8. Location Verification & Privacy Strategy

This is the part of the product where getting it wrong is a trust-destroying (or legally exposing) mistake, so the rule is simple: **the client reports raw coordinates; only the server decides eligibility, and the server persists as little of it as possible.**

- **Never trust the client for eligibility.** Every join/post action re-validates server-side: the client sends its current raw lat/lng (over TLS) to a server-side function; the server computes `ST_DWithin(user_point, conversation_geofence, radius)` using PostGIS and returns an eligibility decision. The client's own on-device distance estimate is only used for optimistic UI (e.g., graying out a "Join" button before the network round-trip resolves).
- **No raw coordinates persist.** The eligibility-check function receives the coordinate, evaluates it, writes back only a boolean/state (`inside`, `grace`, `read_only`) and a timestamp — the coordinate itself is not written to a long-lived table. If we need short-term abuse signals (teleport/velocity checks), keep a tiny ring buffer (e.g., last 2 points) with a short TTL, auto-purged, never exposed via any API.
- **Conversations expose a generalized location, never a creator's exact point.** On creation, the raw tap/long-press coordinate is snapped server-side to: a known venue/POI centroid (preferred, from a seeded POI table), else a geohash/grid cell (~100-150m), else a labeled road segment for corridor-type events. The stored `geom` used for discovery and rendering is the generalized one; the original raw point is discarded after snapping.
- **No user is ever shown as a marker.** Nothing in the client renders another user's coordinate — only conversation bubbles and participant *counts*. This is enforced structurally (the API for map data never returns per-user coordinates, so there's no accidental client-side leak).
- **Location refresh is event-driven, not polled.** Use `expo-location`'s geofencing/region-monitoring where the OS supports it, plus significant-change updates, plus a foreground refresh when the user is actively viewing the map or has an open conversation. Reduce frequency when backgrounded or stationary. This is both a battery requirement and a privacy requirement (less data in flight, less reason to store it).
- **Data minimization & deletion.** Full account + associated message/participation deletion is a first-class, self-service action. No permanent per-user location history is ever built, by construction — there's nothing sensitive left to delete beyond messages and the account record.

## 9. Join, Leave, and Grace-Period Behavior

Lifecycle states per user-per-conversation: `inside → recently_left (grace) → read_only → removed`.

- **Inside area:** full read/write, counted in `active_participants`.
- **Recently left (grace):** still full read/write. Triggered the moment a re-check finds the user outside the participation radius; not an immediate demotion, because GPS drift and brief step-outs (restroom, stepping outside a gate) are normal and shouldn't punish someone mid-conversation.
- **Grace expired → read-only:** can read and react/confirm, cannot post new messages, clearly labeled in the UI ("You've left this area — read-only"). Rejoins to full access automatically if the user re-enters the radius before the conversation itself expires.
- **Removed from active list:** conversation drops out of the user's "joined" list once it expires entirely (see §10); no separate per-user removal step needed beyond that.

Recommended grace periods (tunable server-side config per category, not hardcoded):

| Conversation type | Participation radius (typical) | Grace period |
|---|---|---|
| Micro-location (gate, section, table) | 30-75 m | 10-15 min |
| Venue (terminal, stadium, convention center) | 150-400 m | 20-30 min |
| Area (festival, park, neighborhood event) | 300 m - 1.5 km | 30-45 min |
| Corridor/moving (traffic, transit disruption) | along-segment band, ~200-500 m wide | 15-20 min (people keep moving) |

Rationale: tighter spaces (a gate) have less GPS ambiguity and shorter natural dwell times near the trigger point, so a shorter grace period is fine; larger venues have worse GPS multipath (indoors, stadiums) and longer natural movement patterns, so grace is longer. Corridor events get a short grace because by definition everyone involved is moving away from the incident once traffic clears.

## 10. Conversation Lifecycle & Expiration Rules

States: `new → active → cooling_down → archived → deleted`.

- **New:** just created, < 5 participants or < 10 min old.
- **Active:** meets an activity threshold (participants and/or recent messages above a floor).
- **Cooling down:** activity score has fallen below threshold for a sustained window (e.g., 15+ min with no new messages and shrinking participant count) — bubble visibly shrinks/fades per §6, still fully joinable/postable.
- **Archived:** conversation has expired per its category's TTL, or activity has been at zero for a category-specific idle-timeout, whichever comes first. Archived conversations disappear from the map and from all "joined" lists; they are not stored as a browsable public history. Retained briefly (e.g., 24-72h) in a non-public store purely for moderation/appeals, then hard-deleted.
- **Deleted:** removed by moderator/report action, or past the archive retention window.

Recommended default TTLs (also server-config, overridable per instance — e.g., a specific flight-delay conversation can get extended if the flight is still delayed):

| Type | Default expiration |
|---|---|
| Airport gate / flight | 4-6 hours, or 60-90 min after the flight's scheduled/actual departure, whichever is later |
| Traffic incident | 1-3 hours, or auto-extended in 30-min increments while message activity continues, hard cap ~4h |
| Concert / sporting event | Event duration + ~60-90 min after scheduled end |
| Conference | Rolling per-day expiration (e.g., expires at venue close, a fresh shell reopens next day) rather than spanning the whole multi-day event as one thread |
| Generic / user-created, uncategorized | 3 hours default, extendable by continued activity, hard cap 24h |

An idle-based cutoff (e.g., archive early if zero messages for 45-60 min regardless of category TTL) prevents dead bubbles from lingering just because the category ceiling is long.

## 11. Profile & Reputation Recommendations

Two separate concepts, deliberately: **visible reputation** (gamified, public, coarse) and **internal trust score** (private, precise, used only for platform decisions).

**Public profile (compact card only, on username tap):** username, generated avatar, level, helpfulness points, up to ~3 badges, account age (coarse: "member for 4 months," not a date), block/report actions. Nothing else — no history, no feed, no location.

**Visible reputation earns from, weighted by unique confirming users and capped daily:**
- Helpful reactions from distinct users (first N/day count fully, diminishing after).
- An "accepted answer" style marker on a message.
- Multi-user-confirmed updates ("Community confirmed by 8 nearby participants" — requires a minimum number of *distinct, currently-eligible* confirmers, and is visually/textually distinguished from any future official/verified-source label).
- Upheld reports (rewards correct reporting, not just reporting volume).

**Explicitly does not earn points:** message count, chats joined, session time, login streaks, bubble-creation count — all called out in the brief and correctly excluded, since every one of them is trivially farmable and pushes toward "post more," which is the opposite of what a situational-utility app wants.

**Private trust score** (never rendered to any user, including the owner, in MVP): account age, moderation history, report accuracy history (as reporter and as reported), device/velocity anomaly signals, location-consistency signals, spam/rate-limit violations. Used to gate things like message visibility (shadow-limit low-trust accounts' reach), eligibility for creating conversations, and priority in moderation queues. Keeping it fully internal avoids users gaming a known formula and avoids a whole class of "why is my score X" support burden in MVP.

Levels/badges should be few and legible in MVP (e.g., 5 levels, 4-6 badge types like "Helpful Reporter," "Storm Tracker" for confirmed traffic updates, "Regular" for account age) — a sprawling badge system is a v2+ investment, not an MVP one.

## 12. Moderation & Safety Strategy

Given physical proximity between participants, this is treated as a safety system, not a nice-to-have.

- Report message / report user / block user available from every message and every profile card, one tap, no dead ends.
- Blocking is bidirectional-invisible: blocked user's messages are hidden from the blocker in shared conversations; no notification to the blocked user.
- Server-side rate limiting per user (messages/min, conversations created/hour, joins/hour) tuned tighter for new/low-trust accounts.
- Automated profanity/abuse filtering as a first pass (flag + soft-hide pending review for severe matches, not silent auto-post-then-review for the worst categories).
- Moderator tooling: lock a conversation (read-only for everyone), delete a message, suspend/ban a user, view a report queue with context, reverse a moderation action, audit log of all moderator actions for appeals.
- Duplicate/fake-incident detection: heuristic pass (new conversation's title/category vs. nearby active ones, plus a "how many people are reporting this doesn't match reality" signal via the Confirm/Incorrect feedback) escalates to human moderation rather than auto-deleting — false positives here are costly to trust.
- Explicit protection against impersonating officials: since verified roles are deferred, the *absence* of any verified badge in MVP is itself the protection — no user, including staff, can display an "Official" marker in MVP, which sidesteps the impersonation problem until real verification ships.
- No direct messages in MVP — removes an entire class of stalking/harassment vector between two people who now know they're physically near each other, at effectively zero product cost right now.
- Appeals: a lightweight "appeal this action" path tied to the audit log so suspensions aren't a black box, handled by a human queue in MVP (no need for in-app appeal UI beyond a report/contact form initially).

## 13. Cold-Start Strategy

An empty map on first open kills the product before it gets a chance to prove the concept, so this gets real MVP investment, not just a "later" wave.

- **Seeded venue-level shells** for a curated launch set of high-traffic locations (major airports' terminals/gates, a handful of stadiums/arenas, a couple of conference venues) — pre-created "container" conversations like "SFO Terminal 2" that are always visible and always joinable, so there's *something* even before organic activity exists.
- **Demo/seed content** for QA and early users in supported launch cities, generated via the dev-mode simulator (see below), clearly distinguishable internally from real user content.
- **Adaptive discovery radius:** if a user's immediate area has little/no activity, silently widen the query radius (with a UI cue, "showing conversations up to 2km away") rather than showing nothing, and surface the single nearest larger event ("Concert at the Amphitheater — 1.4 km") as a fallback tile.
- **One-tap create** front and center when the map is quiet — turn "nothing's here" into "be the first," with a friendly empty-state prompt rather than a blank map.
- **Phased city/venue launch**, not a global cold-open — concentrate the userbase (and seeded content) in a small number of launch locations first, since density is the entire value proposition; a thin nationwide user base produces uniformly empty maps everywhere.
- **v2+**: real integrations (flight status boards, DOT/Waze-style traffic feeds, event calendars, transit APIs) to auto-generate high-confidence shells at scale — deliberately post-MVP since each is a separate data-partnership project, not core loop work.

## 14. Recommended Technology Stack

The proposed stack (Expo/React Native, Supabase, Postgres+PostGIS, Supabase Realtime/Auth, Mapbox or Google Maps, Expo Location, Expo Push) is fundamentally sound for this MVP — it's low-ops, has native geospatial support, and gets a small team to a real product fast. Two changes and one addition:

- **Map SDK: Mapbox, not Google Maps.** Custom marker/bubble rendering (variable size, animated, clustered, chat-bubble-shaped) is Mapbox's strength — `@rnmapbox/maps` gives closer control over marker layers and clustering than the Google Maps RN wrapper, and Mapbox's pricing model is friendlier at MVP-stage load-testing volumes. Google Maps remains a fine fallback if the team already has GCP/Google Maps credits or platform commitments.
- **Add Supabase Edge Functions as the application layer for anything trust-sensitive.** Direct client → Postgres (even behind Row Level Security) is fine for straightforward reads/writes, but geo-eligibility checks, activity-score computation, duplicate-conversation suggestion, and moderation actions should not be expressible as a client-issued query — they need server-owned logic and are exactly what Edge Functions (Deno, colocated with the DB) are for. This keeps "never trust the client for location" enforceable in one place instead of relying on RLS policies alone to encode geospatial trust logic.
- **Client-side clustering via `supercluster`**, state via **Zustand** (local UI/session state) + **TanStack Query** (server cache/subscriptions bridge) — both are small, well-understood additions that fit an Expo app cleanly and avoid over-engineering with a heavier framework.
- **`pg_cron`** (Supabase-supported) for the periodic activity-score recompute and expiration sweep job, rather than a separate worker service — one less piece of infrastructure to run for MVP.

What I would *not* add for MVP, despite being tempting: a separate geospatial search engine (Elasticsearch/Algolia) — PostGIS with proper GIST indexes on `geography` columns comfortably handles MVP-scale radius queries; a dedicated microservices split — a monolith of Edge Functions + Postgres is the right complexity level until there's real scale pressure; a custom WebSocket server — Supabase Realtime (built on Postgres logical replication + Phoenix channels) already covers both chat messages and bubble metadata updates.

## 15. Database Schema (Postgres + PostGIS)

Core tables (types abbreviated; see the actual `schema.sql` deliverable for full DDL, indexes, and RLS policy notes):

- `users` — id, auth_id (fk to Supabase auth), username (unique), avatar_seed, level, helpful_points, created_at, is_deleted.
- `user_trust_scores` (private, no client-readable policy) — user_id, trust_score, signals jsonb, updated_at.
- `venues` — id, name, category, geom geography(Point), metadata jsonb (seed/reference data for snapping + cold-start shells).
- `conversations` — id, title, category enum(micro_location, venue, area, corridor), status enum(new, active, cooling_down, archived, deleted), geom geography(Point) [generalized location, indexed GIST], venue_id fk nullable, road_label text nullable, discovery_radius_m, participation_radius_m, created_by fk users, created_at, expires_at, last_activity_at, activity_score numeric.
- `conversation_participants` — conversation_id, user_id, state enum(inside, grace, read_only, left), joined_at, grace_started_at, last_check_at. PK (conversation_id, user_id).
- `messages` — id, conversation_id, user_id, body text, reply_to_id nullable fk messages, created_at, deleted_at nullable, flagged boolean.
- `reactions` — message_id, user_id, type text, PK (message_id, user_id, type).
- `confirmations` — message_id, user_id, type enum(helpful, confirm, cannot_confirm, incorrect), created_at, PK (message_id, user_id).
- `reports` — id, reporter_id, target_type enum(message, user, conversation), target_id uuid, reason, created_at, status enum(open, upheld, dismissed), resolved_by, resolution_notes.
- `blocks` — blocker_id, blocked_id, created_at, PK (blocker_id, blocked_id).
- `badges` / `user_badges` — reference table + join table.
- `moderation_actions` — id, moderator_id, target_type, target_id, action, reason, created_at (append-only audit log).

Deliberately absent: any table storing raw per-user coordinate history. Eligibility checks are a stateless function call (`check_eligibility(user_id, conversation_id, lat, lng)`), not a coordinate log.

## 16. Application Architecture

```
Expo (React Native + TS) app
 ├─ Map screen: Mapbox GL + supercluster (client clustering) + bubble render layer
 ├─ Conversation screen: chat UI, Realtime channel per conversation
 ├─ Dev/simulator mode: mock location + mock users, gated behind a build flag
 ├─ State: Zustand (session/UI) + TanStack Query (server cache)
 └─ services/ — thin client wrapping Supabase JS SDK, swappable for the mock backend in dev mode
        │
        ▼
Supabase
 ├─ Auth (anonymous + optional Apple/Google/email/phone upgrade)
 ├─ Postgres + PostGIS (source of truth, RLS on all user-facing tables)
 ├─ Realtime (per-conversation message channels; per-geo-tile bubble metadata channels)
 ├─ Edge Functions (Deno) — trust-sensitive logic:
 │    ├─ checkEligibility(userId, conversationId, lat, lng) → inside/grace/read_only + writes state, discards coordinate
 │    ├─ createConversation(...) → snaps location, runs duplicate-suggestion query, creates row
 │    ├─ suggestDuplicates(lat, lng, category, title) → keyword+proximity match against active conversations
 │    ├─ moderationAction(...) → lock/delete/suspend, writes audit log
 │    └─ recomputeActivity (pg_cron trigger) → recalculates activity_score, flips lifecycle states, sweeps expirations
 └─ Push (Expo Push token registry + trigger from Edge Functions on relevant events)
```

The client never talks to Postgres for anything eligibility- or moderation-related except through Edge Functions; plain reads (map bubble list within a viewport, chat history for a joined conversation) go through RLS-protected Supabase queries/Realtime subscriptions directly, since those are safe to express declaratively.

## 17. Major Risks & How to Test the Concept

**Risks:**

- **Cold start / density problem.** The product only works where there's a critical mass of simultaneous users — this is the single biggest existential risk, bigger than any technical risk. Mitigated by phased, concentrated launch (§13), not by broad-but-thin rollout.
- **GPS spoofing.** A user can fake location to join/post in a conversation they're not physically near. MVP cannot fully solve this; mitigate with server-side velocity/teleport sanity checks and trust-score penalties for repeated anomalies, and treat it as an accepted residual risk to monitor, not something to over-engineer against pre-launch.
- **Harassment given known physical proximity.** The scariest failure mode for this category of app. Mitigated structurally: no DMs, no exact location ever shown, easy block/report, aggressive rate limiting for new accounts, moderator lock power on any conversation.
- **Fake incidents / spam bubbles** (e.g., fabricating a traffic jam or security incident). Mitigated by Confirm/Incorrect community feedback, report-and-lock moderator tooling, and reputation penalties for upheld fake-incident reports.
- **Battery drain** from location services souring first impressions. Mitigated by event-driven (not polled) location updates (§8).
- **Reputation farming** undermining the trust signals the whole helpfulness system depends on. Mitigated by unique-user weighting, daily diminishing returns, and keeping the precise trust score private so it can't be reverse-engineered and gamed.
- **Regulatory/compliance**: location data handling triggers GDPR/CCPA-type obligations; minor-safety obligations (COPPA) apply if under-13 users are foreseeable given proximity-with-strangers features. Recommend an explicit 16+ or 18+ age gate for MVP rather than building COPPA-compliant flows for a launch that doesn't need them yet, and a documented data-minimization posture (which §8 already gives for free) to reduce regulatory surface area.

**How to test the concept before/alongside building:**

- Use the dev-mode simulator (already in MVP scope) to run internal scripted scenarios — spin up 30-50 synthetic users at a fake airport terminal, watch bubble growth/clustering/decay behave correctly — this validates the *mechanics* without needing real crowds.
- Run a small, real-world pilot in a single dense, recurring-crowd venue the team can reach in person (a local stadium, a campus, a commuter corridor) with a TestFlight/Play internal track group, before any public launch — this validates the *behavioral* hypothesis (do strangers actually post) that no simulator can.
- Instrument and watch three numbers above all else during the pilot: percentage of users who see a bubble and join it, percentage of joiners who post at least once, and whether conversations stay useful/civil without heavy manual moderation intervention. If join-to-post conversion is very low, the product's core loop — not any individual feature — needs rethinking before building further.
- Treat the pilot as a kill-switch checkpoint: if strangers reliably don't talk to each other even in a high-density, high-relevance setting (e.g., a packed concert), that's a finding about the core thesis, not a bug to fix with more features.
