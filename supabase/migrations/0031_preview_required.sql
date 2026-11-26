-- 0031: the preview is a required step. Like a store's QA preview, the developer plays the
-- uploaded build in the preview (with the SDK requirements panel beside it) before submitting;
-- the preview page records it once the game has loaded, and submitting is refused until then.
alter table public.game_versions add column previewed_at timestamptz;

/** The owner opened this build in the preview and it loaded. */
create or replace function public.mark_version_previewed(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  select game_id into v_game from public.game_versions where id = p_version;
  if v_game is null or not app.owns_game(v_game) then perform app.fail('not_allowed'); end if;
  update public.game_versions set previewed_at = coalesce(previewed_at, now()) where id = p_version;
end $$;
revoke all on function public.mark_version_previewed(uuid) from public, anon;
grant execute on function public.mark_version_previewed(uuid) to authenticated;

create or replace function public.submit_for_review(p_game_id uuid, p_declaration jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v record; g record;
begin
  if not app.owns_game(p_game_id) then perform app.fail('not_allowed'); end if;
  select * into g from public.games where id = p_game_id;
  select * into v from public.game_versions where game_id = p_game_id order by created_at desc limit 1;
  if v.id is null then perform app.fail('invalid'); end if;
  if v.qa_status not in ('uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed') then perform app.fail('invalid'); end if;
  if trim(g.title) = '' or g.short_description = '' or g.description_md = ''
     or coalesce(array_length(g.tags, 1), 0) < 3 or jsonb_array_length(g.controls) < 1 then
    perform app.fail('invalid');
  end if;
  if (select count(distinct kind) from public.game_media m where m.game_id = p_game_id and m.is_active
      and m.kind in ('cover_landscape', 'cover_portrait', 'cover_square', 'preview_landscape')) < 4 then
    perform app.fail('invalid');
  end if;
  if coalesce((p_declaration ->> 'ownsRights')::boolean, false) is not true
     or coalesce((p_declaration ->> 'noCopies')::boolean, false) is not true then
    perform app.fail('invalid');
  end if;
  -- Last: the developer must have played this build in the preview (migration 0031).
  if v.previewed_at is null then perform app.fail('preview_required'); end if;
  update public.game_versions set qa_status = 'in_review', declaration = p_declaration, auto_review = null,
    last_presign_at = case when last_presign_at > now() - interval '7 minutes' then now() - interval '7 minutes' else last_presign_at end
  where id = v.id;
  if g.status in ('draft', 'changes_requested', 'paused') then
    update public.games set status = 'in_review', updated_at = now() where id = p_game_id;
  end if;
  return v.id;
end $$;

