-- 0003_devportal_qa: studio onboarding, versions, pre-QA, review, launch tiers, moderation.

alter table public.game_versions add column minor_update boolean not null default false;
alter table public.games add column wants_exclusive boolean not null default false;

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.qa_reviews (
  id bigint generated always as identity primary key,
  version_id uuid not null references public.game_versions (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  reviewer_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('approve', 'changes', 'reject')),
  checklist jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.game_launches (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  tier text not null check (tier in ('spark', 'rise', 'featured')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  decision text check (decision in ('promoted', 'declined')),
  reason text,
  kpi_snapshot jsonb,
  decided_by uuid references auth.users (id) on delete set null
);
create index game_launches_game_idx on public.game_launches (game_id, started_at desc);

create table public.reports (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('abuse', 'username', 'studio', 'devlog', 'game', 'score')),
  target_type text not null,
  target_id text not null,
  reporter_key text not null,
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.feedback (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  version_id uuid references public.game_versions (id) on delete set null,
  reporter_key text not null,
  category text not null check (category in ('bug', 'wont-load', 'controls', 'content', 'other')),
  message text not null check (char_length(message) between 5 and 2000),
  context jsonb,
  device text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index feedback_game_idx on public.feedback (game_id, created_at desc);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.qa_reviews enable row level security;
alter table public.game_launches enable row level security;
alter table public.reports enable row level security;
alter table public.feedback enable row level security;
alter table public.admin_audit_log enable row level security;

create policy notifications_select on public.notifications for select using (user_id = auth.uid());
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete using (user_id = auth.uid());
create policy qa_reviews_select on public.qa_reviews for select using (app.owns_game(game_id) or app.is_staff());
create policy launches_select on public.game_launches for select using (app.owns_game(game_id) or app.is_staff());
create policy reports_select on public.reports for select using (app.is_staff());
create policy feedback_select on public.feedback for select using (app.owns_game(game_id) or app.is_staff());
create policy feedback_update on public.feedback for update using (app.owns_game(game_id) or app.is_staff())
  with check (app.owns_game(game_id) or app.is_staff());
-- The audit log is append-only: staff can read it, nobody can change it through the API.
create policy audit_select on public.admin_audit_log for select using (app.is_staff());

create or replace function app.audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (actor_id, action, target_type, target_id, detail)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function app.notify(p_user uuid, p_kind text, p_title text, p_body text default '', p_link text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p_user, p_kind, p_title, coalesce(p_body, ''), p_link where p_user is not null;
$$;

create or replace function app.game_owner(p_game uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.owner_id from public.games g join public.studios s on s.id = g.studio_id where g.id = p_game;
$$;

-- ---------------------------------------------------------------------------------------------
-- Studio onboarding
-- ---------------------------------------------------------------------------------------------
/**
 * Creates the caller's studio. The account holder must be 18+, a company, or a minor with a
 * guardian named here; the accepted developer-terms version is recorded.
 */
create or replace function public.create_studio(
  p_name text, p_slug text, p_country text, p_contact_email text,
  p_terms_version text, p_holder text, p_guardian_name text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if coalesce(p_terms_version, '') = '' then perform app.fail('invalid'); end if;
  if p_holder not in ('adult', 'company', 'minor_with_guardian') then perform app.fail('invalid'); end if;
  if p_holder = 'minor_with_guardian' and char_length(coalesce(trim(p_guardian_name), '')) < 3 then
    perform app.fail('invalid');
  end if;
  if exists (select 1 from public.studios where owner_id = auth.uid()) then perform app.fail('conflict'); end if;
  perform app.guard('create_studio', auth.uid()::text, 3, 3600);
  insert into public.studios (owner_id, name, slug, country, contact_email, terms_version, terms_accepted_at, guardian_name)
  values (auth.uid(), trim(p_name), lower(p_slug), upper(p_country), p_contact_email, p_terms_version, now(),
          case when p_holder = 'minor_with_guardian' then trim(p_guardian_name) end)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Versions and pre-QA
-- ---------------------------------------------------------------------------------------------
/** Registers an uploaded build. Returns the version id and a one-time private preview token. */
create or replace function public.add_game_version(
  p_game_id uuid, p_version text, p_file_count int, p_total_bytes bigint,
  p_entry_file text default 'index.html', p_uses_sdk boolean default false, p_minor_update boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not app.owns_game(p_game_id) then perform app.fail('not_allowed'); end if;
  if p_entry_file !~ '^[A-Za-z0-9._-]+\.html?$' then perform app.fail('invalid'); end if;
  perform app.guard('add_version', auth.uid()::text, 20, 3600);
  insert into public.game_versions
    (game_id, version, storage_prefix, file_count, total_bytes, entry_file, uses_sdk, minor_update, preview_token_hash, created_by)
  values
    (p_game_id, p_version, p_game_id::text || '/' || p_version, p_file_count, p_total_bytes, p_entry_file,
     p_uses_sdk, p_minor_update, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), auth.uid())
  returning id into v_id;
  update public.games set updated_at = now() where id = p_game_id;
  return jsonb_build_object('version_id', v_id, 'preview_token', v_token, 'storage_prefix', p_game_id::text || '/' || p_version);
end $$;

/** Resolves a private preview link. Anyone holding the token can load that one build. */
create or replace function public.preview_version(p_version_id uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('game_id', g.id, 'title', g.title, 'slug', g.slug, 'orientation', g.orientation,
    'version_id', v.id, 'version', v.version, 'storage_prefix', v.storage_prefix, 'entry_file', v.entry_file,
    'uses_sdk', v.uses_sdk)
  from public.game_versions v join public.games g on g.id = v.game_id
  where v.id = p_version_id
    and v.preview_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
$$;

create or replace function app.publish_version(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select gv.*, g.status as game_status, g.released_at as game_released_at into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version;
  update public.game_versions set qa_status = 'approved' where id = p_version;
  update public.games set
    current_version_id = p_version,
    size_bytes = v.total_bytes,
    initial_load_bytes = coalesce((v.pre_qa_report -> 'desktop' ->> 'initialBytes')::bigint, initial_load_bytes),
    updated_at = now()
  where id = v.game_id;
end $$;

/**
 * Stores the pre-QA bot's report. Called by the pre-qa-report Edge Function (service role).
 * A clean report on a minor update of a Rise or Featured game publishes it straight away.
 */
create or replace function public.set_pre_qa_report(p_version_id uuid, p_report jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_status text := coalesce(p_report ->> 'status', 'fail');
  v record;
  v_new public.qa_status;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  select gv.id, gv.game_id, gv.minor_update, gv.qa_status, g.status as game_status into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version_id;
  if v.id is null then perform app.fail('not_found'); end if;
  v_new := case v_status when 'pass' then 'pre_qa_passed' when 'warn' then 'pre_qa_warn' else 'pre_qa_failed' end;
  update public.game_versions set pre_qa_report = p_report, qa_status = v_new,
    uses_sdk = coalesce((p_report ->> 'usesSdk')::boolean, uses_sdk)
  where id = p_version_id;
  if v_status = 'pass' and v.minor_update and v.game_status in ('rise', 'featured') then
    perform app.publish_version(p_version_id);
    perform app.notify(app.game_owner(v.game_id), 'version', 'Update published',
      'Your minor update passed pre-QA and is live.', '/dev/games/view/?id=' || v.game_id);
    return 'approved';
  end if;
  perform app.notify(app.game_owner(v.game_id), 'pre_qa', 'Pre-QA report ready',
    'Result: ' || v_status, '/dev/games/view/?id=' || v.game_id);
  return v_new::text;
end $$;

/** Marks a version as queued for the pre-QA bot. */
create or replace function public.mark_pre_qa_running(p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.game_versions v where v.id = p_version_id and (app.owns_game(v.game_id) or app.is_staff()))
     and auth.role() <> 'service_role' then
    perform app.fail('not_allowed');
  end if;
  update public.game_versions set qa_status = 'pre_qa_running' where id = p_version_id and qa_status = 'uploaded';
end $$;

/** Developer submits the newest version of a game for human review. */
create or replace function public.submit_for_review(p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v record; g record;
begin
  if not app.owns_game(p_game_id) then perform app.fail('not_allowed'); end if;
  select * into g from public.games where id = p_game_id;
  select * into v from public.game_versions where game_id = p_game_id order by created_at desc limit 1;
  if v.id is null then perform app.fail('invalid'); end if;
  if v.qa_status not in ('pre_qa_passed', 'pre_qa_warn') then perform app.fail('invalid'); end if;
  if jsonb_array_length(g.faq) < 3 or g.short_description = '' or g.description_md = '' then
    perform app.fail('invalid');
  end if;
  if not exists (select 1 from public.game_media m where m.game_id = p_game_id and m.kind = 'cover_landscape' and m.is_active) then
    perform app.fail('invalid');
  end if;
  update public.game_versions set qa_status = 'in_review' where id = v.id;
  if g.status in ('draft', 'changes_requested', 'paused') then
    update public.games set status = 'in_review', updated_at = now() where id = p_game_id;
  end if;
  return v.id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Human review
-- ---------------------------------------------------------------------------------------------
create or replace function public.qa_decide(
  p_version_id uuid, p_action text, p_notes text default '', p_checklist jsonb default '{}'::jsonb,
  p_school_safe boolean default false
) returns text language plpgsql security definer set search_path = '' as $$
declare v record; v_first boolean;
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if p_action not in ('approve', 'changes', 'reject') then perform app.fail('invalid'); end if;
  if p_action <> 'approve' and char_length(trim(coalesce(p_notes, ''))) < 10 then perform app.fail('invalid'); end if;
  select gv.id, gv.game_id, g.status as game_status, g.released_at into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version_id;
  if v.id is null then perform app.fail('not_found'); end if;

  insert into public.qa_reviews (version_id, game_id, reviewer_id, action, checklist, notes)
  values (p_version_id, v.game_id, auth.uid(), p_action, coalesce(p_checklist, '{}'::jsonb), coalesce(p_notes, ''));

  if p_action = 'approve' then
    v_first := v.released_at is null or v.game_status in ('in_review', 'draft', 'changes_requested', 'paused');
    perform app.publish_version(p_version_id);
    update public.game_versions set qa_notes = nullif(trim(p_notes), '') where id = p_version_id;
    update public.games set school_safe = coalesce(p_school_safe, false) where id = v.game_id;
    if v_first then
      -- A first approval, or a resubmission after a declined Spark, starts a new Basic Launch.
      update public.games set status = 'spark', spark_started_at = now(),
        released_at = coalesce(released_at, now()), updated_at = now()
      where id = v.game_id;
      insert into public.game_launches (game_id, tier) values (v.game_id, 'spark');
      insert into public.game_stats (game_id) values (v.game_id) on conflict do nothing;
      perform app.notify(app.game_owner(v.game_id), 'qa', 'Approved: your Basic Launch has started',
        'Your game is live with ads off while we measure how players respond.', '/dev/games/view/?id=' || v.game_id);
    else
      perform app.notify(app.game_owner(v.game_id), 'qa', 'Update approved', 'Your new version is live.',
        '/dev/games/view/?id=' || v.game_id);
    end if;
  elsif p_action = 'changes' then
    update public.game_versions set qa_status = 'changes_requested', qa_notes = p_notes where id = p_version_id;
    if v.game_status = 'in_review' then
      update public.games set status = 'changes_requested', updated_at = now() where id = v.game_id;
    end if;
    perform app.notify(app.game_owner(v.game_id), 'qa', 'Changes requested', p_notes, '/dev/games/view/?id=' || v.game_id);
  else
    update public.game_versions set qa_status = 'rejected', qa_notes = p_notes where id = p_version_id;
    if v.game_status = 'in_review' then
      update public.games set status = 'draft', updated_at = now() where id = v.game_id;
    end if;
    perform app.notify(app.game_owner(v.game_id), 'qa', 'Submission rejected', p_notes, '/dev/games/view/?id=' || v.game_id);
  end if;
  perform app.audit('qa_' || p_action, 'game_version', p_version_id::text,
    jsonb_build_object('game_id', v.game_id, 'notes', p_notes, 'school_safe', p_school_safe));
  return p_action;
end $$;

/**
 * Ends a Basic Launch. Promotion needs the SDK; a decline needs a written reason that names the
 * KPI that fell short. The KPI snapshot is stored with the decision either way.
 */
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
      exclusive_until = case when wants_exclusive then now() + interval '60 days' end
    where id = p_game_id;
    insert into public.game_launches (game_id, tier) values (p_game_id, 'rise');
    perform app.notify(app.game_owner(p_game_id), 'launch', 'You are invited to Full Launch', p_reason,
      '/dev/games/view/?id=' || p_game_id);
  else
    update public.games set status = 'paused', updated_at = now() where id = p_game_id;
    perform app.notify(app.game_owner(p_game_id), 'launch', 'Basic Launch ended', p_reason,
      '/dev/games/view/?id=' || p_game_id);
  end if;
  perform app.audit(case when p_promote then 'spark_promote' else 'spark_decline' end, 'game', p_game_id::text,
    jsonb_build_object('reason', p_reason, 'kpis', p_kpis));
  return case when p_promote then 'rise' else 'paused' end;
end $$;

/** One-click rollback to an earlier approved version of the same game. */
create or replace function public.rollback_version(p_game_id uuid, p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (app.owns_game(p_game_id) or app.is_staff()) then perform app.fail('not_allowed'); end if;
  if not exists (
    select 1 from public.game_versions v
    where v.id = p_version_id and v.game_id = p_game_id and v.qa_status = 'approved'
  ) then perform app.fail('invalid'); end if;
  perform app.publish_version(p_version_id);
  perform app.audit('rollback', 'game', p_game_id::text, jsonb_build_object('version_id', p_version_id));
end $$;

/** Developer pauses or resumes their own live game; staff can also feature or remove it. */
create or replace function public.set_game_status(p_game_id uuid, p_status public.game_status, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  select * into g from public.games where id = p_game_id;
  if g.id is null then perform app.fail('not_found'); end if;
  if app.is_staff() then
    if p_status not in ('rise', 'featured', 'paused', 'removed', 'spark') then perform app.fail('invalid'); end if;
  elsif app.owns_game(p_game_id) then
    if not (p_status = 'paused' and g.status in ('spark', 'rise', 'featured'))
       and not (p_status = 'removed') then
      perform app.fail('not_allowed');
    end if;
  else
    perform app.fail('not_allowed');
  end if;
  update public.games set status = p_status, updated_at = now() where id = p_game_id;
  perform app.audit('set_game_status', 'game', p_game_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Feedback, reports, moderation
-- ---------------------------------------------------------------------------------------------
create or replace function public.send_feedback(
  p_game_id uuid, p_version_id uuid, p_category text, p_message text, p_context jsonb, p_device text, p_anon_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := app.caller_key(p_anon_id);
begin
  if v_key is null then perform app.fail('invalid'); end if;
  perform app.guard('feedback', v_key, 5, 600);
  if pg_column_size(coalesce(p_context, '{}'::jsonb)) > 8192 then p_context := null; end if;
  insert into public.feedback (game_id, version_id, reporter_key, category, message, context, device)
  values (p_game_id, p_version_id, v_key, p_category, trim(p_message), p_context, p_device);
end $$;

create or replace function public.report_content(p_kind text, p_target_type text, p_target_id text, p_reason text, p_anon_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := app.caller_key(p_anon_id);
begin
  if v_key is null then perform app.fail('invalid'); end if;
  perform app.guard('report', v_key, 5, 600);
  insert into public.reports (kind, target_type, target_id, reporter_key, reason)
  values (p_kind, p_target_type, p_target_id, v_key, coalesce(p_reason, ''));
end $$;

create or replace function public.admin_resolve_report(p_report_id bigint, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  update public.reports set status = p_status, resolved_by = auth.uid(), resolved_at = now() where id = p_report_id;
  perform app.audit('resolve_report', 'report', p_report_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_user(p_user uuid, p_banned boolean default null, p_role public.user_role default null, p_reset_username boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if p_role is not null and not app.is_admin() then perform app.fail('not_allowed'); end if;
  update public.profiles set
    banned_at = case when p_banned is null then banned_at when p_banned then now() else null end,
    role = coalesce(p_role, role),
    username = case when p_reset_username then 'player_' || substr(replace(id::text, '-', ''), 1, 10) else username end,
    display_name = case when p_reset_username then '' else display_name end
  where id = p_user;
  perform app.audit('set_user', 'user', p_user::text,
    jsonb_build_object('banned', p_banned, 'role', p_role, 'reset_username', p_reset_username));
end $$;

create or replace function public.admin_set_studio(
  p_studio uuid, p_suspended boolean default null, p_verified boolean default null,
  p_level public.studio_level default null, p_first_party boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  update public.studios set
    suspended_at = case when p_suspended is null then suspended_at when p_suspended then now() else null end,
    verified = coalesce(p_verified, verified),
    level = coalesce(p_level, level),
    is_first_party = coalesce(p_first_party, is_first_party)
  where id = p_studio;
  perform app.audit('set_studio', 'studio', p_studio::text,
    jsonb_build_object('suspended', p_suspended, 'verified', p_verified, 'level', p_level, 'first_party', p_first_party));
end $$;

create or replace function public.admin_set_site_config(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  update public.site_config set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then perform app.fail('not_found'); end if;
  perform app.audit('set_site_config', 'site_config', p_key, p_value);
end $$;

-- A change to what the public can see asks for a (debounced) site rebuild.
create or replace function app.request_deploy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.current_version_id is not distinct from old.current_version_id
     and new.title = old.title and new.description_md = old.description_md then
    return new;
  end if;
  if new.released_at is not null then
    update public.site_config
      set value = jsonb_set(value, '{lastRequestedAt}', to_jsonb(now()::text))
    where key = 'deploy';
  end if;
  return new;
end $$;
create trigger games_request_deploy after insert or update on public.games
  for each row execute function app.request_deploy();
