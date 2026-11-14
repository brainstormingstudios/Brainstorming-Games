-- 0014_review_and_rules: auto-review before human review, what a submission must include,
-- the 90-day web-exclusive window, and staff tools to delete games and accounts.

alter table public.game_versions
  add column auto_review jsonb,
  add column declaration jsonb,
  add column build_fingerprint text check (build_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.game_media
  add column phash text check (phash ~ '^[0-9a-f]{16}$');
create index game_versions_fingerprint_idx on public.game_versions (build_fingerprint) where build_fingerprint is not null;

/** The developer's own upload records the build's fingerprint (paths and sizes, SHA-256). */
create or replace function public.set_build_fingerprint(p_version uuid, p_fingerprint text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  select game_id into v_game from public.game_versions where id = p_version;
  if v_game is null or not app.owns_game(v_game) then perform app.fail('not_allowed'); end if;
  update public.game_versions set build_fingerprint = lower(p_fingerprint) where id = p_version and build_fingerprint is null;
end $$;

-- What a submission must have: title, short description, description, at least 3 tags, at least
-- one control, all three covers and the landscape preview video, a passing pre-QA, and the rights
-- declaration. FAQ, features, tips and the portrait video are optional.
create or replace function public.submit_for_review(p_game_id uuid, p_declaration jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v record; g record;
begin
  if not app.owns_game(p_game_id) then perform app.fail('not_allowed'); end if;
  select * into g from public.games where id = p_game_id;
  select * into v from public.game_versions where game_id = p_game_id order by created_at desc limit 1;
  if v.id is null then perform app.fail('invalid'); end if;
  if v.qa_status not in ('pre_qa_passed', 'pre_qa_warn') then perform app.fail('invalid'); end if;
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
  update public.game_versions set qa_status = 'in_review', declaration = p_declaration, auto_review = null where id = v.id;
  if g.status in ('draft', 'changes_requested', 'paused') then
    update public.games set status = 'in_review', updated_at = now() where id = p_game_id;
  end if;
  return v.id;
end $$;

-- The web-exclusive window is now 90 days.
create or replace function public.spark_decide(p_game_id uuid, p_promote boolean, p_reason text, p_kpis jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare g record; v_uses_sdk boolean;
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 20 then perform app.fail('invalid'); end if;
  select * into g from public.games where id = p_game_id;
  if g.id is null then perform app.fail('not_found'); end if;
  if g.status <> 'spark' then perform app.fail('invalid'); end if;
  select uses_sdk into v_uses_sdk from public.game_versions where id = g.current_version_id;
  if p_promote and not coalesce(v_uses_sdk, false) then perform app.fail('invalid'); end if;

  update public.game_launches set ended_at = now(), decision = case when p_promote then 'promoted' else 'declined' end,
    reason = p_reason, kpi_snapshot = p_kpis, decided_by = auth.uid()
  where game_id = p_game_id and tier = 'spark' and ended_at is null;

  if p_promote then
    update public.games set status = 'rise', rise_started_at = now(), updated_at = now(),
      exclusive_until = case when wants_exclusive then now() + interval '90 days' end
    where id = p_game_id;
    insert into public.game_launches (game_id, tier) values (p_game_id, 'rise');
    perform app.notify(app.game_owner(p_game_id), 'launch', 'You are invited to Rise Launch', p_reason,
      '/dev/games/view/?id=' || p_game_id);
  else
    update public.games set status = 'paused', updated_at = now() where id = p_game_id;
    perform app.notify(app.game_owner(p_game_id), 'launch', 'Spark Launch ended', p_reason,
      '/dev/games/view/?id=' || p_game_id);
  end if;
  perform app.audit(case when p_promote then 'spark_promote' else 'spark_decline' end, 'game', p_game_id::text,
    jsonb_build_object('reason', p_reason, 'kpis', p_kpis));
  return case when p_promote then 'rise' else 'paused' end;
end $$;

/** Staff: permanently delete a game (its builds, media, stats and history go with it). */
create or replace function public.admin_delete_game(p_game_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid'); end if;
  select title into v_title from public.games where id = p_game_id;
  if v_title is null then perform app.fail('not_found'); end if;
  delete from public.games where id = p_game_id;
  perform app.audit('delete_game', 'game', p_game_id::text, jsonb_build_object('title', v_title, 'reason', p_reason));
end $$;

/** Staff: permanently delete an account (everything tied to it goes with it). Not your own. */
create or replace function public.admin_delete_user(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if p_user = auth.uid() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid'); end if;
  select username into v_name from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  perform app.audit('delete_user', 'user', p_user::text, jsonb_build_object('username', v_name, 'reason', p_reason));
end $$;

revoke execute on function public.submit_for_review(uuid) from public, anon, authenticated;
drop function public.submit_for_review(uuid);
revoke execute on function public.set_build_fingerprint(uuid, text), public.submit_for_review(uuid, jsonb),
  public.admin_delete_game(uuid, text), public.admin_delete_user(uuid, text) from public, anon, authenticated;
grant execute on function public.set_build_fingerprint(uuid, text), public.submit_for_review(uuid, jsonb),
  public.admin_delete_game(uuid, text), public.admin_delete_user(uuid, text) to authenticated, service_role;
grant update (phash) on public.game_media to authenticated;
