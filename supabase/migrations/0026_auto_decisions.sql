-- 0026: automatic decisions, so moderators only see what needs a person.
--
-- 1. Developers only upload and submit: no checks run on the developer side. Submitting closes
--    the uploads, and submit-game then starts the test-play (pre-QA) on the server; its report
--    goes to the moderators.
-- 2. Clear copies are rejected at once (submit-game decides with the shared auto-review rules:
--    copied build, cover, art or text, a protected name, or no rights declaration). Borderline
--    findings still go to a person.
-- 3. Harmful code found by the test-play (crypto-mining, password or card fields, outside ad
--    networks) rejects the build at once, before or after submission.
-- Automatic rejections are recorded like a moderator's, with no reviewer and checklist
-- {"automatic": true}, and the developer is told why.

/** Rejects a version without a moderator. Does nothing to approved or already rejected versions. */
create or replace function app.auto_reject(p_version uuid, p_notes text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select gv.id, gv.game_id, gv.qa_status, g.status as game_status into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version;
  if v.id is null or v.qa_status in ('approved', 'rejected') then return false; end if;
  insert into public.qa_reviews (version_id, game_id, reviewer_id, action, checklist, notes)
  values (p_version, v.game_id, null, 'reject', '{"automatic": true}'::jsonb, p_notes);
  update public.game_versions set qa_status = 'rejected', qa_notes = p_notes where id = p_version;
  if v.game_status = 'in_review' then
    update public.games set status = 'draft', updated_at = now() where id = v.game_id;
  end if;
  perform app.notify(app.game_owner(v.game_id), 'qa', 'Submission rejected automatically', p_notes,
    '/dev/games/view/?id=' || v.game_id);
  perform app.audit('qa_auto_reject', 'game_version', p_version::text, jsonb_build_object('game_id', v.game_id, 'notes', p_notes));
  return true;
end $$;
revoke all on function app.auto_reject(uuid, text) from public, anon, authenticated;

/** The reason when a test-play report found harmful code, or null (mirror of harmfulReason). */
create or replace function app.harmful_reason(p_report jsonb) returns text
language sql immutable set search_path = '' as $$
  select 'Rejected automatically: the test-play found '
    || string_agg(regexp_replace(lower(c ->> 'label'), '^no ', '') || ' (' || (c ->> 'detail') || ')', '; ')
    || '.'
  from jsonb_array_elements(coalesce(p_report -> 'checks', '[]'::jsonb)) c
  where c ->> 'status' = 'fail' and c ->> 'id' in ('no-mining', 'no-credentials', 'external-ads')
  having count(*) > 0
$$;

/**
 * Stores a test-play report. Before submission it moves the version to pre_qa_passed / warn /
 * failed as before; once submitted (or decided) it only stores the report for the moderators.
 * Harmful code rejects the version at once. Close minor updates of live games still publish.
 */
create or replace function public.set_pre_qa_report(p_version_id uuid, p_report jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_status text := coalesce(p_report ->> 'status', 'fail');
  v record;
  v_new public.qa_status;
  v_harm text := app.harmful_reason(p_report);
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  select gv.id, gv.game_id, gv.minor_update, gv.qa_status, g.status as game_status into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version_id;
  if v.id is null then perform app.fail('not_found'); end if;
  if v.qa_status in ('uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed') then
    v_new := case v_status when 'pass' then 'pre_qa_passed' when 'warn' then 'pre_qa_warn' else 'pre_qa_failed' end;
  else
    v_new := v.qa_status;
  end if;
  update public.game_versions set pre_qa_report = p_report, qa_status = v_new,
    uses_sdk = coalesce((p_report ->> 'usesSdk')::boolean, uses_sdk)
  where id = p_version_id;
  if v_harm is not null and app.auto_reject(p_version_id, v_harm) then
    return 'rejected';
  end if;
  if app.minor_update_ok(p_version_id) and app.take_token('minor_publish:' || v.game_id::text, 3, 604800) then
    perform app.publish_version(p_version_id);
    perform app.notify(app.game_owner(v.game_id), 'version', 'Update published',
      'Your minor update passed pre-QA and is live.', '/dev/games/view/?id=' || v.game_id);
    return 'approved';
  end if;
  return v_new::text;
end $$;

/**
 * Submits the latest build as soon as it is uploaded; the checks run afterwards on the server.
 * Submitting closes the build's uploads, so nothing can be added after the checks.
 */
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
  update public.game_versions set qa_status = 'in_review', declaration = p_declaration, auto_review = null,
    last_presign_at = case when last_presign_at > now() - interval '7 minutes' then now() - interval '7 minutes' else last_presign_at end
  where id = v.id;
  if g.status in ('draft', 'changes_requested', 'paused') then
    update public.games set status = 'in_review', updated_at = now() where id = p_game_id;
  end if;
  return v.id;
end $$;

/**
 * For submit-game (service role): stores the auto-review and, when it found a clear copy
 * (p_reject_reason, from the shared autoRejectReason), rejects the submission at once.
 */
create or replace function public.apply_auto_review(p_version uuid, p_report jsonb, p_reject_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then perform app.fail('not_allowed'); end if;
  update public.game_versions set auto_review = p_report where id = p_version;
  if nullif(trim(coalesce(p_reject_reason, '')), '') is not null
     and (select qa_status from public.game_versions where id = p_version) = 'in_review'
     and app.auto_reject(p_version, p_reject_reason) then
    return 'rejected';
  end if;
  return (select qa_status::text from public.game_versions where id = p_version);
end $$;

revoke all on function public.apply_auto_review(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_auto_review(uuid, jsonb, text) to service_role;

/** For the pre-qa-dispatch function: whether the caller is staff with the owner code. */
create or replace function public.is_staff_session() returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_staff() $$;
revoke all on function public.is_staff_session() from public, anon;
grant execute on function public.is_staff_session() to authenticated;
