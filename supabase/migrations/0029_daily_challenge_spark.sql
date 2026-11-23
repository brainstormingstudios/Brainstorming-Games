-- 0029: the daily challenge also picks games still in their Basic Launch (spark) when no game has
-- reached Full Launch yet; featured and rise games still come first. Before, a young catalogue
-- (every game in spark) had no daily challenge at all.
create or replace function public.daily_challenge()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select g.id, g.status,
      (select l.key from public.leaderboards l where l.game_id = g.id order by l.created_at limit 1) as board
    from public.games g
    join public.studios s on s.id = g.studio_id and s.suspended_at is null
    where g.released_at is not null and g.status in ('rise', 'featured', 'spark')
  )
  select jsonb_build_object('day', to_char(current_date, 'YYYY-MM-DD'), 'gameId', id, 'board', board)
  from c
  order by (status = 'spark'), (board is null), md5(id::text || current_date::text)
  limit 1;
$$;
