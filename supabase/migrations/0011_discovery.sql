-- 0011_discovery: tile impressions, Brain Rank (the discovery score), site and database stats.
--
-- The formula in app.rank_score is the same as apps/web/src/lib/domain/ranking.ts.

create table public.game_impressions (
  game_id uuid not null references public.games (id) on delete cascade,
  day date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  primary key (game_id, day)
);
alter table public.game_impressions enable row level security;
create policy game_impressions_select on public.game_impressions for select using (app.owns_game(game_id) or app.is_staff());

alter table public.game_stats
  add column impressions_14d bigint not null default 0,
  add column clicks_14d bigint not null default 0,
  add column plays_14d bigint not null default 0,
  add column conversion_14d numeric(5, 4),
  add column avg_session_sec_14d numeric(10, 2),
  add column d1_14d numeric(5, 4),
  add column rank_score numeric(4, 1) not null default 0;

/** Tile impressions and clicks from one visitor, in a small batch. Capped and rate limited. */
create or replace function public.record_tile_hits(p_anon_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_game uuid; v_imp int; v_clicks int; v_variant text;
begin
  if p_anon_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then return; end if;
  if not app.take_token('tiles:' || p_anon_id::text, 30, 60) then return; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_game := (r ->> 'gameId')::uuid;
      v_imp := least(greatest(coalesce((r ->> 'impressions')::int, 0), 0), 5);
      v_clicks := least(greatest(coalesce((r ->> 'clicks')::int, 0), 0), 2);
      v_variant := nullif(r ->> 'variant', '');
      insert into public.game_impressions as g (game_id, day, impressions, clicks)
      values (v_game, current_date, v_imp, v_clicks)
      on conflict (game_id, day) do update
        set impressions = g.impressions + excluded.impressions, clicks = g.clicks + excluded.clicks;
      if v_variant is not null and exists (
        select 1 from public.game_media m
        where m.game_id = v_game and m.kind = 'cover_landscape' and m.is_active and m.variant_label = v_variant
      ) then
        insert into public.media_variant_stats as s (game_id, variant_label, impressions, clicks)
        values (v_game, v_variant, v_imp, v_clicks)
        on conflict (game_id, variant_label) do update
          set impressions = s.impressions + excluded.impressions, clicks = s.clicks + excluded.clicks
          where s.decided_at is null;
      end if;
    exception when others then
      continue;
    end;
  end loop;
end $$;

/** Brain Rank, 0 to 100. Mirror of rankScore() in lib/domain/ranking.ts. */
create or replace function app.rank_score(
  p_impressions bigint, p_clicks bigint, p_plays bigint, p_conversion numeric, p_avg_session numeric,
  p_d1 numeric, p_likes int, p_dislikes int, p_age_days numeric
) returns numeric language sql immutable as $$
  with x as (
    select
      greatest(p_impressions, 0)::numeric as imp,
      greatest(p_plays, 0)::numeric as plays,
      greatest(p_likes + p_dislikes, 0)::numeric as votes
  ), parts as (
    select
      least(1, greatest(0,
        ((case when imp > 0 then least(p_clicks, p_impressions)::numeric / imp else 0 end) * imp + 0.08 * 100) / (imp + 100) / 0.2)) as click_rate,
      least(1, greatest(0,
        (coalesce(p_conversion, 0.5) * (case when p_conversion is null then 0 else plays end) + 0.5 * 20)
          / ((case when p_conversion is null then 0 else plays end) + 20) / 0.8)) as conversion,
      least(1, greatest(0,
        (coalesce(p_avg_session, 150) * (case when p_avg_session is null then 0 else plays end) + 150 * 20)
          / ((case when p_avg_session is null then 0 else plays end) + 20) / 600)) as playtime,
      least(1, greatest(0,
        (coalesce(p_d1, 0.05) * (case when p_d1 is null then 0 else plays end) + 0.05 * 20)
          / ((case when p_d1 is null then 0 else plays end) + 20) / 0.15)) as retention,
      least(1, greatest(0,
        ((case when votes > 0 then p_likes::numeric / votes else 0 end) * votes + 0.75 * 4) / (votes + 4))) as rating,
      least(1, greatest(0, 1 - imp / 1000)) as exploration,
      exp(-greatest(p_age_days, 0) / 14.0) as freshness
    from x
  )
  select round(least(1, greatest(0,
    click_rate * 0.25 + conversion * 0.25 + playtime * 0.25 + retention * 0.15 + rating * 0.10
    + exploration * 0.15 + freshness * 0.08)) * 100, 1)
  from parts;
$$;

/** Recomputes the 14-day discovery inputs and the score of every released game. */
create or replace function public.refresh_rank_scores()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  insert into public.game_stats (game_id) select g.id from public.games g where g.released_at is not null
  on conflict (game_id) do nothing;
  with imp as (
    select game_id, sum(impressions) as impressions, sum(clicks) as clicks
    from public.game_impressions where day > current_date - 14 group by game_id
  ), kpi as (
    select game_id,
      sum(plays) as plays,
      sum(conversion_1min * plays) filter (where conversion_1min is not null) / nullif(sum(plays) filter (where conversion_1min is not null), 0) as conversion,
      sum(avg_session_sec * plays) filter (where avg_session_sec is not null) / nullif(sum(plays) filter (where avg_session_sec is not null), 0) as avg_session,
      sum(d1_retention * plays) filter (where d1_retention is not null) / nullif(sum(plays) filter (where d1_retention is not null), 0) as d1
    from public.daily_game_kpis where day > current_date - 14 group by game_id
  )
  update public.game_stats st set
    impressions_14d = coalesce(imp.impressions, 0),
    clicks_14d = coalesce(imp.clicks, 0),
    plays_14d = coalesce(kpi.plays, 0),
    conversion_14d = kpi.conversion,
    avg_session_sec_14d = kpi.avg_session,
    d1_14d = kpi.d1,
    rank_score = app.rank_score(
      coalesce(imp.impressions, 0)::bigint, coalesce(imp.clicks, 0)::bigint, coalesce(kpi.plays, 0)::bigint,
      kpi.conversion::numeric, kpi.avg_session::numeric, kpi.d1::numeric,
      st.likes_180d, st.dislikes_180d, (extract(epoch from (now() - g.released_at)) / 86400.0)::numeric),
    updated_at = now()
  from public.games g
  left join imp on imp.game_id = g.id
  left join kpi on kpi.game_id = g.id
  where st.game_id = g.id and g.released_at is not null;
  get diagnostics v_count = row_count;
  delete from public.game_impressions where day < current_date - 60;
  return v_count;
end $$;

-- The public read model gains the score (new columns can only be added at the end of a view).
create or replace view public.game_cards with (security_barrier = true) as
select
  g.id, g.slug, g.title, g.short_description, g.category, g.tags, g.orientation, g.platforms,
  g.is_multiplayer, g.size_bytes, g.initial_load_bytes, g.status, g.school_safe,
  g.released_at, g.updated_at, g.spark_started_at,
  s.id as studio_id, s.slug as studio_slug, s.name as studio_name, s.country as studio_country,
  s.is_first_party as studio_first_party, s.verified as studio_verified,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', m.kind, 'url', m.url, 'widths', m.widths, 'width', m.width, 'height', m.height,
      'placeholder', m.placeholder, 'variantLabel', m.variant_label) order by m.created_at)
    from public.game_media m where m.game_id = g.id and m.is_active
  ), '[]'::jsonb) as media,
  coalesce(st.plays_total, 0) as plays,
  coalesce(st.plays_7d, 0) as plays_7d,
  st.rating10,
  coalesce(st.likes_180d, 0) + coalesce(st.dislikes_180d, 0) as votes,
  coalesce(st.likes_180d, 0) as likes,
  coalesce(st.dislikes_180d, 0) as dislikes,
  v.id as version_id, v.version, v.storage_prefix, v.entry_file, v.uses_sdk,
  (coalesce(st.plays_total, 0) * (0.5 + coalesce(st.rating10, 7) / 10.0))::double precision as popular_score,
  (coalesce(st.plays_7d, 0) * (0.5 + coalesce(st.rating10, 7) / 10.0))::double precision as trending_score,
  g.description_md, g.how_to_play_md, g.controls, g.faq, g.features_md, g.tips_md,
  g.engine, g.has_progress, g.exclusive_until, g.created_at,
  coalesce(st.rank_score, 0)::double precision as rank_score
from public.games g
join public.studios s on s.id = g.studio_id and s.suspended_at is null
left join public.game_stats st on st.game_id = g.id
left join public.game_versions v on v.id = g.current_version_id
where g.released_at is not null;

/** The management portal's overview numbers. */
create or replace function public.admin_site_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return jsonb_build_object(
    'plays_7d', (select coalesce(sum(plays), 0) from public.daily_game_kpis where day > current_date - 7),
    'players_7d', (select coalesce(sum(players), 0) from public.daily_game_kpis where day > current_date - 7),
    'plays_today', (select coalesce(sum(plays), 0) from public.daily_game_kpis where day = current_date),
    'impressions_7d', (select coalesce(sum(impressions), 0) from public.game_impressions where day > current_date - 7),
    'accounts', (select count(*) from public.profiles),
    'studios', (select count(*) from public.studios),
    'games_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status::text, count(*) as n from public.games group by status) x),
    'in_review', (select count(*) from public.game_versions where qa_status = 'in_review'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'plays', coalesce(k.plays, 0), 'players', coalesce(k.players, 0),
        'impressions', coalesce(i.impressions, 0)) order by d), '[]'::jsonb)
      from generate_series(current_date - 29, current_date, interval '1 day') d
      left join (select day, sum(plays) as plays, sum(players) as players from public.daily_game_kpis group by day) k on k.day = d::date
      left join (select day, sum(impressions) as impressions from public.game_impressions group by day) i on i.day = d::date
    )
  );
end $$;

/**
 * Size of the database for the management portal: every table of the public schema with its
 * row estimate and size on disk, the whole database size and the open connections. The same
 * numbers pgAdmin shows under Statistics.
 */
create or replace function public.admin_db_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return jsonb_build_object(
    'version', split_part(version(), ' on ', 1),
    'total_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'rows', greatest(c.reltuples, 0)::bigint,
        'bytes', pg_total_relation_size(c.oid)) order by pg_total_relation_size(c.oid) desc), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    )
  );
end $$;

-- The daily job also refreshes the discovery scores.
create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int; v_rank int;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  v_kpis := public.refresh_daily_game_kpis(current_date - 1);
  perform public.refresh_daily_game_kpis(current_date);
  v_ab := public.pick_ab_winners();
  v_rank := public.refresh_rank_scores();
  delete from public.parties where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 days';
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab, 'games_ranked', v_rank);
end $$;

-- Grants, in the explicit style of 0009.
revoke all on public.game_impressions from anon, authenticated;
grant select on public.game_impressions to authenticated;
grant all on public.game_impressions to service_role;
revoke execute on function public.record_tile_hits(uuid, jsonb), public.refresh_rank_scores(), public.admin_site_stats(), public.admin_db_stats() from public, anon, authenticated;
grant execute on function public.record_tile_hits(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.refresh_rank_scores(), public.admin_site_stats(), public.admin_db_stats() to authenticated, service_role;
grant execute on function app.rank_score(bigint, bigint, bigint, numeric, numeric, numeric, int, int, numeric) to anon, authenticated, service_role;
