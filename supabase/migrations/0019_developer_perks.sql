-- 0019_developer_perks: the 72-hour review promise, free Boost credits when we are late, and
-- sponsored monthly jams with prizes.

-- ---- Review times ----------------------------------------------------------------------------------
alter table public.game_versions add column submitted_at timestamptz, add column reviewed_at timestamptz;
update public.game_versions set submitted_at = created_at where qa_status = 'in_review' and submitted_at is null;

/** A free Spotlight Boost a studio got because a review took longer than 72 hours. */
create table public.boost_credits (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  version_id uuid not null unique references public.game_versions (id) on delete cascade,
  reason text not null default 'late_review',
  created_at timestamptz not null default now(),
  used_boost_id uuid references public.boosts (id) on delete set null,
  used_at timestamptz
);
alter table public.boost_credits enable row level security;
create policy boost_credits_select on public.boost_credits for select using (app.owns_studio(studio_id) or app.is_staff());
grant select on public.boost_credits to authenticated;

/** Gives the studio one free Spotlight Boost for a late review (once per version). */
create or replace function app.grant_review_credit(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_studio uuid; v_game uuid; v_title text; v_new int;
begin
  select g.studio_id, g.id, g.title into v_studio, v_game, v_title
  from public.game_versions v join public.games g on g.id = v.game_id where v.id = p_version;
  if v_studio is null then return; end if;
  insert into public.boost_credits (studio_id, version_id) values (v_studio, p_version) on conflict (version_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    perform app.notify(app.game_owner(v_game), 'boost', 'Your review took over 72 hours: a free Boost',
      'Sorry for the wait on ' || v_title || '. Your next Spotlight Boost is free: use it on the Boost page.', '/dev/boost/');
  end if;
end $$;

create or replace function app.on_version_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.qa_status = 'in_review' and old.qa_status is distinct from 'in_review' then
    new.submitted_at := now();
    new.reviewed_at := null;
  elsif old.qa_status = 'in_review' and new.qa_status is distinct from 'in_review' then
    new.reviewed_at := now();
    if old.submitted_at is not null and now() > old.submitted_at + interval '72 hours' then
      perform app.grant_review_credit(new.id);
    end if;
  end if;
  return new;
end $$;
create trigger game_versions_review before update of qa_status on public.game_versions
  for each row execute function app.on_version_review();

/** Credits for reviews still waiting after 72 hours: the developer does not wait for our decision. */
create or replace function app.grant_overdue_review_credits()
returns int language plpgsql security definer set search_path = '' as $$
declare v record; v_count int := 0;
begin
  for v in select id from public.game_versions
    where qa_status = 'in_review' and submitted_at < now() - interval '72 hours'
      and not exists (select 1 from public.boost_credits c where c.version_id = game_versions.id)
  loop
    perform app.grant_review_credit(v.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.my_boost_credits()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.boost_credits c join public.studios s on s.id = c.studio_id
  where s.owner_id = auth.uid() and c.used_at is null;
$$;

/** Uses one free credit: a Spotlight Boost (3 days of sponsored placement) for one of your live games. */
create or replace function public.redeem_boost_credit(p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_game record; v_credit uuid; v_boost uuid;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  select g.* into v_game from public.games g join public.studios s on s.id = g.studio_id
  where g.id = p_game_id and s.owner_id = auth.uid();
  if not found then perform app.fail('not_allowed'); end if;
  if v_game.status not in ('spark', 'rise', 'featured') or v_game.released_at is null then perform app.fail('invalid'); end if;
  if exists (select 1 from public.boosts where game_id = p_game_id and status in ('paid', 'live') and ends_at > now()) then
    perform app.fail('conflict');
  end if;
  select id into v_credit from public.boost_credits where studio_id = v_game.studio_id and used_at is null
  order by created_at limit 1 for update skip locked;
  if v_credit is null then perform app.fail('not_found'); end if;
  insert into public.boosts (game_id, studio_id, package, amount_paise, status, starts_at, ends_at, notes)
  values (p_game_id, v_game.studio_id, 'spotlight', 0, 'paid', now(), now() + interval '3 days', 'Free: late review credit')
  returning id into v_boost;
  update public.boost_credits set used_at = now(), used_boost_id = v_boost where id = v_credit;
  perform app.audit('boost_credit_used', 'boost', v_boost::text, jsonb_build_object('game', p_game_id));
  return v_boost;
end $$;

-- The daily job also hands out credits for reviews that are already late.
create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int; v_rank int; v_reports int := 0; v_credits int;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  v_kpis := public.refresh_daily_game_kpis(current_date - 1);
  perform public.refresh_daily_game_kpis(current_date);
  v_ab := public.pick_ab_winners();
  v_rank := public.refresh_rank_scores();
  delete from public.parties where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 days';
  if extract(isodow from current_date) = 1 then v_reports := app.weekly_brain_reports(); end if;
  v_credits := app.grant_overdue_review_credits();
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab, 'games_ranked', v_rank,
    'brain_reports', v_reports, 'review_credits', v_credits);
end $$;

-- ---- Jams: sponsors and prizes ---------------------------------------------------------------------
alter table public.jams
  add column sponsor_name text check (sponsor_name is null or char_length(sponsor_name) <= 80),
  add column sponsor_url text check (sponsor_url is null or sponsor_url ~ '^https://\S+$'),
  add column prizes jsonb not null default '[]'::jsonb check (jsonb_typeof(prizes) = 'array' and jsonb_array_length(prizes) <= 10);

-- Grants, in the explicit style of 0009.
revoke execute on function app.grant_review_credit(uuid), app.on_version_review(), app.grant_overdue_review_credits() from public, anon, authenticated;
grant execute on function public.my_boost_credits(), public.redeem_boost_credit(uuid) to authenticated;
