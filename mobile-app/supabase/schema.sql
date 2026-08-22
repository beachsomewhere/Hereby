-- Hereby - MVP schema (Postgres + PostGIS, Supabase)
-- Mirrors src/services/types.ts and Phase 1 strategy doc section 15/16.
--
-- Design rules encoded here on purpose:
--   1. No table stores a user's raw/precise coordinate history.
--   2. conversations.location is always a *generalized* (snapped) point -
--      the raw tap/long-press point is only ever seen in the
--      createConversation Edge Function and discarded after snapping.
--   3. Everything trust-sensitive (eligibility, activity scoring, duplicate
--      suggestion, moderation) is written to only go through Edge Functions
--      using the service role - not exposed as direct client write paths,
--      even though tables have RLS policies as defense in depth.
--
-- Idempotent throughout (if-not-exists / drop-then-create / duplicate_object
-- guards) so this can be re-run safely against a project that already has
-- some of this applied - e.g. `users` already exists here from the
-- pre-existing auth signup flow, before any of the rest of this schema was
-- ever pushed.

create extension if not exists postgis;
create extension if not exists pg_cron;
create extension if not exists pg_trgm; -- trigram similarity, used by suggest_duplicate_conversations
create extension if not exists pg_net; -- net.http_post, used by the recompute-activity cron job below -
-- confirmed live: without this the job has been failing every single
-- minute ("schema net does not exist") since it was first scheduled.

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_seed text not null,
  level integer not null default 1,
  helpful_points integer not null default 0,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index if not exists users_auth_id_idx on public.users(auth_id);

-- Chosen unlockable icon (see src/services/avatarIcons.ts) - null until
-- picked, client falls back to initials-in-a-circle. Added via ALTER rather
-- than inline in the CREATE TABLE above, since `users` already existed
-- before this column did.
alter table public.users add column if not exists avatar_icon text;

-- Self-attested age confirmation, required at signup (see
-- OnboardingScreen.tsx) - like any self-attestation this doesn't stop
-- someone determined to lie, but it's the same baseline every major social
-- app uses and satisfies COPPA's "reasonable" bar plus what Apple review
-- expects for UGC apps. We deliberately store only this boolean, not the
-- birthdate itself entered client-side to derive it - the app's own
-- data-minimization principle (see docs/privacy.html) means not persisting
-- more than the one fact actually needed. Enforced client-side only
-- (OnboardingScreen blocks continuing past the birthdate step if under 18) -
-- deliberately no DB check constraint requiring true, since that would
-- break re-running this file against a database that already has real rows
-- (they'd all backfill to false and fail validation), and a self-attestation
-- column isn't a real security boundary a DB constraint would meaningfully
-- strengthen anyway.
alter table public.users add column if not exists age_verified boolean not null default false;

-- Private. No select policy grants this to authenticated users - only
-- service-role Edge Functions read/write it. Never returned to any client.
create table if not exists public.user_trust_scores (
  user_id uuid primary key references public.users(id) on delete cascade,
  trust_score numeric not null default 50,
  signals jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  icon text not null
);

create table if not exists public.user_badges (
  user_id uuid not null references public.users(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- Venues / POIs - seed data used both for cold-start shells and for
-- snapping newly created conversations to a recognizable place.
-- ---------------------------------------------------------------------------
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null, -- 'airport_terminal', 'stadium', 'convention_center', ...
  location geography(point, 4326) not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists venues_location_gix on public.venues using gist (location);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
do $$ begin
  create type conversation_status as enum ('new', 'active', 'cooling_down', 'archived', 'deleted');
exception when duplicate_object then null;
end $$;

-- Radius is a free choice (a slider client-side, not a fixed tier) rather
-- than a category enum - discovery/participation radius, grace period, and
-- TTL are all derived from participation_radius_m at creation time (see
-- mockBackend.ts's interpolateForRadius and friends, mirrored here).
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status conversation_status not null default 'new',
  location geography(point, 4326) not null, -- generalized/snapped, see note above
  venue_id uuid references public.venues(id),
  road_label text,
  discovery_radius_m integer not null,
  participation_radius_m integer not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  activity_score numeric not null default 0,
  participant_count integer not null default 0,
  messages_last_15min integer not null default 0
);
create index if not exists conversations_location_gix on public.conversations using gist (location);
create index if not exists conversations_status_idx on public.conversations(status);
create index if not exists conversations_expires_at_idx on public.conversations(expires_at);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  state text not null check (state in ('inside', 'grace', 'read_only', 'left')),
  joined_at timestamptz not null default now(),
  grace_started_at timestamptz,
  last_check_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Threads - every conversation always has exactly one is_general=true row,
-- inserted alongside the conversation itself (see createConversation Edge
-- Function). Participants can create additional threads scoped to the same
-- location conversation; eligibility/participation stays conversation-level,
-- not per-thread.
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  is_general boolean not null default false,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists threads_conversation_id_idx on public.threads(conversation_id);
-- Exactly one General thread per conversation.
create unique index if not exists threads_one_general_per_conversation_idx
  on public.threads(conversation_id)
  where is_general;

-- ---------------------------------------------------------------------------
-- Messages, reactions, confirmations
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.users(id),
  -- Snapshot of the author's username at send time - not live-updating; a
  -- username change (were that ever supported) wouldn't relabel older
  -- messages. Stamped server-side by trg_stamp_message_author below.
  username text not null default '',
  -- Snapshot of users.level at send time (see recomputeReputation) - like
  -- username, not live-updating; a user leveling up doesn't relabel their
  -- older messages.
  author_level integer not null default 1,
  -- Same snapshot treatment as author_level - stamped server-side by
  -- trg_stamp_message_author below, never trusted from the client.
  author_avatar_icon text,
  body text not null check (char_length(body) <= 2000),
  reply_to_id uuid references public.messages(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  flagged boolean not null default false
);
create index if not exists messages_thread_id_idx on public.messages(thread_id, created_at);
create index if not exists messages_conversation_id_idx on public.messages(conversation_id, created_at);

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, type)
);

-- Reddit-style up/down vote on a message - never reorders anything, only
-- feeds the author's users.helpful_points / level (see
-- mockBackend.ts#voteMessage for the mirrored logic).
do $$ begin
  create type confirmation_type as enum ('upvote', 'downvote');
exception when duplicate_object then null;
end $$;

create table if not exists public.confirmations (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type confirmation_type not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Reports, blocks, moderation
-- ---------------------------------------------------------------------------
do $$ begin
  create type report_target_type as enum ('message', 'user', 'conversation');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type report_status as enum ('open', 'upheld', 'dismissed');
exception when duplicate_object then null;
end $$;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id),
  target_type report_target_type not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  status report_status not null default 'open',
  resolved_by uuid references public.users(id),
  resolution_notes text
);
create index if not exists reports_status_idx on public.reports(status);

create table if not exists public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Append-only audit log for every moderator action, backing the appeals flow.
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.users(id),
  target_type report_target_type not null,
  target_id uuid not null,
  action text not null, -- 'lock_conversation', 'delete_message', 'suspend_user', ...
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security (sketch - tighten per-column before production use)
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_participants enable row level security; -- writes only via join/leave RPCs and Edge Functions (service role/SECURITY DEFINER) - see the SELECT policy below for why it can't stay policy-free entirely
alter table public.user_trust_scores enable row level security; -- no policies -> service role only
alter table public.reports enable row level security;
-- Confirmed already true live on the project (apparently a Supabase
-- default for new tables, not something this file ever explicitly set) -
-- included here so the file matches reality. Zero policies meant
-- getConfirmations() silently got nothing back regardless of what
-- vote_message() had actually written - confirmed live: a real
-- upvote's row existed in the table, but a plain authenticated SELECT
-- against it returned empty, which is exactly what RLS-enabled-zero-
-- policies does (deny-all, not an error).
alter table public.confirmations enable row level security;

-- Vote counts are public within a conversation (shown to every viewer of a
-- message, not just the voter), so this is intentionally NOT scoped to the
-- caller's own rows the way conversation_participants' policy is below -
-- readable by anyone who can read the underlying message.
drop policy if exists "confirmations are readable by anyone who can read the message" on public.confirmations;
create policy "confirmations are readable by anyone who can read the message"
  on public.confirmations for select
  using (
    exists (
      select 1 from public.messages m
      where m.id = confirmations.message_id and m.deleted_at is null
    )
  );
-- Deliberately no INSERT/UPDATE/DELETE policy - voting only ever happens
-- through vote_message() (below), which is SECURITY DEFINER and bypasses
-- RLS internally.

-- `users` predates the rest of this schema (created during the original
-- account-signup work) and never had RLS enabled - without this, any
-- authenticated client could UPDATE their own level/helpful_points/
-- avatar_icon directly, completely bypassing vote_message()/
-- update_avatar_icon() below, which exist specifically to prevent that.
alter table public.users enable row level security;

drop policy if exists "users are readable by any authenticated user" on public.users;
create policy "users are readable by any authenticated user"
  on public.users for select
  using (not is_deleted);
  -- Broad read is intentional - usernames/avatars/levels are shown on every
  -- message and profile card, not private data (unlike user_trust_scores).

drop policy if exists "users can create their own profile row" on public.users;
create policy "users can create their own profile row"
  on public.users for insert
  with check (auth_id = auth.uid());
  -- authService.ts#createProfile does a direct client insert (unlike every
  -- other users-table write, which goes through a SECURITY DEFINER RPC) -
  -- this is the one case that needs a real INSERT policy rather than none.

-- Deliberately no UPDATE policy for authenticated/anon - level/
-- helpful_points change only via vote_message(), avatar_icon only via
-- update_avatar_icon() (both below), which are SECURITY DEFINER and bypass
-- RLS internally, so they keep working with zero UPDATE policy present.

drop policy if exists "users can file their own reports" on public.reports;
create policy "users can file their own reports"
  on public.reports for insert
  with check (reporter_id = (select id from public.users where auth_id = auth.uid()));
  -- Deliberately no select policy for authenticated/anon - reports are
  -- moderator-only, same "never exposed to the client" treatment as
  -- user_trust_scores gets above.

drop policy if exists "conversations are readable within discovery radius" on public.conversations;
create policy "conversations are readable within discovery radius"
  on public.conversations for select
  using (status not in ('archived', 'deleted'));
  -- Discovery-radius filtering happens in the query (ST_DWithin against the
  -- caller's location), not in the policy itself, since RLS can't easily
  -- see a request-time coordinate. See getVisibleConversations in the
  -- client, mirrored server-side by a SECURITY DEFINER function.

-- Without this, the messages/threads INSERT policies below can't work: a
-- WITH CHECK clause's EXISTS subquery against conversation_participants
-- runs under the INSERTING user's own RLS context, not a privileged one -
-- with zero SELECT policy, that subquery always sees zero rows regardless
-- of what's actually there, so the "inside or grace" check would fail
-- unconditionally for every user, every conversation, forever (this exact
-- bug - confirmed live, not theoretical). Own-rows-only, so this doesn't
-- reopen the "no direct writes" invariant - only SELECT is granted.
drop policy if exists "users can read their own participant rows" on public.conversation_participants;
create policy "users can read their own participant rows"
  on public.conversation_participants for select
  using (user_id = (select id from public.users where auth_id = auth.uid()));

drop policy if exists "threads are readable by anyone who can read the conversation" on public.threads;
create policy "threads are readable by anyone who can read the conversation"
  on public.threads for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = threads.conversation_id and c.status not in ('archived', 'deleted')
    )
  );

drop policy if exists "threads can only be created by participants who are inside or in grace" on public.threads;
create policy "threads can only be created by participants who are inside or in grace"
  on public.threads for insert
  with check (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = threads.conversation_id
        and cp.user_id = (select id from public.users where auth_id = auth.uid())
        and cp.state in ('inside', 'grace')
    )
  );

drop policy if exists "messages are readable by anyone who can read the conversation" on public.messages;
create policy "messages are readable by anyone who can read the conversation"
  on public.messages for select
  using (deleted_at is null);

drop policy if exists "messages can only be inserted via participants who are inside or in grace" on public.messages;
create policy "messages can only be inserted via participants who are inside or in grace"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = (select id from public.users where auth_id = auth.uid())
        and cp.state in ('inside', 'grace')
    )
  );
  -- Note: this only protects against a stale/forged client state row. The
  -- actual "am I really there" check happens earlier, in the
  -- checkEligibility Edge Function, which is what writes cp.state in the
  -- first place. Never trust a client-supplied state directly.

-- Stamps username/author_level/author_avatar_icon from the CURRENT users
-- row at insert time, overriding whatever the client sent - otherwise a
-- client could lie about its own username/level/icon in a message's
-- snapshot. Also derives conversation_id from thread_id server-side - the
-- client's sendMessage only ever knows a thread_id (matching
-- mockBackend.ts#sendMessage's signature exactly), and this runs as a
-- BEFORE trigger, so the NOT NULL constraint on messages.conversation_id is
-- checked against the value this sets, not whatever (or nothing) the client
-- sent.
--
-- Also bumps threads.last_activity_at and conversations.last_activity_at -
-- confirmed live these were never updated anywhere after creation, only
-- ever set once by their own column default / create_conversation_with_
-- general_thread. mockBackend.ts's sendMessage always bumped both
-- (thread.lastActivityAt = msg.createdAt; conv.lastActivityAt =
-- msg.createdAt) - the real backend never replicated that. Beyond just
-- breaking the unread-thread indicator (hasUnread compares against a
-- last_activity_at that never advances), this also means
-- recomputeActivity's score formula was treating every conversation as
-- idle since the moment it was created, regardless of actual message
-- volume - a much bigger correctness gap than the one symptom that
-- surfaced it.
create or replace function public.stamp_message_author() returns trigger
language plpgsql as $$
begin
  select username, level, avatar_icon into new.username, new.author_level, new.author_avatar_icon
  from public.users where id = new.user_id;
  select conversation_id into new.conversation_id from public.threads where id = new.thread_id;
  update public.threads set last_activity_at = new.created_at where id = new.thread_id;
  update public.conversations set last_activity_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_stamp_message_author on public.messages;
create trigger trg_stamp_message_author
  before insert on public.messages
  for each row execute function public.stamp_message_author();

-- ---------------------------------------------------------------------------
-- Flat per-user rate limit on posting - nothing previously stopped one
-- account from flooding a conversation. BEFORE INSERT so a violation blocks
-- the insert outright, surfaced to the client as a normal Postgres error
-- (same path as any other insert failure, via supabaseBackend.ts's raise()
-- wrapper). Named to sort alphabetically before trg_stamp_message_author
-- above, so a rate-limited request fails fast without doing that trigger's
-- work first - Postgres runs same-table BEFORE triggers in trigger-name
-- order.
--
-- Deliberately simple for v1: one flat threshold for every account, not
-- scaled by conversation size or tiered by trust level (both real ideas -
-- phase1-strategy.md itself calls for "tighter for new/low-trust accounts" -
-- deferred until there's real usage data to calibrate thresholds against
-- rather than guessing).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_message_rate_limit() returns trigger
language plpgsql as $$
declare
  v_recent_count integer;
  v_tenth_newest timestamptz;
  v_wait_seconds integer;
begin
  select count(*) into v_recent_count
  from public.messages
  where user_id = new.user_id
    and created_at > now() - interval '60 seconds';

  if v_recent_count >= 10 then
    -- The 10th-most-recent message in the window is the one whose 60-second
    -- age-out is what actually frees up a slot - report the real remaining
    -- time until that happens, not a vague "wait a moment."
    select created_at into v_tenth_newest
    from public.messages
    where user_id = new.user_id
      and created_at > now() - interval '60 seconds'
    order by created_at desc
    offset 9
    limit 1;
    v_wait_seconds := greatest(1, ceil(extract(epoch from (v_tenth_newest + interval '60 seconds' - now())))::integer);
    raise exception 'You are sending messages too quickly. Try again in % seconds.', v_wait_seconds;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_message_rate_limit on public.messages;
create trigger trg_enforce_message_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

-- ---------------------------------------------------------------------------
-- Fires the notifyNewMessage Edge Function on every new message, which
-- resolves eligible (joined, unmuted) recipients and pushes to their
-- registered devices. Deliberately a SEPARATE trigger from
-- trg_stamp_message_author above (BEFORE INSERT, constructs
-- new.conversation_id mid-execution) - this one needs the fully-resolved
-- AFTER-insert row. net.http_post is fire-and-forget/async (queues to a
-- background worker, doesn't block the insert) - a dropped push is
-- low-stakes here (the user still sees the message when they open the
-- thread), so no retry logic. Row-level, since messages are never
-- batch-inserted anywhere in this codebase.
--
-- Recipient-targeting logic deliberately lives in the Edge Function
-- (TypeScript), not duplicated into this trigger's SQL - matching
-- recomputeActivity's own rationale for keeping the heavy lifting there for
-- testability, and it's exactly the part that'll keep changing as
-- "advanced targeting" gets built later.
--
-- The service-role key lives in Supabase Vault (set once, outside this
-- file: select vault.create_secret('<real-key>', 'notify_new_message_
-- service_key')) rather than inline here - confirmed live as a real
-- failure mode: this file gets re-run in full periodically (it's the
-- single source of truth, idempotent by design), and an inline placeholder
-- silently reverts any manual "fill in the real key" edit every time,
-- exactly what happened here. Referencing the secret by name survives any
-- number of re-runs. The project ref itself isn't secret, so it stays
-- hardcoded directly.
--
-- SECURITY DEFINER: vault.decrypted_secrets is deliberately locked down
-- (it decrypts secrets to plaintext), and messages are inserted directly by
-- the client's own `authenticated` role - without this, the vault lookup
-- itself fails with "permission denied for schema vault", proving the same
-- point the exception handler below exists for: notification delivery
-- (including looking up its own credentials) must never be able to break
-- message sending. That's why the vault lookup is ALSO inside the
-- exception-wrapped block now, not just the net.http_post call - confirmed
-- live that a failure anywhere before that inner BEGIN still propagated up
-- and failed the whole message INSERT.
--
-- net.http_post itself validates its URL argument SYNCHRONOUSLY and raises
-- if malformed - the other confirmed-live reason this whole block needs its
-- own exception handler, not just defensive plpgsql style.
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_message() returns trigger
language plpgsql
security definer
as $$
declare
  v_service_key text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets
    where name = 'notify_new_message_service_key';

    perform net.http_post(
      url := 'https://fuhdxvyqahwmikpgiikk.functions.supabase.co/notifyNewMessage',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object('messageId', new.id)
    );
  exception when others then
    raise warning 'notify_new_message failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on public.messages;
create trigger trg_notify_new_message
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- ---------------------------------------------------------------------------
-- Server-side eligibility check, callable by the checkEligibility Edge
-- Function (or directly via RPC for simple cases). Takes a raw coordinate,
-- returns a decision, and does NOT persist the coordinate anywhere.
-- ---------------------------------------------------------------------------
create or replace function public.check_eligibility(
  p_user_id uuid,
  p_conversation_id uuid,
  p_lat double precision,
  p_lng double precision
) returns text
language plpgsql
security definer
as $$
declare
  v_conversation public.conversations%rowtype;
  v_distance_m double precision;
  v_state text;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    return 'left';
  end if;

  v_distance_m := ST_Distance(
    v_conversation.location,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  );

  if v_distance_m <= v_conversation.participation_radius_m then
    v_state := 'inside';
  else
    -- Grace-period logic lives in the Edge Function, which knows the
    -- participant's prior state and radius-derived grace window (see
    -- Phase 1 doc section 9); this function only answers "inside or not."
    v_state := 'outside';
  end if;

  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Map/duplicate-suggestion queries. Radius is per-row (each conversation's
-- own discovery/participation radius), which supabase-js's plain query
-- builder can't express - these are the RPCs the client and Edge Functions
-- call instead of a raw ST_DWithin filter.
--
-- All four return this flattened shape (lat/lng as plain doubles) rather
-- than `setof conversations` - PostgREST returns a `geography` column as
-- opaque WKB hex over the wire, which the client would need a WKB parser to
-- read back; computing ST_Y/ST_X server-side avoids that entirely.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.conversation_flat as (
    id uuid, title text, status conversation_status, lat double precision, lng double precision,
    venue_id uuid, road_label text, discovery_radius_m integer, participation_radius_m integer,
    created_by uuid, created_at timestamptz, expires_at timestamptz, last_activity_at timestamptz,
    activity_score numeric, participant_count integer, messages_last_15min integer,
    thread_count integer, last_message_preview text
  );
exception when duplicate_object then null;
end $$;

-- thread_count/last_message_preview were added after conversation_flat's
-- first release - ALTER TYPE ADD ATTRIBUTE (rather than the create-type-
-- if-not-exists guard above, which only fires on a truly first-ever run)
-- so re-running this file against a project that already has the type
-- picks them up too. duplicate_column is the exact error Postgres raises
-- for an attribute that's already been added by a prior run.
do $$ begin
  alter type public.conversation_flat add attribute thread_count integer;
exception when duplicate_column then null;
end $$;
do $$ begin
  alter type public.conversation_flat add attribute last_message_preview text;
exception when duplicate_column then null;
end $$;
do $$ begin
  alter type public.conversation_flat add attribute is_participant boolean;
exception when duplicate_column then null;
end $$;

-- Every conversation_flat-returning query below computes thread_count and
-- last_message_preview the same way: a scalar subquery each, matching
-- mockBackend.ts#toSummary's `${username}: ${body}` format exactly. Cheap
-- at this scale (indexed on conversation_id/thread_id) and keeps the client
-- to one round-trip instead of an N+1 per conversation.

-- Discovery-radius net, for duplicate-suggestion (wider than participation).
create or replace function public.nearby_conversations(p_lat double precision, p_lng double precision)
returns setof public.conversation_flat
language sql stable
as $$
  select c.id, c.title, c.status, ST_Y(c.location::geometry), ST_X(c.location::geometry),
         c.venue_id, c.road_label, c.discovery_radius_m, c.participation_radius_m,
         c.created_by, c.created_at, c.expires_at, c.last_activity_at,
         c.activity_score, c.participant_count, c.messages_last_15min,
         (select count(*) from public.threads t where t.conversation_id = c.id),
         (select m.username || ': ' || m.body from public.messages m
            where m.conversation_id = c.id and m.deleted_at is null
            order by m.created_at desc limit 1),
         exists (
           -- "Joined" means a participant row still exists (leave_conversation
           -- deletes it outright) - NOT that state is currently inside/grace.
           -- Confirmed live: read_only is a normal, expected state for someone
           -- who's genuinely joined and just isn't physically eligible to post
           -- right now (grace expired, or - since sweep_stale_participants -
           -- simply hasn't had the app open in a while); restricting this to
           -- inside/grace stripped the join checkmark from chats the user was
           -- still very much a member of.
           select 1 from public.conversation_participants cp
           join public.users u on u.id = cp.user_id
           where cp.conversation_id = c.id and u.auth_id = auth.uid()
         )
  from public.conversations c
  where c.status not in ('archived', 'deleted')
    and ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, c.discovery_radius_m);
$$;

-- The actual map-visibility/eligibility rule (participation radius, not
-- discovery) - mirrors mockBackend.ts#getVisibleConversations exactly.
create or replace function public.nearby_conversations_by_participation(p_lat double precision, p_lng double precision)
returns setof public.conversation_flat
language sql stable
as $$
  select c.id, c.title, c.status, ST_Y(c.location::geometry), ST_X(c.location::geometry),
         c.venue_id, c.road_label, c.discovery_radius_m, c.participation_radius_m,
         c.created_by, c.created_at, c.expires_at, c.last_activity_at,
         c.activity_score, c.participant_count, c.messages_last_15min,
         (select count(*) from public.threads t where t.conversation_id = c.id),
         (select m.username || ': ' || m.body from public.messages m
            where m.conversation_id = c.id and m.deleted_at is null
            order by m.created_at desc limit 1),
         exists (
           -- "Joined" means a participant row still exists (leave_conversation
           -- deletes it outright) - NOT that state is currently inside/grace.
           -- Confirmed live: read_only is a normal, expected state for someone
           -- who's genuinely joined and just isn't physically eligible to post
           -- right now (grace expired, or - since sweep_stale_participants -
           -- simply hasn't had the app open in a while); restricting this to
           -- inside/grace stripped the join checkmark from chats the user was
           -- still very much a member of.
           select 1 from public.conversation_participants cp
           join public.users u on u.id = cp.user_id
           where cp.conversation_id = c.id and u.auth_id = auth.uid()
         )
  from public.conversations c
  where c.status not in ('archived', 'deleted')
    and ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, c.participation_radius_m);
$$;

-- Duplicate-topic suggestion: discovery-radius proximity + trigram title
-- similarity, both done in one query rather than splitting geo-filtering
-- (SQL) from text-ranking (TS) across two different callers.
create or replace function public.suggest_duplicate_conversations(p_lat double precision, p_lng double precision, p_title text)
returns setof public.conversation_flat
language sql stable
as $$
  select c.id, c.title, c.status, ST_Y(c.location::geometry), ST_X(c.location::geometry),
         c.venue_id, c.road_label, c.discovery_radius_m, c.participation_radius_m,
         c.created_by, c.created_at, c.expires_at, c.last_activity_at,
         c.activity_score, c.participant_count, c.messages_last_15min,
         (select count(*) from public.threads t where t.conversation_id = c.id),
         (select m.username || ': ' || m.body from public.messages m
            where m.conversation_id = c.id and m.deleted_at is null
            order by m.created_at desc limit 1),
         exists (
           -- "Joined" means a participant row still exists (leave_conversation
           -- deletes it outright) - NOT that state is currently inside/grace.
           -- Confirmed live: read_only is a normal, expected state for someone
           -- who's genuinely joined and just isn't physically eligible to post
           -- right now (grace expired, or - since sweep_stale_participants -
           -- simply hasn't had the app open in a while); restricting this to
           -- inside/grace stripped the join checkmark from chats the user was
           -- still very much a member of.
           select 1 from public.conversation_participants cp
           join public.users u on u.id = cp.user_id
           where cp.conversation_id = c.id and u.auth_id = auth.uid()
         )
  from public.conversations c
  where c.status not in ('archived', 'deleted')
    and ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, c.discovery_radius_m)
    and similarity(c.title, p_title) > 0.25
  order by similarity(c.title, p_title) desc
  limit 3;
$$;

-- Single-conversation fetch in the same flattened shape, for
-- getConversation() - mirrors the pattern above rather than making the
-- client parse a raw geography column.
create or replace function public.get_conversation_by_id(p_id uuid)
returns public.conversation_flat
language sql stable
as $$
  select c.id, c.title, c.status, ST_Y(c.location::geometry), ST_X(c.location::geometry),
         c.venue_id, c.road_label, c.discovery_radius_m, c.participation_radius_m,
         c.created_by, c.created_at, c.expires_at, c.last_activity_at,
         c.activity_score, c.participant_count, c.messages_last_15min,
         (select count(*) from public.threads t where t.conversation_id = c.id),
         (select m.username || ': ' || m.body from public.messages m
            where m.conversation_id = c.id and m.deleted_at is null
            order by m.created_at desc limit 1),
         exists (
           -- "Joined" means a participant row still exists (leave_conversation
           -- deletes it outright) - NOT that state is currently inside/grace.
           -- Confirmed live: read_only is a normal, expected state for someone
           -- who's genuinely joined and just isn't physically eligible to post
           -- right now (grace expired, or - since sweep_stale_participants -
           -- simply hasn't had the app open in a while); restricting this to
           -- inside/grace stripped the join checkmark from chats the user was
           -- still very much a member of.
           select 1 from public.conversation_participants cp
           join public.users u on u.id = cp.user_id
           where cp.conversation_id = c.id and u.auth_id = auth.uid()
         )
  from public.conversations c
  where c.id = p_id;
$$;

-- For findConversationsToSupersede: candidates within a FIXED radius
-- (the new conversation's own proposed radius, not each candidate's own
-- radius) whose participation_radius_m is smaller - i.e. conversations the
-- new, broader one would become the "macro chat" for. Distinct from the
-- other geo RPCs above, which all filter by each row's own radius.
create or replace function public.conversations_to_supersede(p_lat double precision, p_lng double precision, p_radius_m integer)
returns setof public.conversation_flat
language sql stable
as $$
  select c.id, c.title, c.status, ST_Y(c.location::geometry), ST_X(c.location::geometry),
         c.venue_id, c.road_label, c.discovery_radius_m, c.participation_radius_m,
         c.created_by, c.created_at, c.expires_at, c.last_activity_at,
         c.activity_score, c.participant_count, c.messages_last_15min,
         (select count(*) from public.threads t where t.conversation_id = c.id),
         (select m.username || ': ' || m.body from public.messages m
            where m.conversation_id = c.id and m.deleted_at is null
            order by m.created_at desc limit 1),
         exists (
           -- "Joined" means a participant row still exists (leave_conversation
           -- deletes it outright) - NOT that state is currently inside/grace.
           -- Confirmed live: read_only is a normal, expected state for someone
           -- who's genuinely joined and just isn't physically eligible to post
           -- right now (grace expired, or - since sweep_stale_participants -
           -- simply hasn't had the app open in a while); restricting this to
           -- inside/grace stripped the join checkmark from chats the user was
           -- still very much a member of.
           select 1 from public.conversation_participants cp
           join public.users u on u.id = cp.user_id
           where cp.conversation_id = c.id and u.auth_id = auth.uid()
         )
  from public.conversations c
  where c.status not in ('archived', 'deleted')
    and c.participation_radius_m < p_radius_m
    and ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m);
$$;

-- ---------------------------------------------------------------------------
-- Atomic vote toggle. Race-prone otherwise: concurrent voters read-modify-
-- write helpful_points/level. Verifies the caller IS the acting user (via
-- auth.uid()) so nobody can vote as someone else through a direct rpc()
-- call. Toggle semantics mirror mockBackend.ts#voteMessage exactly: any
-- click while a vote is already active (same or opposite direction) clears
-- it back to neutral - switching direction takes two clicks, net score
-- always passes through 0 instead of skipping it.
-- ---------------------------------------------------------------------------
create or replace function public.vote_message(p_message_id uuid, p_type confirmation_type)
returns table(upvotes bigint, downvotes bigint, my_vote confirmation_type)
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_existing confirmation_type;
  v_author_id uuid;
  v_delta int;
begin
  select id into v_user_id from public.users where auth_id = auth.uid();
  if v_user_id is null then
    raise exception 'not authorized';
  end if;

  select type into v_existing from public.confirmations
    where message_id = p_message_id and user_id = v_user_id;

  if v_existing is not null then
    delete from public.confirmations where message_id = p_message_id and user_id = v_user_id;
    v_delta := case v_existing when 'upvote' then -1 else 1 end;
  else
    insert into public.confirmations (message_id, user_id, type) values (p_message_id, v_user_id, p_type);
    v_delta := case p_type when 'upvote' then 1 else -1 end;
  end if;

  select user_id into v_author_id from public.messages where id = p_message_id;
  -- helpful_points floored at 0, same as mockBackend.ts, so a pile-on of
  -- downvotes can't push an author deeply negative.
  update public.users set
    helpful_points = greatest(0, helpful_points + v_delta),
    level = (
      select count(*) from unnest(array[0, 5, 15, 40, 100]) t(threshold)
      where greatest(0, helpful_points + v_delta) >= threshold
    )
  where id = v_author_id;

  return query
    select
      (select count(*) from public.confirmations where message_id = p_message_id and type = 'upvote'),
      (select count(*) from public.confirmations where message_id = p_message_id and type = 'downvote'),
      (select type from public.confirmations where message_id = p_message_id and user_id = v_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic conversation + General thread creation - the "exactly one General
-- thread per conversation" invariant (see the partial unique index above)
-- is a real constraint, so both inserts happen in one transaction. Called
-- by the createConversation Edge Function (service role) only, never
-- directly by a client - not granted to authenticated/anon below, so
-- location-snapping (which happens in the Edge Function before this is
-- called) can't be bypassed via a direct rpc() call.
-- ---------------------------------------------------------------------------
create or replace function public.create_conversation_with_general_thread(
  p_title text,
  p_lat double precision,
  p_lng double precision,
  p_discovery_radius_m integer,
  p_participation_radius_m integer,
  p_created_by uuid,
  p_expires_at timestamptz,
  p_venue_id uuid default null
) returns public.conversation_flat
language plpgsql
security definer
as $$
declare
  v_conversation public.conversations;
  v_result public.conversation_flat;
begin
  insert into public.conversations
    (title, status, location, venue_id, discovery_radius_m, participation_radius_m, created_by, expires_at)
  values
    (p_title, 'new', ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_venue_id,
     p_discovery_radius_m, p_participation_radius_m, p_created_by, p_expires_at)
  returning * into v_conversation;

  insert into public.threads (conversation_id, title, is_general, created_by)
  values (v_conversation.id, 'General', true, p_created_by);

  select v_conversation.id, v_conversation.title, v_conversation.status, p_lat, p_lng,
         v_conversation.venue_id, v_conversation.road_label, v_conversation.discovery_radius_m,
         v_conversation.participation_radius_m, v_conversation.created_by, v_conversation.created_at,
         v_conversation.expires_at, v_conversation.last_activity_at, v_conversation.activity_score,
         v_conversation.participant_count, v_conversation.messages_last_15min
    into v_result;

  return v_result;
end;
$$;
revoke execute on function public.create_conversation_with_general_thread from public, anon, authenticated;
-- service_role's own execute right on a newly-created function comes from
-- the same PUBLIC default grant just revoked above (it's not independently
-- granted) - without this, the createConversation Edge Function's genuine
-- service-role connection would still get "permission denied" too, even
-- though revoking from public/anon/authenticated was only ever meant to
-- block direct client access.
grant execute on function public.create_conversation_with_general_thread to service_role;

-- ---------------------------------------------------------------------------
-- conversation_participants has RLS enabled but zero policies (see above) -
-- correct for join/eligibility writes (Edge-Function-only), but leaving a
-- conversation needs some client-callable path. An RPC keeps the "no direct
-- writes to this table" invariant intact rather than adding a raw DELETE
-- policy.
-- ---------------------------------------------------------------------------
create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.conversation_participants
  where conversation_id = p_conversation_id
    and user_id = (select id from public.users where auth_id = auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-user mute, so a high-volume conversation (e.g. a 1,400-person concert
-- chat) doesn't notification-spam someone who joined it. Same
-- SECURITY DEFINER / auth.uid()-scoped pattern as leave_conversation above -
-- conversation_participants has zero direct-write policies, so mutating
-- your own row goes through an RPC, not a raw UPDATE policy hole.
-- ---------------------------------------------------------------------------
alter table public.conversation_participants add column if not exists muted boolean not null default false;

create or replace function public.set_conversation_muted(p_conversation_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
as $$
begin
  update public.conversation_participants
  set muted = p_muted
  where conversation_id = p_conversation_id
    and user_id = (select id from public.users where auth_id = auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Registered Expo push tokens, one row per device install. Zero client
-- policies (same "never exposed to the client" treatment as
-- user_trust_scores) - reads are service-role only (the notify-on-message
-- function), writes go through the RPC below. Unique on the token alone
-- (not (user_id, token)) so a device re-registering under a different
-- account reassigns the row instead of leaving a stale duplicate behind.
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  expo_push_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists push_tokens_token_unique_idx on public.push_tokens(expo_push_token);
create index if not exists push_tokens_user_id_idx on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

create or replace function public.register_push_token(p_expo_push_token text)
returns void
language plpgsql
security definer
as $$
declare v_user_id uuid;
begin
  select id into v_user_id from public.users where auth_id = auth.uid();
  if v_user_id is null then raise exception 'not authorized'; end if;
  insert into public.push_tokens (user_id, expo_push_token)
  values (v_user_id, p_expo_push_token)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id, last_seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- conversations.participant_count is a denormalized column - nothing else
-- writes to it (confirmed live: it sat at 0 for a conversation two real
-- users were actively chatting in, since checkEligibility's upsert above
-- only ever touches conversation_participants itself). A trigger keeps it
-- correct regardless of which path changes participants - the
-- checkEligibility Edge Function's upsert (insert/update) and
-- leave_conversation's delete above both fire this the same way, rather
-- than needing every future write path to remember to also update the
-- count itself.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_participant_count() returns trigger
language plpgsql as $$
declare
  v_conversation_id uuid := coalesce(new.conversation_id, old.conversation_id);
begin
  update public.conversations
  set participant_count = (
    select count(*) from public.conversation_participants
    where conversation_id = v_conversation_id and state in ('inside', 'grace')
  )
  where id = v_conversation_id;
  return null;
end;
$$;

drop trigger if exists trg_recompute_participant_count on public.conversation_participants;
create trigger trg_recompute_participant_count
  after insert or update or delete on public.conversation_participants
  for each row execute function public.recompute_participant_count();

-- One-time backfill - the trigger above only catches changes from now on,
-- this corrects every conversation's already-stale count (idempotent, safe
-- to re-run: always recomputes to the same correct value).
update public.conversations c
set participant_count = (
  select count(*) from public.conversation_participants cp
  where cp.conversation_id = c.id and cp.state in ('inside', 'grace')
);

-- ---------------------------------------------------------------------------
-- Avatar icon selection - re-validates the level requirement server-side so
-- a client can't grant itself a locked icon by calling rpc() directly with
-- an arbitrary string.
--
-- p_required_level is passed by the client (which already has the
-- authoritative icon->level catalog in src/services/avatarIcons.ts) rather
-- than re-hardcoding a second copy of that mapping here as an emoji string
-- CASE match - that duplicated, fragile version is exactly what silently
-- broke every selection (confirmed live: a real level-1 user picking a
-- level-1 icon still got blocked with no error, because the emoji literal
-- the client sent apparently didn't byte-for-byte match one typed into this
-- file - emoji have more than one valid encoding). The level check itself
-- still fully enforces the unlock rule; only the icon<->level lookup moved
-- client-side. Icons are purely cosmetic/self-expression with no trust
-- implications, so trusting the client's claimed tier for a value it
-- already computed from the same catalog the UI renders is an acceptable
-- trade against a second hardcoded, drift-prone copy of that table in SQL.
-- ---------------------------------------------------------------------------
-- A function's identity in Postgres includes its parameter types, so adding
-- p_required_level makes this a distinct overload rather than replacing the
-- old (p_icon text) version - drop that one explicitly so only one exists.
drop function if exists public.update_avatar_icon(text);

create or replace function public.update_avatar_icon(p_icon text, p_required_level int)
returns public.users
language plpgsql
security definer
as $$
declare
  v_user public.users;
begin
  select * into v_user from public.users where auth_id = auth.uid();
  if v_user.level < p_required_level then
    return v_user;
  end if;
  update public.users set avatar_icon = p_icon where id = v_user.id returning * into v_user;
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: supabaseBackend.ts's subscribeToMap/subscribeToConversation/
-- subscribeToThread subscribe to postgres_changes on these three tables.
-- Supabase's `supabase_realtime` publication starts empty - a table not
-- added to it never fires change events (no error, subscriptions just stay
-- silent forever), so this is required, not optional. Guarded via
-- pg_publication_tables rather than an exception catch, since re-adding an
-- already-member table's error class isn't one I want to guess at.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'threads'
  ) then
    alter publication supabase_realtime add table public.threads;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled activity recompute + expiration sweep (pg_cron).
-- The heavy lifting (score formula, lifecycle transitions) lives in the
-- recomputeActivity Edge Function for testability; this just invokes it on
-- a schedule via pg_net or Supabase's cron-to-function trigger.
--
-- cron.schedule() itself is idempotent by job name (re-running replaces the
-- existing job rather than erroring), so no extra guard needed here -
-- just fill in your real project ref and service-role key before running.
-- ---------------------------------------------------------------------------
-- select cron.schedule('recompute-activity', '*/1 * * * *', $$
--   select net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/recomputeActivity',
--     headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
--   );
-- $$);

-- ---------------------------------------------------------------------------
-- Admin dashboard (web/admin) - moderator role + read surface.
-- ---------------------------------------------------------------------------

-- Two values only - promotion is manual SQL for v1 (no self-serve invite
-- UI), so there's no meaningful distinction yet between "the owner" and "a
-- moderator someone else promoted." Add a third value later only if tiered
-- admin permissions become a real need.
do $$ begin
  create type user_role as enum ('user', 'moderator');
exception when duplicate_object then null;
end $$;
alter table public.users add column if not exists role user_role not null default 'user';

-- Promotion, v1: no RPC, no UI - run directly against the project once you
-- have the account's auth_id:
--   update public.users set role = 'moderator' where auth_id = '<uuid>';

-- moderation_actions never had RLS enabled - same class of gap `reports`
-- had before it was fixed above, except this one was live and unfixed: an
-- append-only moderator audit log (who took what action against whom) was
-- readable/writable by any authenticated client via PostgREST default
-- grants. Zero client policies, same "service role/SECURITY DEFINER only"
-- treatment as push_tokens - written only by the moderationAction Edge
-- Function (service role), read only via the admin RPCs below.
alter table public.moderation_actions enable row level security;

create or replace function public.is_moderator() returns boolean
language sql stable
security definer
as $$
  select exists (
    select 1 from public.users
    where auth_id = auth.uid() and role = 'moderator' and not is_deleted
  );
$$;

create or replace function public.admin_list_reports(p_status report_status default 'open')
returns setof public.reports
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query select * from public.reports where status = p_status order by created_at desc;
end;
$$;

create or replace function public.admin_stats()
returns table (
  total_users bigint,
  total_conversations bigint,
  active_conversations bigint,
  total_messages bigint,
  messages_last_24h bigint,
  new_users_last_7d bigint
)
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query select
    (select count(*) from public.users where not is_deleted),
    (select count(*) from public.conversations where status <> 'deleted'),
    (select count(*) from public.conversations where status = 'active'),
    (select count(*) from public.messages where deleted_at is null),
    (select count(*) from public.messages where created_at > now() - interval '24 hours' and deleted_at is null),
    (select count(*) from public.users where created_at > now() - interval '7 days' and not is_deleted);
end;
$$;

-- A user report (filed from the profile card) previously carried no
-- message content at all, unlike a message report - the dashboard could
-- only show a username and a freeform reason string, no actual evidence.
-- The profile card is only ever opened by tapping a specific message's
-- author row though (see MessageBubble.tsx#onOpenProfile), so the message
-- that prompted the report is always known client-side at the moment of
-- reporting - this just gives it somewhere to go. Nullable: not every
-- future report-a-user path is guaranteed to originate from a message.
-- `on delete set null` rather than cascade/restrict - conversations (and
-- their messages) get hard-deleted on the retention sweep a few days after
-- going quiet, and a report's own audit trail should survive that even if
-- the message it referenced doesn't.
alter table public.reports add column if not exists context_message_id uuid references public.messages(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Autonomous AI report triage. Reports still get saved immediately and never
-- block the reporter's UI - a trigger below dispatches an async analysis job
-- the same way notify_new_message already dispatches pushes, and every
-- write happens on a moderation_cases row so a burst of reports against one
-- target (the "37 stadium reports on one message" case) reuses a single
-- analysis instead of running one per report.
-- ---------------------------------------------------------------------------

do $$ begin
  create type moderation_priority as enum ('P0', 'P1', 'P2', 'P3');
exception when duplicate_object then null;
end $$;

do $$ begin
  -- Declaration order is Postgres's default sort order for an enum column -
  -- 'critical' first so `order by severity` alone puts the worst cases on
  -- top without a CASE expression anywhere.
  create type moderation_severity as enum ('critical', 'high', 'medium', 'low');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ai_processing_status as enum (
    'pending', 'moderation_check_complete', 'context_analysis_pending',
    'analysis_complete', 'analysis_failed', 'deferred_budget_limit'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ai_call_type as enum ('moderation_check', 'contextual_analysis');
exception when duplicate_object then null;
end $$;

-- Single source of truth for the two cost limits - both analyzeReport (a
-- direct service-role read) and the web dashboard's budget banner
-- (admin_moderation_config() below) read from here, rather than each
-- keeping its own copy that could silently drift out of sync with the
-- other (the dashboard would then show a different "% of budget used" than
-- what analyzeReport is actually enforcing).
create table if not exists public.moderation_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.moderation_config (key, value) values
  ('AI_DAILY_COST_LIMIT_USD', '2.00'),
  ('AI_MONTHLY_COST_LIMIT_USD', '20.00')
on conflict (key) do nothing; -- seed only if unset - re-running this file must never reset a value someone deliberately changed
alter table public.moderation_config enable row level security; -- zero client policies, service-role/RPC only

-- The primary object for triage/resolution - individual `reports` rows link
-- to one of these via moderation_case_id below, and everything (AI
-- analysis, the admin queue, Uphold/Dismiss) operates on the case, not the
-- individual report.
create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  target_type report_target_type not null,
  target_id uuid not null,
  -- Resolved once at case creation: target_id itself for a user report,
  -- messages.user_id for a message report, conversations.created_by for a
  -- conversation report.
  reported_user_id uuid references public.users(id),
  -- Captured at creation time, not read lazily - conversations/messages get
  -- hard-deleted by the retention sweep a few days after going quiet, and a
  -- case can easily still be open for human review well past that. Without
  -- this a moderator reviewing an older case would have nothing to look at.
  reported_content_snapshot text,
  report_count integer not null default 1,
  first_reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  status report_status not null default 'open', -- reuses reports' own open/upheld/dismissed enum rather than inventing a parallel one
  priority moderation_priority not null default 'P2',
  severity moderation_severity,
  confidence numeric(5,4),
  -- Plain text, deliberately not enums - an enum would need `alter type ...
  -- add value` (can't run inside the same transaction as other DDL) every
  -- time OpenAI's own moderation taxonomy or this app's action vocabulary
  -- grows, which breaks the idempotent-full-re-run model this file depends
  -- on. Validated in the Edge Function, not the database.
  violation_category text,
  recommended_action text,
  requires_human_review boolean not null default true, -- true until AI says otherwise, so a case is never silently invisible before/if analysis ever completes
  ai_recommended_dismissal boolean not null default false,
  ai_status ai_processing_status not null default 'pending',
  ai_model_moderation text,
  ai_model_contextual text,
  ai_raw_response jsonb, -- full contextual-pass response, kept for audit
  ai_analyzed_at timestamptz,
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now()
);
-- At most one OPEN case per target - what makes dedup atomic (see the
-- trigger below). A later new report against a target whose prior case
-- already resolved starts a fresh case rather than reopening a closed one.
create unique index if not exists moderation_cases_open_target_unique_idx
  on public.moderation_cases(target_type, target_id) where status = 'open';
create index if not exists moderation_cases_status_priority_idx
  on public.moderation_cases(status, priority, severity, report_count desc, confidence desc, first_reported_at);
create index if not exists moderation_cases_reported_user_idx
  on public.moderation_cases(reported_user_id) where reported_user_id is not null;
alter table public.moderation_cases enable row level security; -- zero client policies, same "service-role/RPC only" treatment as moderation_actions

alter table public.reports add column if not exists moderation_case_id uuid references public.moderation_cases(id) on delete set null;
create index if not exists reports_moderation_case_id_idx on public.reports(moderation_case_id);

-- Per-call cost/token log, one row per OpenAI request (including the free
-- moderation-endpoint pass, logged at $0 for a complete usage trail). What
-- the circuit breaker in analyzeReport sums against moderation_config's
-- limits, and what the dashboard's cost-summary section reads.
create table if not exists public.ai_moderation_usage_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.moderation_cases(id) on delete set null,
  call_type ai_call_type not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_created_at_idx on public.ai_moderation_usage_log(created_at);
alter table public.ai_moderation_usage_log enable row level security; -- zero client policies, service-role/RPC only

-- Dedup + dispatch. AFTER INSERT (not BEFORE, unlike the rate limit trigger
-- below) since it needs the fully-resolved new.id to link back to; entire
-- body exception-wrapped exactly like notify_new_message - a failure
-- anywhere in here must never roll back or block the report insert itself.
create or replace function public.link_report_to_moderation_case() returns trigger
language plpgsql
security definer
as $$
declare
  v_case_id uuid;
  v_is_new boolean := false;
  v_reported_user_id uuid;
  v_snapshot text;
  v_service_key text;
begin
  begin
    -- Standard find-or-create-under-a-unique-index retry loop - guards a
    -- real (if rare at this app's scale) race: two reports against a
    -- brand-new target landing in the same instant could both see "no open
    -- case yet" and both try to INSERT, tripping the partial unique index
    -- above on whichever commits second. Loop back and UPDATE instead of
    -- surfacing the error.
    loop
      update public.moderation_cases set
        report_count = report_count + 1,
        last_reported_at = now(),
        priority = case
          when priority = 'P3' and report_count + 1 >= 5 then 'P2'
          when priority in ('P2', 'P3') and report_count + 1 >= 15 then 'P1'
          else priority
        end
      where target_type = new.target_type and target_id = new.target_id and status = 'open'
      returning id into v_case_id;
      exit when found;

      if new.target_type = 'message' then
        select m.user_id, (m.username || ': "' || m.body || '"')
          into v_reported_user_id, v_snapshot
          from public.messages m where m.id = new.target_id;
      elsif new.target_type = 'user' then
        v_reported_user_id := new.target_id;
        select 'User: ' || u.username into v_snapshot from public.users u where u.id = new.target_id;
      else
        select c.created_by, 'Conversation: ' || c.title into v_reported_user_id, v_snapshot
          from public.conversations c where c.id = new.target_id;
      end if;

      begin
        insert into public.moderation_cases
          (target_type, target_id, reported_user_id, reported_content_snapshot, report_count)
        values (new.target_type, new.target_id, v_reported_user_id, v_snapshot, 1)
        returning id into v_case_id;
        v_is_new := true;
        exit;
      exception when unique_violation then
        -- Lost the race - loop back and UPDATE the row the other
        -- transaction just committed.
      end;
    end loop;

    update public.reports set moderation_case_id = v_case_id where id = new.id;

    if v_is_new then
      -- Same Vault secret notify_new_message already uses - one service-
      -- role key for every trigger-dispatched async call in this file.
      select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'notify_new_message_service_key';

      perform net.http_post(
        url := 'https://fuhdxvyqahwmikpgiikk.functions.supabase.co/analyzeReport',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
        body := jsonb_build_object('caseId', v_case_id)
      );
    end if;
  exception when others then
    raise warning 'link_report_to_moderation_case failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_link_report_to_moderation_case on public.reports;
create trigger trg_link_report_to_moderation_case
  after insert on public.reports
  for each row execute function public.link_report_to_moderation_case();

-- Reports can be abused same as messages can - mirrors
-- enforce_message_rate_limit's exact shape. Named to sort ("enforce_" <
-- "link_") before the case-linking trigger above, so a rate-limited report
-- never reaches it.
create or replace function public.enforce_report_rate_limit() returns trigger
language plpgsql as $$
declare
  v_recent_count integer;
  v_oldest_in_window timestamptz;
  v_wait_seconds integer;
begin
  select count(*) into v_recent_count
  from public.reports
  where reporter_id = new.reporter_id and created_at > now() - interval '10 minutes';

  if v_recent_count >= 10 then
    select created_at into v_oldest_in_window
    from public.reports
    where reporter_id = new.reporter_id and created_at > now() - interval '10 minutes'
    order by created_at asc
    limit 1;
    v_wait_seconds := greatest(1, ceil(extract(epoch from (v_oldest_in_window + interval '10 minutes' - now())))::integer);
    raise exception 'You are filing reports too quickly. Try again in % seconds.', v_wait_seconds;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_report_rate_limit on public.reports;
create trigger trg_enforce_report_rate_limit
  before insert on public.reports
  for each row execute function public.enforce_report_rate_limit();

create or replace function public.admin_list_moderation_cases(p_status report_status default 'open')
returns setof public.moderation_cases
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query
    select * from public.moderation_cases
    where status = p_status
    order by priority asc, severity asc nulls last, report_count desc, confidence desc nulls last, first_reported_at asc;
end;
$$;

create or replace function public.admin_moderation_cost_summary()
returns table (
  reports_today bigint,
  moderation_checks_today bigint,
  contextual_analyses_today bigint,
  cost_today_usd numeric,
  reports_month bigint,
  cost_month_usd numeric
)
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query select
    (select count(*) from public.reports where created_at >= current_date),
    (select count(*) from public.ai_moderation_usage_log where call_type = 'moderation_check' and created_at >= current_date),
    (select count(*) from public.ai_moderation_usage_log where call_type = 'contextual_analysis' and created_at >= current_date),
    (select coalesce(sum(estimated_cost_usd), 0) from public.ai_moderation_usage_log where created_at >= current_date),
    (select count(*) from public.reports where created_at >= date_trunc('month', now())),
    (select coalesce(sum(estimated_cost_usd), 0) from public.ai_moderation_usage_log where created_at >= date_trunc('month', now()));
end;
$$;

create or replace function public.admin_moderation_config()
returns table (daily_limit_usd numeric, monthly_limit_usd numeric)
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query select
    (select value::numeric from public.moderation_config where key = 'AI_DAILY_COST_LIMIT_USD'),
    (select value::numeric from public.moderation_config where key = 'AI_MONTHLY_COST_LIMIT_USD');
end;
$$;

-- Deferred-budget replay. Without this, a case that lands in
-- deferred_budget_limit during a cost crunch sits there forever unless a
-- moderator manually clicks "Re-run AI Analysis" - conflicts with "the
-- moderation system must never silently stop functioning." Same
-- commented-out-until-configured convention as the recompute-activity job
-- below - fill in the real project ref/service-role key and enable via the
-- SQL editor when ready. Calls analyzeReport in sweep mode ({sweep: true}
-- instead of a caseId), which reprocesses every deferred_budget_limit case
-- through the normal pipeline - harmless to re-check ones still over
-- budget, they just stay deferred.
-- select cron.schedule('replay-deferred-moderation-cases', '0 * * * *', $$
--   select net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/analyzeReport',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <service-role-key>'),
--     body := jsonb_build_object('sweep', true)
--   );
-- $$);

-- Auto-delete, separate from auto-dismiss above (still gated off by its
-- own flag): removes likely-violating message content immediately once
-- confidence clears a tiered bar (lower for high-risk categories like
-- harassment/threats, higher for lower-stakes ones like spam - see
-- AI_AUTO_DELETE_HIGH_RISK_CONFIDENCE_THRESHOLD/_LOW_RISK_ in
-- analyzeReport), but - unlike auto-dismiss - never auto-closes the case
-- above the lowest severity tier. Content comes down fast; a human still
-- makes the account-level call (suspend/ban/report to authorities).
alter table public.moderation_cases add column if not exists content_auto_removed boolean not null default false;

-- AI-driven actions have no human moderator behind them - relaxed from not
-- null so analyzeReport can log an auto-action into the same audit trail
-- moderationAction already writes every human one into, rather than
-- needing a second, parallel log just for AI actions.
alter table public.moderation_actions alter column moderator_id drop not null;
alter table public.moderation_actions add column if not exists is_ai_action boolean not null default false;

-- Confirmed live: a benign reported message ("I love strawberries!") got
-- assessed as a critical threat and auto-deleted because a genuine death
-- threat turned up in the SAME user's other, unrelated messages (fed in as
-- background context for pattern-awareness) - the model correctly saw the
-- reported content itself was harmless, but nothing stopped that
-- discovery from driving this case's own severity, and auto-delete then
-- acted on target_id (the reported message), deleting the wrong thing
-- entirely while the real threat stayed live. severity_based_on is the
-- model's own explicit signal for this ("context_only" means the elevated
-- severity came from something other than what was actually reported);
-- analyzeReport's auto-delete gate now also requires it to be
-- "reported_content" before ever acting, on top of a second, independent
-- check (the free moderation-endpoint pass run on the reported content
-- alone must also have flagged something) - defense in depth, since the
-- second check doesn't depend on the model following the prompt correctly
-- at all.
do $$ begin
  create type severity_basis as enum ('reported_content', 'context_only');
exception when duplicate_object then null;
end $$;
alter table public.moderation_cases add column if not exists severity_based_on severity_basis;

-- The model's own plain-English justification for its assessment, shown
-- directly on the admin dashboard - previously only reachable by digging
-- into ai_raw_response via SQL, which is exactly what made this bug take
-- an extra round trip to diagnose instead of being obvious from the
-- dashboard card itself.
alter table public.moderation_cases add column if not exists reasoning text;

-- ---------------------------------------------------------------------------
-- Adoption metrics. admin_stats() only ever gave point-in-time snapshot
-- counts - no trend, no history. avg_participants_per_conversation below is
-- a second point-in-time metric (like active_conversations), computed from
-- conversations.participant_count. Trends (signups/conversations/messages/
-- DAU per day) are handled separately by admin_adoption_trends() further
-- down, since those need a day-by-day breakdown rather than a single row.
-- ---------------------------------------------------------------------------

-- Adding a column to the return type isn't a CREATE OR REPLACE-compatible
-- change (Postgres rejects it as "cannot change return type of existing
-- function") - drop first since this is re-run idempotently like the rest
-- of this file.
drop function if exists public.admin_stats();

create or replace function public.admin_stats()
returns table (
  total_users bigint,
  total_conversations bigint,
  active_conversations bigint,
  total_messages bigint,
  messages_last_24h bigint,
  new_users_last_7d bigint,
  avg_participants_per_conversation numeric
)
language plpgsql
security definer
as $$
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query select
    (select count(*) from public.users where not is_deleted),
    (select count(*) from public.conversations where status <> 'deleted'),
    (select count(*) from public.conversations where status = 'active'),
    (select count(*) from public.messages where deleted_at is null),
    (select count(*) from public.messages where created_at > now() - interval '24 hours' and deleted_at is null),
    (select count(*) from public.users where created_at > now() - interval '7 days' and not is_deleted),
    (select round(avg(participant_count), 1) from public.conversations where status <> 'deleted');
end;
$$;

-- Day-by-day adoption trend, reconstructed live from existing created_at
-- timestamps - no new snapshot table needed, since signups/conversation
-- creation/messages are all immutable creation events (unlike, say,
-- conversations.status, which gets overwritten in place and so has no
-- history to look back on without a periodic snapshot job). active_users
-- is daily active users: distinct senders of a non-deleted message that
-- day, not a stored field anywhere. p_days is clamped to 180 - this is
-- moderator-only, but a bare correlated-subquery-per-day plan has no
-- reason to run against an unbounded range.
create or replace function public.admin_adoption_trends(p_days integer default 30)
returns table (
  day date,
  new_users bigint,
  new_conversations bigint,
  active_users bigint,
  messages_sent bigint
)
language plpgsql
security definer
as $$
declare
  days_back integer := least(greatest(p_days, 1), 180);
begin
  if not public.is_moderator() then
    raise exception 'not authorized';
  end if;
  return query
  with days as (
    select generate_series(current_date - (days_back - 1), current_date, interval '1 day')::date as day
  )
  select
    d.day,
    (select count(*) from public.users u where not u.is_deleted and u.created_at::date = d.day),
    (select count(*) from public.conversations c where c.status <> 'deleted' and c.created_at::date = d.day),
    (select count(distinct m.user_id) from public.messages m where m.deleted_at is null and m.created_at::date = d.day),
    (select count(*) from public.messages m where m.deleted_at is null and m.created_at::date = d.day)
  from days d
  order by d.day;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stale-participant sweep. checkEligibility (see that Edge Function) only
-- ever re-evaluates a participant's state while their own client has the
-- conversation screen open and polling every 6s - once someone closes the
-- app or walks away without reopening it, their conversation_participants
-- row just sits at whatever state ('inside'/'grace') it last had, forever.
-- Since participant_count only counts 'inside'/'grace' rows
-- (recompute_participant_count above) and activity_score is driven by
-- participant_count (recomputeActivity), a conversation everyone has
-- physically left can keep scoring as active indefinitely with nobody
-- there. Deliberately a single set-based UPDATE run on a plain pg_cron
-- schedule - no Edge Function/HTTP round trip needed, and no per-conversation
-- polling from any client - so this stays cheap at any number of concurrent
-- chats. Demotes to 'read_only' rather than deleting the row or setting
-- 'left': the client's own next real checkEligibility call (if the user
-- ever comes back) still re-evaluates their true state fresh, this is only
-- a conservative "we haven't heard from you in a while" fallback, mirroring
-- the same read_only outcome checkEligibility itself uses when a grace
-- period naturally expires.
create index if not exists conversation_participants_active_last_check_idx
  on public.conversation_participants(last_check_at)
  where state in ('inside', 'grace');

create or replace function public.sweep_stale_participants() returns void
language sql
as $$
  update public.conversation_participants
  set state = 'read_only',
      grace_started_at = null
  where state in ('inside', 'grace')
    and last_check_at < now() - interval '10 minutes';
$$;

-- Runs as the role that scheduled it (superuser in Supabase's pg_cron
-- setup), so - unlike recompute-activity's Edge Function call - this needs
-- no service-role key/Authorization header at all, nothing to misconfigure.
select cron.schedule('sweep-stale-participants', '*/5 * * * *', $$
  select public.sweep_stale_participants();
$$);

-- ---------------------------------------------------------------------------
-- Proactive moderation: every new message gets a free classification (+ a
-- free PII pattern check, done in the Edge Function - see analyzeReport's
-- new scanNewMessage()) the instant it's sent, instead of only ever being
-- looked at once someone reports it. A user report on a message this
-- already flagged just reinforces the same case - link_report_to_
-- moderation_case's own find-or-create loop already dedupes correctly
-- against the partial unique index below regardless of which path got
-- there first, so that trigger is deliberately left untouched.
-- ---------------------------------------------------------------------------

-- Separate, standalone find-or-create for the scan path - deliberately NOT
-- refactored to share code with link_report_to_moderation_case's own
-- inline loop above. That trigger is live and already tested; correctness
-- here comes from the partial unique index both rely on, not from sharing
-- code, so a little duplicated retry-loop SQL is a safer tradeoff than
-- touching an already-working critical path.
create or replace function public.find_or_create_moderation_case_for_scan(
  p_target_type report_target_type,
  p_target_id uuid
) returns table (case_id uuid, is_new boolean)
language plpgsql
security definer
as $$
declare
  v_case_id uuid;
  v_is_new boolean := false;
  v_reported_user_id uuid;
  v_snapshot text;
begin
  loop
    select id into v_case_id from public.moderation_cases
      where target_type = p_target_type and target_id = p_target_id and status = 'open';
    exit when found;

    if p_target_type = 'message' then
      select m.user_id, (m.username || ': "' || m.body || '"')
        into v_reported_user_id, v_snapshot
        from public.messages m where m.id = p_target_id;
    elsif p_target_type = 'user' then
      v_reported_user_id := p_target_id;
      select 'User: ' || u.username into v_snapshot from public.users u where u.id = p_target_id;
    else
      select c.created_by, 'Conversation: ' || c.title into v_reported_user_id, v_snapshot
        from public.conversations c where c.id = p_target_id;
    end if;

    begin
      insert into public.moderation_cases
        (target_type, target_id, reported_user_id, reported_content_snapshot, report_count)
      values (p_target_type, p_target_id, v_reported_user_id, v_snapshot, 0)
      returning id into v_case_id;
      v_is_new := true;
      exit;
    exception when unique_violation then
      -- Lost the race (or a report beat the scan to it) - loop back and
      -- pick up whichever case just got committed.
    end;
  end loop;

  return query select v_case_id, v_is_new;
end;
$$;
revoke execute on function public.find_or_create_moderation_case_for_scan from public, anon, authenticated;
grant execute on function public.find_or_create_moderation_case_for_scan to service_role;

-- Same async-dispatch shape as notify_new_message above: AFTER INSERT,
-- SECURITY DEFINER, entire body exception-wrapped so a failure here can
-- never block a message send, same Vault-stored service-role key. Points
-- at analyzeReport's new {messageId} mode instead of notifyNewMessage.
create or replace function public.scan_new_message() returns trigger
language plpgsql
security definer
as $$
declare
  v_service_key text;
begin
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets
    where name = 'notify_new_message_service_key';

    perform net.http_post(
      url := 'https://fuhdxvyqahwmikpgiikk.functions.supabase.co/analyzeReport',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object('messageId', new.id)
    );
  exception when others then
    raise warning 'scan_new_message failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_scan_new_message on public.messages;
create trigger trg_scan_new_message
  after insert on public.messages
  for each row execute function public.scan_new_message();
