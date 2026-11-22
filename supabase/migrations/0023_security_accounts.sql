-- 0023_security_accounts: Security Phases 3 and 4 (database side).
--
-- 1. Payout details: a change waits 48 hours before money can go to it. The old details stay in
--    use meanwhile, the owner gets an e-mail, and can cancel. (The payout-profile Edge Function
--    also asks for a fresh sign-in before it accepts a change.)
-- 2. Security alerts: one list for staff, e-mailed to every admin for warnings, filled by the
--    daily fraud scan and by account events.
-- 3. Fraud review: per game, the numbers that show fake traffic.
-- 4. Key rotation: a secret can have a "_prev" value that still works while the new one rolls out.

-- ---------------------------------------------------------------------------------------------
-- 1. Payout details on hold
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['studio_payout_profiles', 'creator_payout_profiles'] loop
    execute format('alter table public.%I alter column ciphertext drop not null, alter column iv drop not null,
      alter column method drop not null, alter column currency drop not null,
      add column pending_ciphertext text, add column pending_iv text, add column pending_key_version int,
      add column pending_method text, add column pending_currency text check (pending_currency in (''INR'', ''USD'')),
      add column pending_requested_at timestamptz, add column pending_effective_at timestamptz', t);
  end loop;
end $$;

/** Moves payout details whose 48 hours are over into use. Returns how many moved. */
create or replace function app.promote_payout_profiles() returns int
language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  update public.studio_payout_profiles set ciphertext = pending_ciphertext, iv = pending_iv, key_version = pending_key_version,
    method = pending_method, currency = pending_currency, updated_at = now(),
    pending_ciphertext = null, pending_iv = null, pending_key_version = null, pending_method = null,
    pending_currency = null, pending_requested_at = null, pending_effective_at = null
  where pending_effective_at <= now();
  get diagnostics a = row_count;
  update public.creator_payout_profiles set ciphertext = pending_ciphertext, iv = pending_iv, key_version = pending_key_version,
    method = pending_method, currency = pending_currency, updated_at = now(),
    pending_ciphertext = null, pending_iv = null, pending_key_version = null, pending_method = null,
    pending_currency = null, pending_requested_at = null, pending_effective_at = null
  where pending_effective_at <= now();
  get diagnostics b = row_count;
  return a + b;
end $$;

/** For the payout-profile Edge Function (service role). */
create or replace function public.promote_payout_profiles() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  return app.promote_payout_profiles();
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Security alerts
-- ---------------------------------------------------------------------------------------------
create table public.security_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  severity text not null check (severity in ('info', 'warn', 'high')),
  title text not null check (char_length(title) between 1 and 200),
  detail jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index security_alerts_open_idx on public.security_alerts (created_at desc) where resolved_at is null;
alter table public.security_alerts enable row level security;
create policy security_alerts_select on public.security_alerts for select using (app.is_staff());
grant select on public.security_alerts to authenticated;

/** Records an alert once (per dedupe key) and e-mails every admin about warnings. */
create or replace function app.raise_alert(p_kind text, p_severity text, p_title text, p_detail jsonb default '{}'::jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_email text;
begin
  insert into public.security_alerts (kind, severity, title, detail, dedupe_key)
  values (p_kind, p_severity, left(p_title, 200), coalesce(p_detail, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null or p_severity = 'info' then return; end if;
  for v_email in
    select u.email from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'admin' and p.banned_at is null and u.email is not null
  loop
    perform app.queue_mail(v_email, 'security_alert', jsonb_build_object('title', p_title, 'severity', p_severity, 'kind', p_kind));
  end loop;
end $$;

/** For Edge Functions (service role): account events such as a payout-details change. */
create or replace function public.raise_security_alert(p_kind text, p_severity text, p_title text, p_detail jsonb default '{}'::jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then perform app.fail('not_allowed'); end if;
  perform app.raise_alert(p_kind, p_severity, p_title, p_detail, p_dedupe);
end $$;

create or replace function public.admin_security_alerts(p_open_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'severity', a.severity, 'title', a.title,
      'detail', a.detail, 'created_at', a.created_at, 'resolved_at', a.resolved_at) order by a.created_at desc)
    from (select * from public.security_alerts where not p_open_only or resolved_at is null order by created_at desc limit 300) a
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_resolve_alert(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  update public.security_alerts set resolved_at = now(), resolved_by = auth.uid() where id = p_id and resolved_at is null;
  perform app.audit('alert_resolve', 'security_alert', p_id::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Fraud review
-- ---------------------------------------------------------------------------------------------
/**
 * Per game over the last `p_days` days: plays, distinct players, sessions with real play, ad
 * views, plays per player and how many callers hit the play caps. Fake traffic shows as many
 * plays per player, few real sessions, or many capped callers.
 */
create or replace function public.admin_fraud_overview(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 31)));
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.plays_per_player desc, x.plays desc)
    from (
      select g.id as game_id, g.title, s.name as studio,
        count(*) filter (where e.type = 'play_click') as plays,
        count(distinct e.anon_id) filter (where e.type = 'play_click') as players,
        count(distinct e.session_id) filter (where e.type in ('gameplay_stop', 'session_end')
          and jsonb_typeof(e.payload -> 't') = 'number' and (e.payload ->> 't')::numeric >= 20) as real_sessions,
        count(*) filter (where e.type = 'ad_started') as ad_views,
        round(count(*) filter (where e.type = 'play_click')::numeric
          / greatest(1, count(distinct e.anon_id) filter (where e.type = 'play_click')), 1) as plays_per_player,
        (select count(*) from public.rate_limits r where r.bucket_key like 'ev:play:%:' || g.id::text and r.tokens < 1
           and r.updated_at > v_since) as capped_callers
      from public.events e
      join public.games g on g.id = e.game_id
      join public.studios s on s.id = g.studio_id
      where e.ts >= v_since and e.type in ('play_click', 'gameplay_stop', 'session_end', 'ad_started')
      group by g.id, g.title, s.name
      limit 200
    ) x
  ), '[]'::jsonb);
end $$;

/** The daily scan: raises alerts for traffic spikes, odd ad ratios and many capped callers. */
create or replace function app.scan_fraud() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_count int := 0; v_day date := current_date - 1;
begin
  -- Plays yesterday far above the game's own 7-day average.
  for r in
    select k.game_id, g.title, k.plays,
      (select avg(p.plays) from public.daily_game_kpis p where p.game_id = k.game_id and p.day between v_day - 7 and v_day - 1) as avg_plays
    from public.daily_game_kpis k join public.games g on g.id = k.game_id
    where k.day = v_day and k.plays >= 200
  loop
    if r.avg_plays is not null and r.plays > 5 * greatest(r.avg_plays, 20) then
      perform app.raise_alert('traffic_spike', 'warn', 'Unusual traffic: ' || r.title,
        jsonb_build_object('game_id', r.game_id, 'plays', r.plays, 'average', round(r.avg_plays)), 'traffic_spike:' || r.game_id || ':' || v_day);
      v_count := v_count + 1;
    end if;
  end loop;
  -- Far more ad views than plays.
  for r in
    select k.game_id, g.title, k.plays, k.ad_impressions from public.daily_game_kpis k join public.games g on g.id = k.game_id
    where k.day = v_day and k.plays >= 50 and k.ad_impressions > 8 * k.plays
  loop
    perform app.raise_alert('ad_ratio', 'warn', 'Too many ad views per play: ' || r.title,
      jsonb_build_object('game_id', r.game_id, 'plays', r.plays, 'ad_views', r.ad_impressions), 'ad_ratio:' || r.game_id || ':' || v_day);
    v_count := v_count + 1;
  end loop;
  -- Many browsers or addresses hitting the play caps for one game.
  for r in
    select split_part(bucket_key, ':', array_length(string_to_array(bucket_key, ':'), 1)) as game_key, count(*) as n
    from public.rate_limits
    where bucket_key like 'ev:play:%' and tokens < 1 and updated_at > now() - interval '1 day'
    group by 1 having count(*) >= 20
  loop
    perform app.raise_alert('play_caps', 'warn', 'Many callers hit the play limit',
      jsonb_build_object('game_id', r.game_key, 'callers', r.n), 'play_caps:' || r.game_key || ':' || current_date);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Key rotation: "<name>_prev" keeps working while a new value rolls out
-- ---------------------------------------------------------------------------------------------
create or replace function app.secret_matches(p_name text, p_value text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_value, '') <> '' and exists (
    select 1 from app.secrets
    where name in (p_name, p_name || '_prev')
      and value_hash = encode(sha256(convert_to(p_value, 'utf8')), 'hex')
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Daily jobs: promote payout details, scan for fraud, keep security records long enough
-- (CERT-In asks for 180 days of logs; alerts are kept 400 days, the audit log is never trimmed).
-- ---------------------------------------------------------------------------------------------
create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int; v_rank int; v_reports int := 0; v_credits int; v_payouts int; v_alerts int;
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
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab, 'games_ranked', v_rank,
    'brain_reports', v_reports, 'review_credits', v_credits, 'payout_details_promoted', v_payouts, 'alerts', v_alerts);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function app.promote_payout_profiles(), app.raise_alert(text, text, text, jsonb, text), app.scan_fraud(),
  public.promote_payout_profiles(), public.raise_security_alert(text, text, text, jsonb, text),
  public.admin_security_alerts(boolean), public.admin_resolve_alert(bigint), public.admin_fraud_overview(int)
  from public, anon, authenticated;
grant execute on function public.promote_payout_profiles(), public.raise_security_alert(text, text, text, jsonb, text) to service_role;
grant execute on function public.admin_security_alerts(boolean), public.admin_resolve_alert(bigint), public.admin_fraud_overview(int) to authenticated;
