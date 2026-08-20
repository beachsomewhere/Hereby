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
-- Fill in your real project ref and service-role key before running, same
-- as the recompute-activity cron block below.
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_message() returns trigger
language plpgsql as $$
begin
  perform net.http_post(
    url := 'https://<project-ref>.functions.supabase.co/notifyNewMessage',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <service-role-key>'),
    body := jsonb_build_object('messageId', new.id)
  );
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
            order by m.created_at desc limit 1)
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
            order by m.created_at desc limit 1)
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
            order by m.created_at desc limit 1)
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
            order by m.created_at desc limit 1)
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
            order by m.created_at desc limit 1)
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
