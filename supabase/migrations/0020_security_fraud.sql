-- 0020_security_fraud: Security Phase 1, part 1.
--   * The caller's IP comes from Cloudflare's header (a client cannot fake it), not from the first
--     X-Forwarded-For entry (which the client writes).
--   * The country of an event is only taken from the platform, never from the caller.
--   * Fake-event caps: plays and ad views per browser, per IP and per game per day.
--   * Ad views only earn revenue (studios and creators) inside sessions with real play.

-- ---- Private settings: readable only by database functions, never by the API -------------------
create table if not exists app.secrets (
  name text primary key,
  value_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on app.secrets from public, anon, authenticated;

/** Stores the SHA-256 of a secret (set once at deploy time with the service role). */
create or replace function app.set_secret(p_name text, p_value text) returns void
language sql security definer set search_path = '' as $$
  insert into app.secrets (name, value_hash) values (p_name, encode(sha256(convert_to(p_value, 'utf8')), 'hex'))
  on conflict (name) do update set value_hash = excluded.value_hash, updated_at = now();
$$;

create or replace function app.secret_matches(p_name text, p_value text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_value, '') <> '' and exists (
    select 1 from app.secrets where name = p_name and value_hash = encode(sha256(convert_to(p_value, 'utf8')), 'hex'));
$$;

-- ---- Who is calling -------------------------------------------------------------------------------
/**
 * The caller's IP. Our own Edge Functions call the database from Supabase's servers, so they pass
 * the player's IP in x-bg-client-ip and prove it with the edge key. Otherwise Cloudflare's header
 * first (it overwrites any copy the client sends).
 */
create or replace function app.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(
    case when app.secret_matches('edge_key', app.header('x-bg-edge-key')) then nullif(trim(app.header('x-bg-client-ip')), '') end,
    nullif(trim(app.header('cf-connecting-ip')), ''),
    nullif(trim(app.header('x-real-ip')), ''),
    -- Last resort: the right-most entry is the one our own proxy added, not one the client wrote.
    nullif(trim(reverse(split_part(reverse(coalesce(app.header('x-forwarded-for'), '')), ',', 1))), ''),
    '');
$$;

create or replace function app.guard(p_action text, p_caller text, p_capacity double precision, p_window_seconds double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip text := app.client_ip();
begin
  if not app.take_token(p_action || ':' || p_caller, p_capacity, p_window_seconds) then
    perform app.fail('rate_limited');
  end if;
  if v_ip <> '' and not app.take_token(p_action || ':ip:' || md5(v_ip), p_capacity * 4, p_window_seconds) then
    perform app.fail('rate_limited');
  end if;
end $$;

-- ---- Event ingest with fraud caps -------------------------------------------------------------------
create or replace function public.ingest_events(
  p_anon_id uuid,
  p_device text,
  p_ref_studio text,
  p_events jsonb,
  p_country text default null,
  p_ref_creator text default null
) returns int language plpgsql security definer set search_path = '' as $$
declare
  -- The country is only trusted from our own events Edge Function (it proves itself with a secret
  -- header) or from Cloudflare's header; anything else the caller sends is ignored.
  v_country text := upper(left(coalesce(
    case when app.secret_matches('edge_key', app.header('x-bg-edge-key')) then p_country end,
    app.header('cf-ipcountry'), ''), 2));
  v_ip text := md5(app.client_ip());
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
  p_ref_creator := lower(p_ref_creator);
  if p_ref_creator is not null and p_ref_creator !~ '^[a-z0-9_]{3,24}$' then p_ref_creator := null; end if;
  if v_country !~ '^[A-Z]{2}$' then v_country := ''; end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
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
    -- Fraud caps: real players do not start a game 20 times a day or see 60 ads a day. Over the
    -- cap, events are dropped quietly (an attacker learns nothing).
    if v_type = 'play_click' and v_game is not null then
      if not app.take_token('ev:play:' || p_anon_id::text || ':' || v_game::text, 20, 86400)
        or (v_ip <> md5('') and not app.take_token('ev:play:ip:' || v_ip || ':' || v_game::text, 100, 86400)) then
        continue;
      end if;
    elsif v_type = 'ad_started' then
      if not app.take_token('ev:ad:' || p_anon_id::text, 60, 86400)
        or (v_ip <> md5('') and not app.take_token('ev:ad:ip:' || v_ip, 300, 86400)) then
        continue;
      end if;
    end if;
    if v_version is not null and not exists (select 1 from public.game_versions v where v.id = v_version) then
      v_version := null;
    end if;
    if v_ts not between now() - interval '2 hours' and now() + interval '5 minutes' then
      v_ts := now();
    end if;
    insert into public.events (anon_id, user_id, session_id, game_id, version_id, type, ts, payload, country, device, ref_studio, ref_creator)
    values (
      p_anon_id, auth.uid(), v_session, v_game, v_version, v_type, v_ts,
      coalesce(v_event -> 'payload', '{}'::jsonb),
      nullif(v_country, ''), p_device, p_ref_studio, p_ref_creator
    );
    v_count := v_count + 1;
    if v_type = 'play_click' and v_game is not null then
      v_plays := jsonb_set(v_plays, array[v_game::text], to_jsonb(coalesce((v_plays ->> v_game::text)::int, 0) + 1));
    end if;
  end loop;

  insert into public.game_stats as s (game_id, plays_total, plays_7d)
  select key::uuid, value::int, value::int from jsonb_each_text(v_plays)
  on conflict (game_id) do update
    set plays_total = s.plays_total + excluded.plays_total,
        plays_7d = s.plays_7d + excluded.plays_7d,
        updated_at = now();

  if v_count > 0 then perform app.on_events_ingested(p_anon_id, auth.uid(), p_events); end if;
  return v_count;
end $$;

/** A session counts for ad revenue only if it had at least 20 seconds of real play. */
create or replace function app.session_played(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_session is not null and exists (
    select 1 from public.events e
    where e.session_id = p_session and e.type in ('gameplay_stop', 'session_end')
      and jsonb_typeof(e.payload -> 't') = 'number' and (e.payload ->> 't')::numeric >= 20);
$$;

-- ---- Daily KPIs: ad impressions only from sessions with real play -----------------------------------
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
      max(case when jsonb_typeof(e.payload -> 't') = 'number' then (e.payload ->> 't')::numeric else 0 end) as seconds,
      max(case when e.type = 'loading_stop' and jsonb_typeof(e.payload -> 'ms') = 'number' then (e.payload ->> 'ms')::numeric end) as load_ms
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
  played as (select session_id from sessions where seconds >= 20),
  ads_country as (
    select e.game_id, coalesce(e.country, 'ZZ') as country,
      count(*) as n,
      count(*) filter (where e.ref_studio is not null and e.ref_studio = (
        select s.slug from public.games g join public.studios s on s.id = g.studio_id where g.id = e.game_id)) as ref_n
    from public.events e
    where e.type = 'ad_started' and e.ts >= v_from and e.ts < v_to and e.game_id is not null
      and e.session_id in (select session_id from played)
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

  update public.game_stats s set
    plays_7d = coalesce((select sum(k.plays) from public.daily_game_kpis k
                         where k.game_id = s.game_id and k.day > current_date - 7), 0),
    updated_at = now();
  perform app.refresh_rating(g.id) from public.games g where g.released_at is not null;

  delete from public.events where ts < now() - interval '13 months';
  return v_rows;
end $$;

-- ---- Revenue inputs: creator impressions also need real play -----------------------------------------
create or replace function public.admin_revenue_inputs(p_month text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := (p_month || '-01')::date;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  return jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gameId', g.id, 'title', g.title, 'studioId', s.id, 'studioName', s.name, 'studioSlug', s.slug,
        'riseStartedAt', g.rise_started_at, 'exclusiveUntil', g.exclusive_until,
        'impressionsByCountry', x.by_country, 'impressions', x.impressions, 'refImpressions', x.ref_impressions,
        'creatorImpressions', coalesce((
          select jsonb_object_agg(c.id, n.cnt)
          from (select e.ref_creator, count(*) as cnt from public.events e
                where e.game_id = g.id and e.type = 'ad_started' and e.ref_creator is not null
                  and e.ref_studio is distinct from s.slug
                  and e.ts >= v_from and e.ts < v_from + interval '1 month'
                  and app.session_played(e.session_id)
                group by e.ref_creator) n
          join public.creators c on c.handle = n.ref_creator and c.status = 'approved'), '{}'::jsonb)))
      from (
        select k.game_id, sum(k.ad_impressions) as impressions, sum(k.ref_ad_impressions) as ref_impressions,
          (select coalesce(jsonb_object_agg(c.key, c.total), '{}'::jsonb) from (
             select e.key, sum(e.value::numeric) as total
             from public.daily_game_kpis k2, jsonb_each_text(k2.ad_impressions_by_country) e
             where k2.game_id = k.game_id and k2.day >= v_from and k2.day < v_from + interval '1 month'
             group by e.key) c) as by_country
        from public.daily_game_kpis k
        where k.day >= v_from and k.day < v_from + interval '1 month'
        group by k.game_id having sum(k.ad_impressions) > 0
      ) x join public.games g on g.id = x.game_id join public.studios s on s.id = g.studio_id), '[]'::jsonb),
    'weights', (select value from public.site_config where key = 'ad_country_weights'),
    'carry', coalesce((
      select jsonb_object_agg(r.studio_id, r.payout_due)
      from public.revenue_months r
      where r.status = 'rolled_over' and r.month = to_char(v_from - interval '1 month', 'YYYY-MM')), '{}'::jsonb),
    'creatorCarry', coalesce((
      select jsonb_object_agg(r.creator_id, r.payout_due)
      from public.creator_months r
      where r.status = 'rolled_over' and r.month = to_char(v_from - interval '1 month', 'YYYY-MM')), '{}'::jsonb));
end $$;

-- Grants, in the explicit style of 0009.
revoke execute on function app.set_secret(text, text), app.secret_matches(text, text), app.session_played(uuid)
  from public, anon, authenticated;
grant execute on function app.set_secret(text, text) to service_role;
