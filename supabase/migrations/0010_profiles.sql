-- 0010_profiles: the public profile page and the caller's own progress feeds.

/**
 * A public profile: only for players who chose a public profile and are adults or have parental
 * consent. Favourites and recent games are limited to released games.
 */
create or replace function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar', p.avatar_cosmetics,
    'level', p.level, 'brain_points', p.brain_points, 'streak_days', p.streak_days, 'created_at', p.created_at,
    'favourites', coalesce((select jsonb_agg(f.game_id order by f.created_at desc)
      from public.favorites f join public.games g on g.id = f.game_id
      where f.user_id = p.id and g.status in ('spark', 'rise', 'featured')), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(h.game_id order by h.last_played_at desc)
      from (select * from public.play_history h where h.user_id = p.id order by h.last_played_at desc limit 12) h
      join public.games g on g.id = h.game_id where g.status in ('spark', 'rise', 'featured')), '[]'::jsonb),
    'games_played', (select count(*) from public.play_history h where h.user_id = p.id),
    'minutes_played', (select coalesce(sum(h.seconds_played), 0) / 60 from public.play_history h where h.user_id = p.id),
    'quests_completed', (select count(*) from public.brain_point_ledger l where l.user_id = p.id and l.reason = 'quest')
  )
  from public.profiles p
  where p.username = lower(p_username) and p.banned_at is null
    and ((p.profile_public and (not p.is_minor or p.parental_consent_status = 'granted')) or p.id = auth.uid());
$$;

grant execute on function public.public_profile(text) to anon, authenticated;
