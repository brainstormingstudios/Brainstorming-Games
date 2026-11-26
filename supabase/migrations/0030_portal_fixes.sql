-- 0030: management and developer portal fixes.
--
-- 1. Numbers are fresh: today's game numbers are recounted every 5 minutes, and the daily jobs
--    run every night on the database's own scheduler (pg_cron), not only when someone presses the
--    button or the GitHub keep-awake job runs.
-- 2. Deleting an account that owns a studio says so ('owns_studio') instead of failing on the
--    database link; admins can now delete a studio (with its games) or hand it to another owner.
-- 3. Players can clear their own play history (the delete right was missing).
-- 4. One-time sign-in hand-over between the three sites (free pages.dev addresses cannot share a
--    sign-in): the site that is signed in asks for a single-use code that lives 60 seconds; the
--    other site exchanges it, through the sign-in-handover Edge Function, for a fresh session of
--    the same account. Only a hash of the code is stored.

-- ---- 1. Scheduled jobs ------------------------------------------------------------------------------
-- Supabase has pg_cron; the test database does not, so it is optional here.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end $$;

/** For the scheduler: runs a job with the service role's rights. */
create or replace function app.cron_kpis_today() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.refresh_daily_game_kpis(current_date);
end $$;

create or replace function app.cron_daily_jobs() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.run_daily_jobs();
end $$;
revoke all on function app.cron_kpis_today(), app.cron_daily_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.unschedule(jobid) from cron.job where jobname in ('bg-kpis-today', 'bg-daily-jobs')$c$;
    execute $c$select cron.schedule('bg-kpis-today', '*/5 * * * *', 'select app.cron_kpis_today()')$c$;
    execute $c$select cron.schedule('bg-daily-jobs', '10 21 * * *', 'select app.cron_daily_jobs()')$c$; -- 02:40 India
  end if;
end $$;

-- ---- 2. Accounts and studios ------------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if p_user = auth.uid() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid'); end if;
  -- A studio keeps games, revenue and payouts: delete it or hand it over first.
  if exists (select 1 from public.studios where owner_id = p_user) then perform app.fail('owns_studio'); end if;
  select username into v_name from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  perform app.audit('delete_user', 'user', p_user::text, jsonb_build_object('username', v_name, 'reason', p_reason));
end $$;

/** Admins: deletes a studio for good, with its games, builds' records and stats. */
create or replace function public.admin_delete_studio(p_studio uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then perform app.fail('invalid'); end if;
  select id, name, is_first_party into v from public.studios where id = p_studio;
  if v.id is null then perform app.fail('not_found'); end if;
  if v.is_first_party then perform app.fail('invalid'); end if; -- the house studio is never deleted here
  delete from public.studios where id = p_studio;
  perform app.audit('delete_studio', 'studio', p_studio::text, jsonb_build_object('name', v.name, 'reason', p_reason));
end $$;

/** Admins: hands a studio to another account (by e-mail), for example before deleting the old one. */
create or replace function public.admin_transfer_studio(p_studio uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then perform app.fail('not_found'); end if;
  if exists (select 1 from public.studios where owner_id = v_user and id <> p_studio)
     or exists (select 1 from public.studio_members where user_id = v_user and studio_id <> p_studio) then
    perform app.fail('conflict');
  end if;
  delete from public.studio_members where studio_id = p_studio and user_id = v_user;
  update public.studios set owner_id = v_user where id = p_studio;
  perform app.audit('transfer_studio', 'studio', p_studio::text, jsonb_build_object('to', v_user));
end $$;

revoke all on function public.admin_delete_studio(uuid, text), public.admin_transfer_studio(uuid, text) from public, anon;
grant execute on function public.admin_delete_studio(uuid, text), public.admin_transfer_studio(uuid, text) to authenticated;

-- ---- 3. Play history --------------------------------------------------------------------------------
grant delete on public.play_history to authenticated;

-- ---- 4. Sign-in hand-over ---------------------------------------------------------------------------
create table public.signin_handovers (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  target_origin text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.signin_handovers enable row level security;
-- No policies: only the Edge Function (service role) reads it.

/**
 * Called by the signed-in site: a single-use code for one of our other sites. The Edge Function
 * hashes nothing itself; the code is random here and only its hash is kept.
 */
create or replace function public.create_signin_handover(p_target text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_target !~ '^https://[a-z0-9.-]+$' then perform app.fail('invalid'); end if;
  perform app.guard('handover', auth.uid()::text, 20, 3600);
  delete from public.signin_handovers where created_at < now() - interval '10 minutes';
  -- 244 random bits from two v4 UUIDs (built in, no extension needed), as 64 hex characters.
  v_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.signin_handovers (code_hash, user_id, target_origin)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), auth.uid(), p_target);
  return v_code;
end $$;
revoke all on function public.create_signin_handover(text) from public, anon;
grant execute on function public.create_signin_handover(text) to authenticated;

/** For the Edge Function: spends a code once, within 60 seconds, for the site it was made for. */
create or replace function public.redeem_signin_handover(p_code text, p_origin text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if auth.role() <> 'service_role' then perform app.fail('not_allowed'); end if;
  update public.signin_handovers set used_at = now()
  where code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex')
    and used_at is null and created_at > now() - interval '60 seconds' and target_origin = p_origin
  returning user_id into v;
  if v.user_id is null then perform app.fail('invalid'); end if;
  return v.user_id;
end $$;
revoke all on function public.redeem_signin_handover(text, text) from public, anon, authenticated;
grant execute on function public.redeem_signin_handover(text, text) to service_role;
