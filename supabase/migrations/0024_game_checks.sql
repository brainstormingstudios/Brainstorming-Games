-- 0024_game_checks: inputs for the stronger auto-review (supabase/functions/_shared/autoReview.ts).
--
-- Each build records a fingerprint (SHA-256, first 32 hex) of every art, audio, model and video
-- file, so the auto-review can tell when a submission reuses another studio's assets.

alter table public.game_versions add column asset_hashes text[];
create index game_versions_asset_hashes_idx on public.game_versions using gin (asset_hashes);

/** The developer's upload records its asset fingerprints once (owner only). */
create or replace function public.set_asset_hashes(p_version uuid, p_hashes text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  select game_id into v_game from public.game_versions where id = p_version;
  if v_game is null or not app.owns_game(v_game) then perform app.fail('not_allowed'); end if;
  if coalesce(array_length(p_hashes, 1), 0) > 2000
     or exists (select 1 from unnest(p_hashes) h where h !~ '^[0-9a-f]{32}$') then
    perform app.fail('invalid');
  end if;
  update public.game_versions set asset_hashes = (select array_agg(distinct h) from unnest(p_hashes) h)
  where id = p_version and asset_hashes is null;
end $$;

/**
 * For the submit-game Edge Function (service role): other studios' released games that share
 * asset files with this version, and how many, most first.
 */
create or replace function public.asset_overlaps(p_version uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v record;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  select gv.asset_hashes, g.studio_id into v from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version;
  if v.asset_hashes is null then return jsonb_build_object('count', 0, 'overlaps', '[]'::jsonb); end if;
  return jsonb_build_object(
    'count', coalesce(array_length(v.asset_hashes, 1), 0),
    'overlaps', coalesce((
      select jsonb_agg(jsonb_build_object('title', x.title, 'studioId', x.studio_id, 'shared', x.shared) order by x.shared desc)
      from (
        select g.title, g.studio_id, max(cardinality(array(select unnest(o.asset_hashes) intersect select unnest(v.asset_hashes)))) as shared
        from public.game_versions o
        join public.games g on g.id = o.game_id
        where o.asset_hashes && v.asset_hashes and g.studio_id <> v.studio_id and g.released_at is not null
        group by g.id, g.title, g.studio_id
        order by 3 desc
        limit 5
      ) x
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.set_asset_hashes(uuid, text[]), public.asset_overlaps(uuid) from public, anon;
grant execute on function public.set_asset_hashes(uuid, text[]) to authenticated;
grant execute on function public.asset_overlaps(uuid) to authenticated, service_role;
