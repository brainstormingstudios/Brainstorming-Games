-- 0027: the Verified tick for studios, and BS Originals published by the house studio.
--
-- Verified tick (studios.verified, already shown as a tick on game and studio pages):
-- - paid: ₹49 a month or ₹399 a year (billing function, Razorpay order; extends verified_until);
-- - founding studios: the first 100 studios get it free for their first year;
-- - staff can still set it by hand (admin_set_studio), which never expires.
-- Benefits: the tick, a 24-hour review promise instead of 72 (and a free Boost if we are late),
-- a "Verified studios" row on the home page, and one free Spotlight Boost a month.
--
-- BS Originals: games from the first-party studio (is_first_party). The house studio,
-- BrainStorming Studios, is first party and wears its own "BS Official" badge; its submissions
-- are approved automatically once the test-play is clean (pass or warn, nothing harmful).

alter table public.studios
  add column verified_until timestamptz,
  add column verified_source text check (verified_source in ('founding', 'paid', 'staff')),
  add column founding_number int;

-- ---- The house studio ------------------------------------------------------------------------------
update public.studios set is_first_party = true, verified = true, verified_source = 'staff'
where slug = 'brainstorming-studios';

-- ---- Founding studios --------------------------------------------------------------------------------
/** The first 100 (non-house) studios get the tick free for a year. */
create or replace function app.founding_studio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if new.is_first_party then return new; end if;
  select coalesce(max(founding_number), 0) + 1 into v_n from public.studios;
  if v_n <= 100 then
    new.founding_number := v_n;
    new.verified := true;
    new.verified_source := 'founding';
    new.verified_until := now() + interval '1 year';
  end if;
  return new;
end $$;
create trigger studios_founding before insert on public.studios
  for each row execute function app.founding_studio();

-- Studios that already exist count as founding studios too, oldest first.
with ranked as (
  select id, row_number() over (order by created_at) as n from public.studios where not is_first_party
)
update public.studios s set founding_number = r.n, verified = true, verified_source = 'founding',
  verified_until = now() + interval '1 year'
from ranked r where r.id = s.id and r.n <= 100;

/**
 * Gives or extends the paid tick (billing webhook, service role): `p_days` from the later of now
 * and the current end. A founding studio that pays keeps its free year and adds the paid days.
 */
create or replace function public.extend_verified(p_studio uuid, p_days int)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz;
begin
  if auth.role() <> 'service_role' then perform app.fail('not_allowed'); end if;
  if p_days not in (30, 365) then perform app.fail('invalid'); end if;
  update public.studios
  set verified = true,
      verified_source = case when verified_source = 'staff' then 'staff' else 'paid' end,
      verified_until = greatest(coalesce(verified_until, now()), now()) + make_interval(days => p_days)
  where id = p_studio
  returning verified_until into v_until;
  if v_until is null then perform app.fail('not_found'); end if;
  perform app.notify((select owner_id from public.studios where id = p_studio), 'verified', 'Your Verified tick is active',
    'Verified until ' || to_char(v_until, 'DD Mon YYYY') || '. Thank you for supporting Brainstorming Games.', '/dev/verified/');
  perform app.audit('verified_paid', 'studio', p_studio::text, jsonb_build_object('days', p_days, 'until', v_until));
  return v_until;
end $$;
revoke all on function public.extend_verified(uuid, int) from public, anon, authenticated;
grant execute on function public.extend_verified(uuid, int) to service_role;

/** The developer's own tick: whether it is on, why, and until when. */
create or replace function public.my_verified()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('verified', s.verified, 'source', s.verified_source, 'until', s.verified_until,
    'foundingNumber', s.founding_number, 'firstParty', s.is_first_party)
  from public.studios s where s.owner_id = auth.uid() limit 1
$$;
revoke all on function public.my_verified() from public, anon;
grant execute on function public.my_verified() to authenticated;

-- ---- Daily: expiry and the monthly free Boost ----------------------------------------------------------
alter table public.boost_credits alter column version_id drop not null;
alter table public.boost_credits drop constraint if exists boost_credits_reason_check;

/** Ends ticks that ran out, and gives every verified studio its free Boost once a month. */
create or replace function app.verified_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; v_count int := 0;
begin
  for s in update public.studios set verified = false
    where verified and verified_source in ('founding', 'paid') and verified_until < now()
    returning id, owner_id
  loop
    perform app.notify(s.owner_id, 'verified', 'Your Verified tick has ended',
      'Renew it for ₹49 a month or ₹399 a year to keep the tick and its benefits.', '/dev/verified/');
  end loop;
  for s in select st.id, st.owner_id from public.studios st
    where st.verified and not st.is_first_party and st.suspended_at is null
      and not exists (select 1 from public.boost_credits c where c.studio_id = st.id and c.reason = 'verified_monthly'
                      and c.created_at >= date_trunc('month', now()))
  loop
    insert into public.boost_credits (studio_id, version_id, reason) values (s.id, null, 'verified_monthly');
    perform app.notify(s.owner_id, 'boost', 'Your free monthly Boost is here',
      'A Verified perk: one free Spotlight Boost this month. Use it on the Boost page.', '/dev/boost/');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int; v_rank int; v_reports int := 0; v_credits int; v_payouts int; v_alerts int; v_verified int;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  v_kpis := public.refresh_daily_game_kpis(current_date - 1);
  perform public.refresh_daily_game_kpis(current_date);
  v_ab := public.pick_ab_winners();
  v_rank := public.refresh_rank_scores();
  v_alerts := app.scan_fraud();
  delete from public.parties where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 days';
  delete from public.security_alerts where resolved_at < now() - interval '400 days';
  if extract(isodow from current_date) = 1 then v_reports := app.weekly_brain_reports(); end if;
  v_credits := app.grant_overdue_review_credits();
  v_payouts := app.promote_payout_profiles();
  v_verified := app.verified_daily();
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab, 'games_ranked', v_rank,
    'brain_reports', v_reports, 'review_credits', v_credits, 'payout_details_promoted', v_payouts, 'alerts', v_alerts,
    'verified_boosts', v_verified);
end $$;

-- ---- 24-hour review promise for verified studios -------------------------------------------------------
/** Hours a person has to review this version: 24 for a verified studio, 72 otherwise. */
create or replace function app.review_sla_hours(p_version uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when s.verified then 24 else 72 end
  from public.game_versions v join public.games g on g.id = v.game_id join public.studios s on s.id = g.studio_id
  where v.id = p_version
$$;

create or replace function app.on_version_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.qa_status = 'in_review' and old.qa_status is distinct from 'in_review' then
    new.submitted_at := now();
    new.reviewed_at := null;
  elsif old.qa_status = 'in_review' and new.qa_status is distinct from 'in_review' then
    new.reviewed_at := now();
    if old.submitted_at is not null and now() > old.submitted_at + make_interval(hours => coalesce(app.review_sla_hours(new.id), 72)) then
      perform app.grant_review_credit(new.id);
    end if;
  end if;
  return new;
end $$;

create or replace function app.grant_overdue_review_credits()
returns int language plpgsql security definer set search_path = '' as $$
declare v record; v_count int := 0;
begin
  for v in select id from public.game_versions
    where qa_status = 'in_review' and submitted_at < now() - interval '24 hours'
      and submitted_at < now() - make_interval(hours => coalesce(app.review_sla_hours(game_versions.id), 72))
      and not exists (select 1 from public.boost_credits c where c.version_id = game_versions.id)
  loop
    perform app.grant_review_credit(v.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---- BS Originals: automatic approval ------------------------------------------------------------------
/** Approves a house-studio version without a moderator (mirror of qa_decide's approve). */
create or replace function app.auto_approve(p_version uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v record; v_first boolean;
begin
  select gv.id, gv.game_id, gv.qa_status, g.status as game_status, g.released_at into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version;
  if v.id is null or v.qa_status <> 'in_review' then return false; end if;
  insert into public.qa_reviews (version_id, game_id, reviewer_id, action, checklist, notes)
  values (p_version, v.game_id, null, 'approve', '{"automatic": true}'::jsonb, 'BS Original: approved automatically after a clean test-play.');
  v_first := v.released_at is null or v.game_status in ('in_review', 'draft', 'changes_requested', 'paused');
  perform app.publish_version(p_version);
  if v_first then
    update public.games set status = 'spark', spark_started_at = now(), released_at = coalesce(released_at, now()), updated_at = now()
    where id = v.game_id;
    insert into public.game_launches (game_id, tier) values (v.game_id, 'spark');
    insert into public.game_stats (game_id) values (v.game_id) on conflict do nothing;
  end if;
  perform app.notify(app.game_owner(v.game_id), 'qa', 'BS Original published',
    'Your game passed its test-play and is live in BS Originals.', '/dev/games/view/?id=' || v.game_id);
  perform app.audit('qa_auto_approve', 'game_version', p_version::text, jsonb_build_object('game_id', v.game_id));
  return true;
end $$;
revoke all on function app.auto_approve(uuid) from public, anon, authenticated;

/** True when the version belongs to the house studio. */
create or replace function app.is_original(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.is_first_party from public.game_versions v join public.games g on g.id = v.game_id
    join public.studios s on s.id = g.studio_id where v.id = p_version), false)
$$;

-- set_pre_qa_report (0026) plus: a clean report on a submitted house-studio version publishes it.
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
  if v_new = 'in_review' and v_status in ('pass', 'warn') and app.is_original(p_version_id) and app.auto_approve(p_version_id) then
    return 'approved';
  end if;
  if app.minor_update_ok(p_version_id) and app.take_token('minor_publish:' || v.game_id::text, 3, 604800) then
    perform app.publish_version(p_version_id);
    perform app.notify(app.game_owner(v.game_id), 'version', 'Update published',
      'Your minor update passed pre-QA and is live.', '/dev/games/view/?id=' || v.game_id);
    return 'approved';
  end if;
  return v_new::text;
end $$;

-- Paid ticks are recorded as payments of their own kind.
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('premium', 'boost', 'verified'));

-- A tick set by staff never expires; switching it off clears where it came from.
create or replace function public.admin_set_studio(
  p_studio uuid, p_suspended boolean default null, p_verified boolean default null,
  p_level public.studio_level default null, p_first_party boolean default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  update public.studios set
    suspended_at = case when p_suspended is null then suspended_at when p_suspended then now() else null end,
    verified = coalesce(p_verified, verified),
    verified_source = case when p_verified is null then verified_source when p_verified then 'staff' else null end,
    verified_until = case when p_verified is null then verified_until when p_verified then null else verified_until end,
    level = coalesce(p_level, level),
    is_first_party = coalesce(p_first_party, is_first_party)
  where id = p_studio;
  perform app.audit('set_studio', 'studio', p_studio::text,
    jsonb_build_object('suspended', p_suspended, 'verified', p_verified, 'level', p_level, 'first_party', p_first_party));
end $$;
