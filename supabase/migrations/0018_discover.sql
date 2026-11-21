-- 0018_discover: Early Access credits, the Rising chart, the daily challenge, and Brain Points
-- for Premium days. The rules match apps/web/src/lib/domain/discover.ts.

-- ---- Early Access: when a Basic Launch game reaches Full Launch, its testers are credited -------
create or replace function app.on_game_promoted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if old.status = 'spark' and new.status in ('rise', 'featured') then
    for r in select user_id from public.playtest_responses where game_id = new.id loop
      if app.award_points(r.user_id, 50, 'discovered', 'game', new.id::text) then
        perform app.notify(r.user_id, 'discovered', 'You discovered ' || new.title,
          'A game you rated in Early Access reached Full Launch. +50 Brain Points and your name on its page.',
          '/game/' || new.slug || '/');
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger games_promoted after update of status on public.games
  for each row execute function app.on_game_promoted();

/** The caller's discoveries: games they rated in Early Access that reached Full Launch. */
create or replace function public.my_discoveries()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('gameId', g.id, 'slug', g.slug, 'title', g.title, 'ratedAt', p.created_at) order by p.created_at desc), '[]'::jsonb)
  from public.playtest_responses p join public.games g on g.id = p.game_id
  where p.user_id = auth.uid() and g.status in ('rise', 'featured') and g.released_at is not null;
$$;

/** Who discovered a game: public names of its Early Access testers (first 12) and the total. */
create or replace function public.game_discoverers(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.playtest_responses where game_id = p_game_id),
    'names', coalesce((
      select jsonb_agg(username order by created_at) from (
        select pr.username, p.created_at from public.playtest_responses p
        join public.profiles pr on pr.id = p.user_id
        where p.game_id = p_game_id and pr.profile_public and pr.banned_at is null
          and (not pr.is_minor or pr.parental_consent_status = 'granted')
        order by p.created_at limit 12) x), '[]'::jsonb))
  where exists (select 1 from public.games where id = p_game_id and status in ('rise', 'featured'));
$$;

/** The Rising chart: what Early Access testers loved in the last 30 days (3+ answers). */
create or replace function public.rising_games(p_limit int default 10)
returns jsonb language sql stable security definer set search_path = '' as $$
  with a as (
    select p.game_id, count(*) as n, avg(p.fun) as fun, avg(p.play_again::int) as again
    from public.playtest_responses p
    join public.games g on g.id = p.game_id and g.released_at is not null and g.status in ('spark', 'rise', 'featured')
    where p.created_at >= now() - interval '30 days'
    group by p.game_id having count(*) >= 3
  ),
  s as (
    select game_id, n,
      round((((least(5, greatest(1, fun)) - 1) / 4.0 * 0.6 + again * 0.4) * n + 0.5 * 5) / (n + 5), 3) as score
    from a
  )
  select coalesce(jsonb_agg(jsonb_build_object('gameId', game_id, 'answers', n, 'score', score) order by score desc, n desc), '[]'::jsonb)
  from (select * from s order by score desc, n desc limit least(greatest(p_limit, 1), 50)) x;
$$;

/**
 * Today's challenge: one released game for everyone on the same UTC day, preferring games with a
 * leaderboard. Stable for the whole day (hash of id and date).
 */
create or replace function public.daily_challenge()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select g.id, (select l.key from public.leaderboards l where l.game_id = g.id order by l.created_at limit 1) as board
    from public.games g
    join public.studios s on s.id = g.studio_id and s.suspended_at is null
    where g.released_at is not null and g.status in ('rise', 'featured')
  )
  select jsonb_build_object('day', to_char(current_date, 'YYYY-MM-DD'), 'gameId', id, 'board', board)
  from c order by (board is null), md5(id::text || current_date::text) limit 1;
$$;

-- Leaderboards can now be read for today only ('day') as well as this week and all time.
create or replace function public.leaderboard_top(
  p_game_id uuid, p_board text, p_period text default 'all', p_friends boolean default false, p_limit int default 10
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.leaderboards; v_since timestamptz; v_result jsonb;
begin
  select * into b from public.leaderboards where game_id = p_game_id and key = p_board;
  if b.id is null then return jsonb_build_object('entries', '[]'::jsonb, 'me', null); end if;
  v_since := case when p_period = 'day' then date_trunc('day', now())
                  when p_period = 'week' then date_trunc('week', now()) else '-infinity'::timestamptz end;
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

-- ---- Brain Points for Premium days ------------------------------------------------------------------
/**
 * Premium days the caller got with points this calendar month. Each swap is a ledger row with
 * reason 'redeem_premium', the option in ref_type and the time in ref_id.
 */
create or replace function public.point_days_this_month()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case ref_type when 'plus_7d' then 7 else 1 end), 0)::int
  from public.brain_point_ledger
  where user_id = auth.uid() and reason = 'redeem_premium' and created_at >= date_trunc('month', now());
$$;

create or replace function public.redeem_points(p_option text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cost int; v_days int; v_plan text; v_profile record; v_active text; v_until timestamptz; v_month int;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  select cost, days, plan into v_cost, v_days, v_plan
  from (values ('plus_1d', 400, 1, 'plus'), ('plus_7d', 2400, 7, 'plus'), ('max_1d', 800, 1, 'max')) o(id, cost, days, plan)
  where o.id = p_option;
  if v_cost is null then perform app.fail('invalid'); end if;
  -- Lock the row: two quick clicks must not spend the same points twice.
  select * into v_profile from public.profiles where id = auth.uid() and banned_at is null for update;
  if not found then perform app.fail('not_allowed'); end if;
  if v_profile.brain_points < v_cost then perform app.fail('insufficient_points'); end if;
  v_month := public.point_days_this_month();
  if v_month + v_days > 14 then perform app.fail('monthly_limit'); end if;
  v_active := case when v_profile.premium_until > now() then v_profile.premium_plan end;
  if v_active is not null and v_active <> v_plan then perform app.fail('other_plan'); end if;
  v_until := greatest(coalesce(v_profile.premium_until, now()), now()) + make_interval(days => v_days);
  -- A ref per redemption (timestamp) so the ledger's once-per-ref rule never blocks a second swap.
  perform app.award_points(auth.uid(), -v_cost, 'redeem_premium', p_option, extract(epoch from clock_timestamp())::text);
  update public.profiles set premium_plan = v_plan, premium_until = v_until,
    premium_from_pass = case when v_active is null then false else premium_from_pass end
  where id = auth.uid();
  return jsonb_build_object('plan', v_plan, 'until', v_until);
end $$;

-- Grants, in the explicit style of 0009.
revoke execute on function app.on_game_promoted() from public, anon, authenticated;
grant execute on function public.game_discoverers(uuid), public.rising_games(int), public.daily_challenge(),
  public.leaderboard_top(uuid, text, text, boolean, int) to anon, authenticated;
grant execute on function public.my_discoveries(), public.point_days_this_month(), public.redeem_points(text) to authenticated;
