-- 0017_brain: Brain Profile.
--
-- Developers tag each game with up to three skills (memory, logic, speed, focus, strategy).
-- A player's play time per game and day comes from their own events; the TypeScript engine
-- (apps/web/src/lib/domain/brain.ts) turns it into scores. On Mondays the daily job e-mails a
-- weekly brain report to players who play and have not turned it off.

alter table public.games add column skills text[] not null default '{}'
  check (skills <@ array['memory', 'logic', 'speed', 'focus', 'strategy']::text[] and cardinality(skills) <= 3);
grant insert (skills), update (skills) on public.games to authenticated;

alter table public.profiles add column brain_report boolean not null default true;

-- The public read model gains the skills (new columns go at the end of a view).
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
  coalesce(st.rank_score, 0)::double precision as rank_score,
  bo.ends_at as promo_until,
  bo.hero_until as promo_hero_until,
  g.skills
from public.games g
join public.studios s on s.id = g.studio_id and s.suspended_at is null
left join public.game_stats st on st.game_id = g.id
left join public.game_versions v on v.id = g.current_version_id
left join lateral (
  select b.ends_at, b.hero_until from public.boosts b
  where b.game_id = g.id and b.status in ('paid', 'live') and b.ends_at > now()
  order by b.ends_at desc limit 1
) bo on true
where g.released_at is not null;

/**
 * Play time per game and day for one player: a session's seconds are the largest `t` its
 * gameplay_stop / session_end events reported (capped at 6 hours, so a tab left open does not
 * count as a day of practice). Signed in: by user id. Guest: by the browser's anonymous id.
 */
create or replace function app.play_rows(p_user uuid, p_anon uuid, p_days int)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (
    select e.game_id, e.session_id, min(e.ts)::date as day,
      least(21600, max(case when jsonb_typeof(e.payload -> 't') = 'number' then (e.payload ->> 't')::numeric else 0 end)) as seconds
    from public.events e
    where e.ts >= now() - make_interval(days => p_days)
      and e.game_id is not null and e.session_id is not null
      and e.type in ('gameplay_stop', 'session_end')
      and ((p_user is not null and e.user_id = p_user) or (p_user is null and p_anon is not null and e.anon_id = p_anon and e.user_id is null))
    group by e.game_id, e.session_id
  ),
  r as (select game_id, day, sum(seconds) as seconds from s group by game_id, day having sum(seconds) > 0)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('gameId', game_id, 'day', to_char(day, 'YYYY-MM-DD'), 'seconds', seconds)) from r), '[]'::jsonb),
    'skills', coalesce((select jsonb_object_agg(g.id, to_jsonb(g.skills)) from public.games g where g.id in (select game_id from r)), '{}'::jsonb));
$$;

/** The caller's own play rows (the last 400 days), for their Brain Profile. */
create or replace function public.brain_profile(p_anon_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and p_anon_id is null then return jsonb_build_object('rows', '[]'::jsonb, 'skills', '{}'::jsonb); end if;
  return app.play_rows(auth.uid(), case when auth.uid() is null then p_anon_id end, 400);
end $$;

/** Another player's profile, for "challenge a friend": only public, unbanned adults or minors with consent. */
create or replace function public.brain_profile_of(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p record;
begin
  select id, username, display_name into p from public.profiles
  where username = lower(p_username) and profile_public and banned_at is null
    and (not is_minor or parental_consent_status = 'granted');
  if not found then return null; end if;
  return jsonb_build_object('username', p.username, 'displayName', p.display_name) || app.play_rows(p.id, null, 400);
end $$;

create or replace function public.set_brain_report(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  update public.profiles set brain_report = coalesce(p_on, true) where id = auth.uid();
end $$;

/** Queues the weekly brain report e-mail. Called by the daily job on Mondays. */
create or replace function app.weekly_brain_reports()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with s as (
    select e.user_id, e.game_id, e.session_id, min(e.ts)::date as day,
      least(21600, max(case when jsonb_typeof(e.payload -> 't') = 'number' then (e.payload ->> 't')::numeric else 0 end)) as seconds
    from public.events e
    where e.ts >= current_date - 13 and e.user_id is not null and e.game_id is not null and e.session_id is not null
      and e.type in ('gameplay_stop', 'session_end')
    group by e.user_id, e.game_id, e.session_id
  ),
  per_skill as (
    select s.user_id, k.skill,
      sum(case when s.day >= current_date - 6 then s.seconds else 0 end / cardinality(g.skills)) / 60 as week_min,
      sum(case when s.day < current_date - 6 then s.seconds else 0 end / cardinality(g.skills)) / 60 as prev_min
    from s join public.games g on g.id = s.game_id and cardinality(g.skills) > 0
    cross join lateral unnest(g.skills) as k(skill)
    group by s.user_id, k.skill
  ),
  per_user as (
    select user_id, sum(week_min) as total,
      jsonb_object_agg(skill, jsonb_build_object('week', round(week_min), 'prev', round(prev_min))) as skills
    from per_skill group by user_id having sum(week_min) >= 1
  ),
  sent as (
    select app.queue_mail(u.email, 'brain_report', jsonb_build_object(
      'name', coalesce(nullif(p.display_name, ''), p.username), 'minutes', round(t.total), 'skills', t.skills)) as ok
    from per_user t
    join public.profiles p on p.id = t.user_id
    join auth.users u on u.id = t.user_id
    where p.brain_report and p.banned_at is null and (not p.is_minor or p.parental_consent_status = 'granted')
  )
  select count(*) into v_count from sent;
  return v_count;
end $$;

-- The daily job sends the weekly report on Mondays.
create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int; v_rank int; v_reports int := 0;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  v_kpis := public.refresh_daily_game_kpis(current_date - 1);
  perform public.refresh_daily_game_kpis(current_date);
  v_ab := public.pick_ab_winners();
  v_rank := public.refresh_rank_scores();
  delete from public.parties where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 days';
  if extract(isodow from current_date) = 1 then v_reports := app.weekly_brain_reports(); end if;
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab, 'games_ranked', v_rank, 'brain_reports', v_reports);
end $$;

-- Grants, in the explicit style of 0009.
revoke execute on function app.play_rows(uuid, uuid, int), app.weekly_brain_reports() from public, anon, authenticated;
grant execute on function app.weekly_brain_reports() to service_role;
grant execute on function public.brain_profile(uuid), public.brain_profile_of(text) to anon, authenticated;
grant execute on function public.set_brain_report(boolean) to authenticated;
grant select on public.game_cards to anon, authenticated;
