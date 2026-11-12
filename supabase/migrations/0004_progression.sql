-- 0004_progression: signup, Brain Points, levels, streaks, quests, cosmetics.
--
-- Brain Points are earned by playing. They are never bought, sold or traded, and the ledger is
-- append-only: profiles.brain_points is always the sum of a user's ledger rows.

create table public.brain_point_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null,
  reason text not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now()
);
create index ledger_user_idx on public.brain_point_ledger (user_id, created_at desc);
create unique index ledger_once_idx on public.brain_point_ledger (user_id, reason, ref_type, ref_id)
  where ref_id is not null;

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  period text not null check (period in ('daily', 'weekly')),
  title jsonb not null,
  description jsonb not null default '{}'::jsonb,
  rule jsonb not null,
  target int not null check (target > 0),
  reward_points int not null check (reward_points between 1 and 1000),
  active boolean not null default true,
  sort int not null default 0
);

create table public.quest_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_id uuid not null references public.quests (id) on delete cascade,
  period_start date not null,
  progress int not null default 0,
  completed_at timestamptz,
  primary key (user_id, quest_id, period_start)
);

create table public.cosmetics (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('colour', 'hat', 'glasses', 'headphones', 'glow', 'frame')),
  code text not null,
  name jsonb not null,
  cost_points int not null default 0 check (cost_points >= 0),
  min_level int not null default 1,
  active boolean not null default true,
  sort int not null default 0,
  unique (slot, code)
);

create table public.user_cosmetics (
  user_id uuid not null references auth.users (id) on delete cascade,
  cosmetic_id uuid not null references public.cosmetics (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.brain_point_ledger enable row level security;
alter table public.quests enable row level security;
alter table public.quest_progress enable row level security;
alter table public.cosmetics enable row level security;
alter table public.user_cosmetics enable row level security;

create policy ledger_select on public.brain_point_ledger for select using (user_id = auth.uid() or app.is_staff());
create policy quests_select on public.quests for select using (active or app.is_staff());
create policy quests_admin on public.quests for all using (app.is_staff()) with check (app.is_staff());
create policy quest_progress_select on public.quest_progress for select using (user_id = auth.uid());
create policy cosmetics_select on public.cosmetics for select using (active or app.is_staff());
create policy cosmetics_admin on public.cosmetics for all using (app.is_staff()) with check (app.is_staff());
create policy user_cosmetics_select on public.user_cosmetics for select using (user_id = auth.uid());

/** Level from lifetime points: 50 points for level 2, 200 for level 3, 450 for level 4 ... */
create or replace function app.level_for(p_points int) returns int
language sql immutable as $$
  select floor(sqrt(greatest(p_points, 0) / 50.0))::int + 1;
$$;

/** The only way points change. `p_ref_*` makes an award idempotent (one award per reference). */
create or replace function app.award_points(p_user uuid, p_delta int, p_reason text, p_ref_type text default null, p_ref_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_lifetime int;
begin
  begin
    insert into public.brain_point_ledger (user_id, delta, reason, ref_type, ref_id)
    values (p_user, p_delta, p_reason, p_ref_type, p_ref_id);
  exception when unique_violation then
    return false;
  end;
  select coalesce(sum(delta) filter (where delta > 0), 0) into v_lifetime
  from public.brain_point_ledger where user_id = p_user;
  update public.profiles set
    brain_points = greatest(0, brain_points + p_delta),
    level = app.level_for(v_lifetime)
  where id = p_user;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Signup with the age gate
-- ---------------------------------------------------------------------------------------------
/**
 * Creates the caller's profile. Only a birth year is collected. Anyone who could still be 17
 * this year (year difference of 18 or less) is treated as a minor and starts with parental
 * consent pending; they keep guest-level features until a parent approves.
 */
create or replace function public.complete_signup(p_username text, p_birth_year int, p_locale text default 'en')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_minor boolean;
  v_year int := extract(year from now())::int;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_birth_year is null or p_birth_year < 1900 or p_birth_year > v_year then perform app.fail('invalid'); end if;
  if lower(p_username) !~ '^[a-z0-9_]{3,20}$' then perform app.fail('invalid'); end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then perform app.fail('conflict'); end if;
  v_minor := (v_year - p_birth_year) <= 18;
  begin
    insert into public.profiles (id, username, birth_year, is_minor, parental_consent_status, locale)
    values (auth.uid(), lower(p_username), p_birth_year, v_minor,
            case when v_minor then 'pending'::public.consent_status else 'not_required'::public.consent_status end,
            case when p_locale ~ '^[a-z]{2}$' then p_locale else 'en' end);
  exception when unique_violation then
    perform app.fail('conflict');
  end;
  -- Everyone starts with the default look.
  insert into public.user_cosmetics (user_id, cosmetic_id)
  select auth.uid(), c.id from public.cosmetics c where c.cost_points = 0 and c.min_level <= 1
  on conflict do nothing;
  return jsonb_build_object('is_minor', v_minor);
end $$;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(p_username) ~ '^[a-z0-9_]{3,20}$'
    and not exists (select 1 from public.profiles where username = lower(p_username));
$$;

-- ---------------------------------------------------------------------------------------------
-- Quests
-- ---------------------------------------------------------------------------------------------
create or replace function app.period_start(p_period text, p_now timestamptz default now()) returns date
language sql stable as $$
  select case when p_period = 'weekly' then date_trunc('week', p_now at time zone 'UTC')::date
    else (p_now at time zone 'UTC')::date end;
$$;

/** Today's 3 daily and this week's 5 weekly quests. The pick rotates but is the same for all. */
create or replace function app.active_quests(p_now timestamptz default now())
returns setof public.quests language sql stable security definer set search_path = '' as $$
  (select q.* from public.quests q where q.active and q.period = 'daily'
   order by md5(q.code || app.period_start('daily', p_now)::text) limit 3)
  union all
  (select q.* from public.quests q where q.active and q.period = 'weekly'
   order by md5(q.code || app.period_start('weekly', p_now)::text) limit 5);
$$;

/** Recomputes a user's quest progress from their events. Idempotent; awards points once. */
create or replace function app.refresh_quests(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.quests;
  v_start date;
  v_from timestamptz;
  v_kind text;
  v_value int;
  v_done boolean;
begin
  for q in select * from app.active_quests() loop
    v_start := app.period_start(q.period);
    v_from := v_start::timestamptz;
    v_kind := q.rule ->> 'kind';
    v_value := null;
    if v_kind = 'play_distinct' then
      select count(distinct e.game_id) into v_value
      from public.events e join public.games g on g.id = e.game_id
      where e.user_id = p_user and e.type = 'play_click' and e.ts >= v_from
        and (q.rule ->> 'category' is null or g.category = q.rule ->> 'category');
    elsif v_kind = 'play_new' then
      select count(distinct e.game_id) into v_value
      from public.events e join public.games g on g.id = e.game_id
      where e.user_id = p_user and e.type = 'play_click' and e.ts >= v_from
        and g.released_at > now() - make_interval(days => coalesce((q.rule ->> 'days')::int, 7));
    elsif v_kind = 'play_multiplayer' then
      select count(distinct e.game_id) into v_value
      from public.events e join public.games g on g.id = e.game_id
      where e.user_id = p_user and e.type = 'play_click' and e.ts >= v_from and g.is_multiplayer;
    elsif v_kind = 'play_minutes' then
      select coalesce(floor(sum(s.seconds) / 60), 0)::int into v_value from (
        select max(coalesce((e.payload ->> 't')::numeric, 0)) as seconds
        from public.events e
        where e.user_id = p_user and e.ts >= v_from and e.session_id is not null
        group by e.session_id
      ) s;
    elsif v_kind = 'play_sessions' then
      select count(*) into v_value from public.events e
      where e.user_id = p_user and e.type = 'play_click' and e.ts >= v_from;
    elsif v_kind = 'rate' then
      select count(*) into v_value from public.ratings r where r.user_id = p_user and r.created_at >= v_from;
    elsif v_kind = 'favourite' then
      select count(*) into v_value from public.favorites f where f.user_id = p_user and f.created_at >= v_from;
    end if;
    -- `custom` quests are advanced by track_quest_event(), not recomputed here.
    if v_value is null then continue; end if;

    insert into public.quest_progress as qp (user_id, quest_id, period_start, progress)
    values (p_user, q.id, v_start, least(v_value, q.target))
    on conflict (user_id, quest_id, period_start) do update set progress = greatest(qp.progress, excluded.progress);

    update public.quest_progress set completed_at = now()
    where user_id = p_user and quest_id = q.id and period_start = v_start
      and completed_at is null and progress >= q.target
    returning true into v_done;
    if v_done then
      perform app.award_points(p_user, q.reward_points, 'quest', 'quest', q.id::text || ':' || v_start::text);
      perform app.notify(p_user, 'quest', 'Quest complete', '+' || q.reward_points || ' Brain Points', '/quests/');
      v_done := false;
    end if;
  end loop;
end $$;

/** Runs after every event batch of a signed-in player: streak first, then quests. */
create or replace function app.on_events_ingested(p_anon_id uuid, p_user uuid, p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_played boolean;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user and banned_at is null) then
    return;
  end if;
  select exists (select 1 from jsonb_array_elements(p_events) e where e ->> 'type' = 'play_click') into v_played;
  if v_played then
    update public.profiles set
      streak_days = case
        when streak_last_day = v_today then streak_days
        when streak_last_day = v_today - 1 then streak_days + 1
        else 1 end,
      streak_last_day = v_today,
      last_active = now()
    where id = p_user;
  end if;
  perform app.refresh_quests(p_user);
end $$;

/** Lets a game report a quest-relevant action through the SDK (`BG.quests.track`). */
create or replace function public.track_quest_event(p_event text, p_value int default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.quests; v_start date; v_done boolean;
begin
  if auth.uid() is null then return; end if;
  if p_event !~ '^[a-z0-9_]{1,40}$' then perform app.fail('invalid'); end if;
  perform app.guard('quest_track', auth.uid()::text, 60, 60);
  for q in select * from app.active_quests() loop
    if q.rule ->> 'kind' <> 'custom' or q.rule ->> 'event' <> p_event then continue; end if;
    v_start := app.period_start(q.period);
    insert into public.quest_progress as qp (user_id, quest_id, period_start, progress)
    values (auth.uid(), q.id, v_start, least(greatest(p_value, 0), q.target))
    on conflict (user_id, quest_id, period_start)
      do update set progress = least(qp.progress + least(greatest(p_value, 0), 10), q.target);
    update public.quest_progress set completed_at = now()
    where user_id = auth.uid() and quest_id = q.id and period_start = v_start
      and completed_at is null and progress >= q.target
    returning true into v_done;
    if v_done then
      perform app.award_points(auth.uid(), q.reward_points, 'quest', 'quest', q.id::text || ':' || v_start::text);
      v_done := false;
    end if;
  end loop;
end $$;

/** The caller's active quests with progress. Guests get the quests with zero progress. */
create or replace function public.my_quests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'code', q.code, 'period', q.period, 'title', q.title, 'description', q.description,
      'rule', q.rule, 'target', q.target, 'reward_points', q.reward_points,
      'progress', coalesce(p.progress, 0), 'completed_at', p.completed_at,
      'period_start', app.period_start(q.period)) order by q.period, q.sort, q.code)
    from app.active_quests() q
    left join public.quest_progress p
      on p.quest_id = q.id and p.user_id = auth.uid() and p.period_start = app.period_start(q.period)
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Cosmetics
-- ---------------------------------------------------------------------------------------------
create or replace function public.unlock_cosmetic(p_cosmetic_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.cosmetics; p public.profiles;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  select * into c from public.cosmetics where id = p_cosmetic_id and active;
  select * into p from public.profiles where id = auth.uid();
  if c.id is null or p.id is null then perform app.fail('not_found'); end if;
  if exists (select 1 from public.user_cosmetics where user_id = auth.uid() and cosmetic_id = c.id) then return; end if;
  if p.level < c.min_level or p.brain_points < c.cost_points then perform app.fail('not_allowed'); end if;
  insert into public.user_cosmetics (user_id, cosmetic_id) values (auth.uid(), c.id);
  if c.cost_points > 0 then
    perform app.award_points(auth.uid(), -c.cost_points, 'cosmetic', 'cosmetic', c.id::text);
  end if;
end $$;

/** Equips owned cosmetics. `p_equipped` maps slot to cosmetic code; an empty code unequips. */
create or replace function public.equip_cosmetics(p_equipped jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot text; v_code text; v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  for v_slot, v_code in select key, value from jsonb_each_text(coalesce(p_equipped, '{}'::jsonb)) loop
    if v_code is null or v_code = '' then continue; end if;
    if not exists (
      select 1 from public.user_cosmetics uc join public.cosmetics c on c.id = uc.cosmetic_id
      where uc.user_id = auth.uid() and c.slot = v_slot and c.code = v_code
    ) then perform app.fail('not_allowed'); end if;
    v_out := v_out || jsonb_build_object(v_slot, v_code);
  end loop;
  update public.profiles set avatar_cosmetics = v_out where id = auth.uid();
  return v_out;
end $$;
