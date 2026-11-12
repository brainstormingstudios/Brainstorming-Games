-- 0006_leaderboards_saves: play sessions, validated scores, cloud saves.

-- A play session is issued by the server when a game starts. A score is only accepted against
-- a session that belongs to the caller and to that game, and the session's age bounds how high
-- the score can plausibly be.
create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  anon_id uuid,
  game_id uuid not null references public.games (id) on delete cascade,
  version_id uuid references public.game_versions (id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index play_sessions_user_idx on public.play_sessions (user_id, started_at desc);

create table public.leaderboards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_-]{1,32}$'),
  title text not null default '',
  sort_desc boolean not null default true,
  max_score double precision,
  max_score_per_sec double precision,
  created_at timestamptz not null default now(),
  unique (game_id, key)
);

create table public.scores (
  id bigint generated always as identity primary key,
  leaderboard_id uuid not null references public.leaderboards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score double precision not null,
  session_id uuid references public.play_sessions (id) on delete set null,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index scores_board_idx on public.scores (leaderboard_id, score desc);
create index scores_user_idx on public.scores (user_id, leaderboard_id);

create table public.cloud_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, key),
  -- 1 MB per value.
  check (pg_column_size(value) <= 1048576)
);

alter table public.play_sessions enable row level security;
alter table public.leaderboards enable row level security;
alter table public.scores enable row level security;
alter table public.cloud_saves enable row level security;

create policy sessions_select on public.play_sessions for select using (user_id = auth.uid());
create policy leaderboards_select on public.leaderboards for select using (true);
create policy leaderboards_manage on public.leaderboards for all using (app.owns_game(game_id) or app.is_staff())
  with check (app.owns_game(game_id) or app.is_staff());
create policy scores_select_staff on public.scores for select using (user_id = auth.uid() or app.is_staff());
create policy cloud_saves_all on public.cloud_saves for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.start_play_session(p_game_id uuid, p_version_id uuid, p_anon_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.guard('play_session', app.caller_key(p_anon_id), 60, 600);
  if not exists (select 1 from public.games where id = p_game_id) then perform app.fail('not_found'); end if;
  insert into public.play_sessions (user_id, anon_id, game_id, version_id)
  values (auth.uid(), p_anon_id, p_game_id, p_version_id) returning id into v_id;
  return v_id;
end $$;

/**
 * Validated score submission.
 *   - the caller must be signed in, not banned;
 *   - the session must be theirs, for this game, and less than 12 hours old;
 *   - at most one submission every 5 seconds (burst 3);
 *   - the score may not exceed the board's hard cap, nor the board's (or game's) declared maximum
 *     rate multiplied by the session's age. Scores close to that bound are kept but flagged.
 */
create or replace function public.submit_score(p_game_id uuid, p_board text, p_score double precision, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.leaderboards;
  s public.play_sessions;
  v_elapsed double precision;
  v_rate double precision;
  v_limit double precision;
  v_flag boolean := false;
  v_best double precision;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then perform app.fail('not_allowed'); end if;
  if p_score is null or p_score <> p_score or abs(p_score) > 1e15 then perform app.fail('invalid'); end if;
  if not app.take_token('score:' || auth.uid()::text, 3, 15) then perform app.fail('rate_limited'); end if;

  select * into s from public.play_sessions where id = p_session_id;
  if s.id is null or s.user_id is distinct from auth.uid() or s.game_id <> p_game_id
     or s.started_at < now() - interval '12 hours' then
    perform app.fail('invalid');
  end if;

  select * into b from public.leaderboards where game_id = p_game_id and key = p_board;
  if b.id is null then
    -- Boards are created on first use for games that use the SDK.
    if not exists (select 1 from public.games g where g.id = p_game_id and g.status in ('spark', 'rise', 'featured')) then
      perform app.fail('not_found');
    end if;
    insert into public.leaderboards (game_id, key, title) values (p_game_id, p_board, p_board)
    on conflict (game_id, key) do update set key = excluded.key returning * into b;
  end if;

  v_elapsed := greatest(extract(epoch from (now() - s.started_at)), 1);
  select coalesce(b.max_score_per_sec, g.max_score_per_sec) into v_rate from public.games g where g.id = p_game_id;
  if b.max_score is not null and p_score > b.max_score then perform app.fail('invalid'); end if;
  if v_rate is not null then
    v_limit := v_rate * v_elapsed;
    if p_score > v_limit then perform app.fail('invalid'); end if;
    v_flag := p_score > v_limit * 0.9;
  end if;
  -- Outliers: far above the current best is suspicious even without a declared rate.
  select max(score) into v_best from public.scores where leaderboard_id = b.id and not flagged;
  if v_best is not null and v_best > 0 and p_score > v_best * 10 then v_flag := true; end if;

  insert into public.scores (leaderboard_id, user_id, score, session_id, flagged)
  values (b.id, auth.uid(), p_score, p_session_id, v_flag);
  update public.play_sessions set last_seen_at = now() where id = p_session_id;
  return jsonb_build_object('accepted', true, 'flagged', v_flag);
end $$;

/**
 * Top of a board: each player's best score, weekly or all-time, optionally friends only.
 * Players who may not appear by name (minors without consent, private profiles) show an alias.
 */
create or replace function public.leaderboard_top(
  p_game_id uuid, p_board text, p_period text default 'all', p_friends boolean default false, p_limit int default 10
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.leaderboards; v_since timestamptz; v_result jsonb;
begin
  select * into b from public.leaderboards where game_id = p_game_id and key = p_board;
  if b.id is null then return jsonb_build_object('entries', '[]'::jsonb, 'me', null); end if;
  v_since := case when p_period = 'week' then date_trunc('week', now()) else '-infinity'::timestamptz end;
  with best as (
    select s.user_id,
      case when b.sort_desc then max(s.score) else min(s.score) end as score
    from public.scores s
    where s.leaderboard_id = b.id and not s.flagged and s.created_at >= v_since
      and (not p_friends or s.user_id = auth.uid() or app.are_friends(auth.uid(), s.user_id))
    group by s.user_id
  ),
  ranked as (
    select best.*, rank() over (order by case when b.sort_desc then -score else score end) as rank from best
  ),
  named as (
    select r.rank, r.score, r.user_id = auth.uid() as is_me,
      case when p.profile_public and (not p.is_minor or p.parental_consent_status = 'granted')
        then p.username else 'Player#' || upper(substr(md5(p.id::text), 1, 4)) end as name,
      case when p.profile_public and (not p.is_minor or p.parental_consent_status = 'granted')
        then p.avatar_cosmetics else '{}'::jsonb end as cosmetics
    from ranked r join public.profiles p on p.id = r.user_id where p.banned_at is null
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(n) order by n.rank) from (select * from named order by rank limit least(greatest(p_limit, 1), 100)) n), '[]'::jsonb),
    'me', (select to_jsonb(n) from named n where n.is_me limit 1)
  ) into v_result;
  return v_result;
end $$;

/** The global Brain Points board: points earned this week, or all time. */
create or replace function public.points_top(p_period text default 'all', p_friends boolean default false, p_limit int default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  with totals as (
    select l.user_id, sum(l.delta) as points
    from public.brain_point_ledger l
    where l.delta > 0
      and l.created_at >= case when p_period = 'week' then date_trunc('week', now()) else '-infinity'::timestamptz end
      and (not p_friends or l.user_id = auth.uid() or app.are_friends(auth.uid(), l.user_id))
    group by l.user_id
  ),
  ranked as (
    select t.*, rank() over (order by t.points desc) as rank from totals t
  ),
  named as (
    select r.rank, r.points, r.user_id = auth.uid() as is_me, p.username as name, p.avatar_cosmetics as cosmetics, p.level
    from ranked r join public.public_profiles p on p.id = r.user_id
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(n) order by n.rank) from (select * from named order by rank limit least(greatest(p_limit, 1), 100)) n), '[]'::jsonb),
    'me', (select to_jsonb(n) from named n where n.is_me limit 1));
$$;

/** Staff view of flagged scores, and the action to clear or delete one. */
create or replace function public.admin_review_score(p_score_id bigint, p_keep boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if p_keep then update public.scores set flagged = false where id = p_score_id;
  else delete from public.scores where id = p_score_id; end if;
  perform app.audit('review_score', 'score', p_score_id::text, jsonb_build_object('keep', p_keep));
end $$;
