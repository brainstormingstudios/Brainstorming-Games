-- 0002_events_kpis: the events pipeline and the daily KPI roll-up.
--
-- KPI definitions (identical to apps/web/src/lib/domain/kpis.ts):
--   play        one play session (a play_click with a session id)
--   playtime    the largest cumulative `t` (seconds) reported by gameplay_stop / session_end
--   conversion  share of plays with at least 60 s of playtime
--   D1 / D7     share of a day's new players who play the same game again 1 / 7 days later

create table public.events (
  id bigint generated always as identity primary key,
  anon_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  session_id uuid,
  game_id uuid references public.games (id) on delete cascade,
  version_id uuid references public.game_versions (id) on delete set null,
  type public.event_type not null,
  ts timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  country text,
  device text check (device in ('desktop', 'mobile', 'tablet')),
  ref_studio text
);
create index events_game_ts_idx on public.events (game_id, ts);
create index events_session_idx on public.events (session_id);
create index events_anon_game_idx on public.events (anon_id, game_id, ts);
create index events_ts_idx on public.events (ts);

create table public.daily_game_kpis (
  game_id uuid not null references public.games (id) on delete cascade,
  day date not null,
  plays int not null default 0,
  players int not null default 0,
  new_players int not null default 0,
  conversion_1min numeric(5, 4),
  avg_session_sec numeric(10, 2),
  d1_retention numeric(5, 4),
  d7_retention numeric(5, 4),
  ad_impressions int not null default 0,
  ad_impressions_by_country jsonb not null default '{}'::jsonb,
  ref_ad_impressions int not null default 0,
  likes int not null default 0,
  dislikes int not null default 0,
  dislike_reasons jsonb not null default '{}'::jsonb,
  load_ms_p50 int,
  load_ms_p90 int,
  est_revenue numeric(12, 4) not null default 0,
  primary key (game_id, day)
);

alter table public.events enable row level security;
alter table public.daily_game_kpis enable row level security;

-- Raw events are never readable by clients. Studios read the daily roll-up of their own games.
create policy kpis_select on public.daily_game_kpis for select using (app.owns_game(game_id) or app.is_staff());

/**
 * Batched event ingest. Callable by anyone (guests included) and rate limited per anonymous id
 * and per IP. Country comes from the edge header when the request arrives through the API, or
 * from `p_country` when the events Edge Function calls with the service role.
 */
create or replace function public.ingest_events(
  p_anon_id uuid,
  p_device text,
  p_ref_studio text,
  p_events jsonb,
  p_country text default null
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_country text := upper(left(coalesce(p_country, app.header('cf-ipcountry'), ''), 2));
  v_event jsonb;
  v_type public.event_type;
  v_game uuid;
  v_session uuid;
  v_version uuid;
  v_ts timestamptz;
  v_count int := 0;
  v_plays jsonb := '{}'::jsonb;
begin
  if p_anon_id is null or jsonb_typeof(p_events) <> 'array' then perform app.fail('invalid'); end if;
  if jsonb_array_length(p_events) > 50 then perform app.fail('invalid'); end if;
  perform app.guard('events', p_anon_id::text, 120, 60);
  if p_device not in ('desktop', 'mobile', 'tablet') then p_device := null; end if;
  if p_ref_studio is not null and p_ref_studio !~ '^[a-z0-9-]{2,40}$' then p_ref_studio := null; end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    -- A malformed event (unknown type, bad uuid, bad timestamp) is skipped, not fatal.
    begin
      v_type := (v_event ->> 'type')::public.event_type;
      v_game := nullif(v_event ->> 'game_id', '')::uuid;
      v_session := nullif(v_event ->> 'session_id', '')::uuid;
      v_version := nullif(v_event ->> 'version_id', '')::uuid;
      v_ts := coalesce((v_event ->> 'ts')::timestamptz, now());
    exception when others then
      continue;
    end;
    if v_game is not null and not exists (select 1 from public.games g where g.id = v_game) then
      continue;
    end if;
    if v_version is not null and not exists (select 1 from public.game_versions v where v.id = v_version) then
      v_version := null;
    end if;
    -- Client clocks drift: accept the timestamp only if it is close to now.
    if v_ts not between now() - interval '2 hours' and now() + interval '5 minutes' then
      v_ts := now();
    end if;
    insert into public.events (anon_id, user_id, session_id, game_id, version_id, type, ts, payload, country, device, ref_studio)
    values (
      p_anon_id, auth.uid(), v_session, v_game, v_version, v_type, v_ts,
      coalesce(v_event -> 'payload', '{}'::jsonb),
      nullif(v_country, ''), p_device, p_ref_studio
    );
    v_count := v_count + 1;
    if v_type = 'play_click' and v_game is not null then
      v_plays := jsonb_set(v_plays, array[v_game::text], to_jsonb(coalesce((v_plays ->> v_game::text)::int, 0) + 1));
    end if;
  end loop;

  -- Keep the public play counters live without waiting for the daily job.
  insert into public.game_stats as s (game_id, plays_total, plays_7d)
  select key::uuid, value::int, value::int from jsonb_each_text(v_plays)
  on conflict (game_id) do update
    set plays_total = s.plays_total + excluded.plays_total,
        plays_7d = s.plays_7d + excluded.plays_7d,
        updated_at = now();

  if v_count > 0 then perform app.on_events_ingested(p_anon_id, auth.uid(), p_events); end if;
  return v_count;
end $$;

/** Hook for later migrations (quests, streaks). Replaced in 0004_progression. */
create or replace function app.on_events_ingested(p_anon_id uuid, p_user uuid, p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

/** Rebuilds one day of KPIs for every game that had activity around that day. Idempotent. */
create or replace function public.refresh_daily_game_kpis(p_day date default (current_date - 1))
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := p_day::timestamptz;
  v_to timestamptz := (p_day + 1)::timestamptz;
  v_rows int;
begin
  if auth.role() not in ('service_role') and not app.is_staff() then perform app.fail('not_allowed'); end if;

  with sessions as (
    select e.game_id, e.session_id, min(e.anon_id::text)::uuid as anon_id,
      max(coalesce((e.payload ->> 't')::numeric, 0)) as seconds,
      max(case when e.type = 'loading_stop' then (e.payload ->> 'ms')::numeric end) as load_ms
    from public.events e
    where e.ts >= v_from and e.ts < v_to and e.game_id is not null and e.session_id is not null
    group by e.game_id, e.session_id
    having bool_or(e.type = 'play_click')
  ),
  per_game as (
    select game_id,
      count(*) as plays,
      count(distinct anon_id) as players,
      avg((seconds >= 60)::int) as conversion,
      avg(seconds) as avg_seconds,
      percentile_cont(0.5) within group (order by load_ms) as p50,
      percentile_cont(0.9) within group (order by load_ms) as p90
    from sessions group by game_id
  ),
  ads_country as (
    select e.game_id, coalesce(e.country, 'ZZ') as country,
      count(*) as n,
      count(*) filter (where e.ref_studio is not null) as ref_n
    from public.events e
    where e.type = 'ad_started' and e.ts >= v_from and e.ts < v_to and e.game_id is not null
    group by e.game_id, coalesce(e.country, 'ZZ')
  ),
  ads as (
    select game_id, sum(n) as impressions, sum(ref_n) as ref_impressions,
      jsonb_object_agg(country, n) as by_country
    from ads_country group by game_id
  ),
  votes_reason as (
    select r.game_id, r.reason,
      count(*) filter (where r.value = 1) as likes,
      count(*) filter (where r.value = -1) as dislikes
    from public.ratings r
    where r.created_at >= v_from and r.created_at < v_to
    group by r.game_id, r.reason
  ),
  votes as (
    select game_id, sum(likes) as likes, sum(dislikes) as dislikes,
      coalesce(jsonb_object_agg(reason, dislikes) filter (where reason is not null), '{}'::jsonb) as reasons
    from votes_reason group by game_id
  ),
  first_play as (
    select e.game_id, e.anon_id, min(e.ts)::date as first_day
    from public.events e
    where e.type = 'play_click' and e.game_id is not null and e.ts < v_to
    group by e.game_id, e.anon_id
  ),
  newcomers as (
    select game_id, count(*) as n from first_play where first_day = p_day group by game_id
  )
  insert into public.daily_game_kpis as k
    (game_id, day, plays, players, new_players, conversion_1min, avg_session_sec, ad_impressions,
     ad_impressions_by_country, ref_ad_impressions, likes, dislikes, dislike_reasons, load_ms_p50, load_ms_p90)
  select g.id, p_day,
    coalesce(pg.plays, 0), coalesce(pg.players, 0), coalesce(n.n, 0),
    pg.conversion, pg.avg_seconds,
    coalesce(a.impressions, 0), coalesce(a.by_country, '{}'::jsonb), coalesce(a.ref_impressions, 0),
    coalesce(v.likes, 0), coalesce(v.dislikes, 0), coalesce(v.reasons, '{}'::jsonb),
    pg.p50::int, pg.p90::int
  from public.games g
  left join per_game pg on pg.game_id = g.id
  left join ads a on a.game_id = g.id
  left join votes v on v.game_id = g.id
  left join newcomers n on n.game_id = g.id
  where pg.game_id is not null or a.game_id is not null or v.game_id is not null
  on conflict (game_id, day) do update set
    plays = excluded.plays, players = excluded.players, new_players = excluded.new_players,
    conversion_1min = excluded.conversion_1min, avg_session_sec = excluded.avg_session_sec,
    ad_impressions = excluded.ad_impressions, ad_impressions_by_country = excluded.ad_impressions_by_country,
    ref_ad_impressions = excluded.ref_ad_impressions, likes = excluded.likes, dislikes = excluded.dislikes,
    dislike_reasons = excluded.dislike_reasons, load_ms_p50 = excluded.load_ms_p50, load_ms_p90 = excluded.load_ms_p90;
  get diagnostics v_rows = row_count;

  -- Retention for the cohorts that first played 1 and 7 days before p_day.
  update public.daily_game_kpis k set d1_retention = r.rate
  from (
    select c.game_id, avg((exists (
      select 1 from public.events e
      where e.game_id = c.game_id and e.anon_id = c.anon_id and e.type = 'play_click'
        and e.ts >= v_from and e.ts < v_to))::int) as rate
    from (
      select e.game_id, e.anon_id from public.events e
      where e.type = 'play_click' and e.game_id is not null and e.ts < v_to
      group by e.game_id, e.anon_id having min(e.ts)::date = p_day - 1
    ) c group by c.game_id
  ) r
  where k.game_id = r.game_id and k.day = p_day - 1;

  update public.daily_game_kpis k set d7_retention = r.rate
  from (
    select c.game_id, avg((exists (
      select 1 from public.events e
      where e.game_id = c.game_id and e.anon_id = c.anon_id and e.type = 'play_click'
        and e.ts >= v_from and e.ts < v_to))::int) as rate
    from (
      select e.game_id, e.anon_id from public.events e
      where e.type = 'play_click' and e.game_id is not null and e.ts < v_to
      group by e.game_id, e.anon_id having min(e.ts)::date = p_day - 7
    ) c group by c.game_id
  ) r
  where k.game_id = r.game_id and k.day = p_day - 7;

  -- Rolling public counters.
  update public.game_stats s set
    plays_7d = coalesce((select sum(k.plays) from public.daily_game_kpis k
                         where k.game_id = s.game_id and k.day > current_date - 7), 0),
    updated_at = now();
  perform app.refresh_rating(g.id) from public.games g where g.released_at is not null;

  -- Events older than 13 months are deleted; the daily roll-up is what remains.
  delete from public.events where ts < now() - interval '13 months';
  return v_rows;
end $$;

/** KPI rows of one game plus its percentile inside its category (for the developer KPI page). */
create or replace function public.game_kpis(p_game_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_category text;
  v_result jsonb;
begin
  if not (app.owns_game(p_game_id) or app.is_staff()) then perform app.fail('not_allowed'); end if;
  select category into v_category from public.games where id = p_game_id;
  with mine as (
    select * from public.daily_game_kpis k where k.game_id = p_game_id and k.day between p_from and p_to
  ),
  peers as (
    select k.game_id,
      sum(k.plays) as plays,
      sum(k.conversion_1min * k.plays) / nullif(sum(k.plays), 0) as conversion,
      sum(k.avg_session_sec * k.plays) / nullif(sum(k.plays), 0) as session,
      avg(k.d1_retention) as d1
    from public.daily_game_kpis k join public.games g on g.id = k.game_id
    where g.category = v_category and k.day between p_from and p_to
    group by k.game_id
  ),
  ranked as (
    select game_id,
      percent_rank() over (order by conversion nulls first) as conversion_pct,
      percent_rank() over (order by session nulls first) as session_pct,
      percent_rank() over (order by d1 nulls first) as d1_pct,
      percent_rank() over (order by plays nulls first) as plays_pct
    from peers
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(to_jsonb(m) order by m.day) from mine m), '[]'::jsonb),
    'peers', (select count(*) from peers),
    'percentiles', (select to_jsonb(r) - 'game_id' from ranked r where r.game_id = p_game_id)
  ) into v_result;
  return v_result;
end $$;
