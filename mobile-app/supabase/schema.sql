-- Nearby - MVP schema (Postgres + PostGIS, Supabase)
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

create extension if not exists postgis;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid not null references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_seed text not null,
  level integer not null default 1,
  helpful_points integer not null default 0,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create index users_auth_id_idx on public.users(auth_id);

-- Private. No select policy grants this to authenticated users - only
-- service-role Edge Functions read/write it. Never returned to any client.
create table public.user_trust_scores (
  user_id uuid primary key references public.users(id) on delete cascade,
  trust_score numeric not null default 50,
  signals jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  icon text not null
);

create table public.user_badges (
  user_id uuid not null references public.users(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- Venues / POIs - seed data used both for cold-start shells and for
-- snapping newly created conversations to a recognizable place.
-- ---------------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null, -- 'airport_terminal', 'stadium', 'convention_center', ...
  location geography(point, 4326) not null,
  metadata jsonb not null default '{}'::jsonb
);
create index venues_location_gix on public.venues using gist (location);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create type conversation_category as enum ('micro_location', 'venue', 'area', 'corridor');
create type conversation_status as enum ('new', 'active', 'cooling_down', 'archived', 'deleted');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category conversation_category not null,
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
create index conversations_location_gix on public.conversations using gist (location);
create index conversations_status_idx on public.conversations(status);
create index conversations_expires_at_idx on public.conversations(expires_at);

create table public.conversation_participants (
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
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  is_general boolean not null default false,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index threads_conversation_id_idx on public.threads(conversation_id);
-- Exactly one General thread per conversation.
create unique index threads_one_general_per_conversation_idx
  on public.threads(conversation_id)
  where is_general;

-- ---------------------------------------------------------------------------
-- Messages, reactions, confirmations
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.users(id),
  -- Snapshot of users.level at send time (see recomputeReputation) - like
  -- username, not live-updating; a user leveling up doesn't relabel their
  -- older messages.
  author_level integer not null default 1,
  body text not null check (char_length(body) <= 2000),
  reply_to_id uuid references public.messages(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  flagged boolean not null default false
);
create index messages_thread_id_idx on public.messages(thread_id, created_at);
create index messages_conversation_id_idx on public.messages(conversation_id, created_at);

create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, type)
);

-- Reddit-style up/down vote on a message - never reorders anything, only
-- feeds the author's users.helpful_points / level (see
-- mockBackend.ts#voteMessage for the mirrored logic).
create type confirmation_type as enum ('upvote', 'downvote');

create table public.confirmations (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type confirmation_type not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Reports, blocks, moderation
-- ---------------------------------------------------------------------------
create type report_target_type as enum ('message', 'user', 'conversation');
create type report_status as enum ('open', 'upheld', 'dismissed');

create table public.reports (
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
create index reports_status_idx on public.reports(status);

create table public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Append-only audit log for every moderator action, backing the appeals flow.
create table public.moderation_actions (
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
alter table public.conversation_participants enable row level security;
alter table public.user_trust_scores enable row level security; -- no policies -> service role only

create policy "conversations are readable within discovery radius"
  on public.conversations for select
  using (status not in ('archived', 'deleted'));
  -- Discovery-radius filtering happens in the query (ST_DWithin against the
  -- caller's location), not in the policy itself, since RLS can't easily
  -- see a request-time coordinate. See getVisibleConversations in the
  -- client, mirrored server-side by a SECURITY DEFINER function.

create policy "threads are readable by anyone who can read the conversation"
  on public.threads for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = threads.conversation_id and c.status not in ('archived', 'deleted')
    )
  );

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

create policy "messages are readable by anyone who can read the conversation"
  on public.messages for select
  using (deleted_at is null);

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
    -- participant's prior state and category-specific grace window (see
    -- Phase 1 doc section 9); this function only answers "inside or not."
    v_state := 'outside';
  end if;

  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled activity recompute + expiration sweep (pg_cron).
-- The heavy lifting (score formula, lifecycle transitions) lives in the
-- recomputeActivity Edge Function for testability; this just invokes it on
-- a schedule via pg_net or Supabase's cron-to-function trigger.
-- ---------------------------------------------------------------------------
-- select cron.schedule('recompute-activity', '*/1 * * * *', $$
--   select net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/recomputeActivity',
--     headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
--   );
-- $$);
