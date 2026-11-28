-- 0034: e-mails go out by themselves; the Brain Shop; more control for admins.
--
-- 1. Mail timer: every minute, if e-mails are waiting, the database wakes the mail-outbox Edge
--    Function (pg_net). It proves itself with a token made and kept inside the database, so no
--    secret has to be copied anywhere. Replaces the hand-made database webhook in docs/EMAIL.md.
-- 2. Brain Shop: puzzle hints bought with Brain Points.
-- 3. Admin: site settings for ads (placements and our own ads), custom pages, player tools
--    (Brain Points, Premium) and the Google Analytics (Looker Studio) report in the portal.

-- ---- 1. Mail timer ---------------------------------------------------------------------------
create table app.internal_tokens (name text primary key, token text not null);
alter table app.internal_tokens enable row level security;
insert into app.internal_tokens (name, token)
values ('mail_cron', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

/** For the Edge Function (service role): whether a token is the one kept for `p_name`. */
create or replace function public.check_internal_token(p_name text, p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select token = p_token from app.internal_tokens where name = p_name), false)
$$;
revoke all on function public.check_internal_token(text, text) from public, anon, authenticated;
grant execute on function public.check_internal_token(text, text) to service_role;

create or replace function app.cron_mail_outbox() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.email_outbox where status = 'queued' and attempts < 5) then return; end if;
  if to_regproc('net.http_post') is null then return; end if;
  execute $q$select net.http_post(
      url := 'https://zoqjrxgwtfxaqnhlraoz.supabase.co/functions/v1/mail-outbox',
      headers := jsonb_build_object('content-type', 'application/json', 'x-outbox-cron', (select token from app.internal_tokens where name = 'mail_cron')),
      body := '{}'::jsonb)$q$;
end $$;
revoke all on function app.cron_mail_outbox() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.unschedule(jobid) from cron.job where jobname = 'bg-mail-outbox'$c$;
    execute $c$select cron.schedule('bg-mail-outbox', '* * * * *', 'select app.cron_mail_outbox()')$c$;
  end if;
end $$;

-- ---- 2. Brain Shop ---------------------------------------------------------------------------
create table public.puzzle_hints (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('word', 'path')),
  day date not null,
  used int not null default 0,
  primary key (user_id, kind, day)
);
alter table public.puzzle_hints enable row level security;
create policy puzzle_hints_own on public.puzzle_hints for select using (user_id = auth.uid());
grant select on public.puzzle_hints to authenticated;

/** 30 Brain Points for a hint on today's puzzle (3 a puzzle a day). Returns hints used so far. */
create or replace function public.buy_puzzle_hint(p_kind text, p_day date)
returns int language plpgsql security definer set search_path = '' as $$
declare p record; v_used int;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_kind not in ('word', 'path') or p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then perform app.fail('invalid'); end if;
  select * into p from public.profiles where id = auth.uid() and banned_at is null for update;
  if not found then perform app.fail('not_allowed'); end if;
  select used into v_used from public.puzzle_hints where user_id = auth.uid() and kind = p_kind and day = p_day;
  if coalesce(v_used, 0) >= 3 then perform app.fail('conflict'); end if;
  if p.brain_points < 30 then perform app.fail('insufficient_points'); end if;
  perform app.award_points(auth.uid(), -30, 'puzzle_hint', p_kind, p_day::text || ':' || (coalesce(v_used, 0) + 1)::text);
  insert into public.puzzle_hints (user_id, kind, day, used) values (auth.uid(), p_kind, p_day, 1)
  on conflict (user_id, kind, day) do update set used = public.puzzle_hints.used + 1;
  return coalesce(v_used, 0) + 1;
end $$;
revoke all on function public.buy_puzzle_hint(text, date) from public, anon;
grant execute on function public.buy_puzzle_hint(text, date) to authenticated;

-- ---- 3. Admin: ads, pages, players -------------------------------------------------------------
/** Ads set by admins: where ads may show, and our own ads (video or picture, link, audience). */
create table public.ad_settings (
  id int primary key default 1 check (id = 1),
  placements jsonb not null default '{}'::jsonb,
  creatives jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.ad_settings (id) values (1) on conflict do nothing;
alter table public.ad_settings enable row level security;
create policy ad_settings_read on public.ad_settings for select using (true);
grant select on public.ad_settings to anon, authenticated;

create or replace function public.admin_save_ad_settings(p_placements jsonb, p_creatives jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if jsonb_typeof(p_placements) <> 'object' or jsonb_typeof(p_creatives) <> 'array' or jsonb_array_length(p_creatives) > 50 then perform app.fail('invalid'); end if;
  -- Links and media must be https.
  if exists (select 1 from jsonb_array_elements(p_creatives) c
             where coalesce(c ->> 'href', '') !~ '^https://' or coalesce(c ->> 'media', '') !~ '^(https://zoqjrxgwtfxaqnhlraoz\.supabase\.co/storage/v1/object/public/ads/|/promo/)') then
    perform app.fail('invalid');
  end if;
  update public.ad_settings set placements = p_placements, creatives = p_creatives, updated_at = now() where id = 1;
  perform app.audit('save_ad_settings', 'site', 'ads', jsonb_build_object('creatives', jsonb_array_length(p_creatives)));
end $$;

/** Pages admins write (About-style pages at /p/<slug>). */
create table public.site_pages (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  title text not null check (char_length(title) between 2 and 120),
  body_md text not null default '' check (char_length(body_md) <= 50000),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.site_pages enable row level security;
create policy site_pages_read on public.site_pages for select using (published or app.is_admin());
create policy site_pages_admin on public.site_pages for all using (app.is_admin()) with check (app.is_admin());
grant select on public.site_pages to anon, authenticated;
grant insert, update, delete on public.site_pages to authenticated;

/** Admins: Brain Points to add or take away (with a reason), recorded in the ledger. */
create or replace function public.admin_adjust_points(p_user uuid, p_delta int, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if p_delta = 0 or abs(p_delta) > 100000 or char_length(trim(coalesce(p_reason, ''))) < 3 then perform app.fail('invalid'); end if;
  perform app.award_points(p_user, p_delta, 'admin', 'admin', extract(epoch from clock_timestamp())::text);
  select brain_points into v from public.profiles where id = p_user;
  perform app.audit('adjust_points', 'user', p_user::text, jsonb_build_object('delta', p_delta, 'reason', p_reason));
  return v;
end $$;

/** Admins: sets or ends a player's Premium plan (no payment; for staff, prizes and support). */
create or replace function public.admin_set_premium(p_user uuid, p_plan text, p_days int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if p_plan is null then
    update public.profiles set premium_plan = null, premium_until = null, premium_auto_renew = false where id = p_user;
  else
    if p_plan not in ('lite', 'plus', 'max') or p_days not between 1 and 3650 then perform app.fail('invalid'); end if;
    update public.profiles set premium_plan = p_plan, premium_until = now() + make_interval(days => p_days),
      premium_auto_renew = false, premium_from_pass = false where id = p_user;
  end if;
  perform app.audit('set_premium', 'user', p_user::text, jsonb_build_object('plan', p_plan, 'days', p_days));
end $$;

revoke all on function public.admin_save_ad_settings(jsonb, jsonb), public.admin_adjust_points(uuid, int, text),
  public.admin_set_premium(uuid, text, int) from public, anon;
grant execute on function public.admin_save_ad_settings(jsonb, jsonb), public.admin_adjust_points(uuid, int, text),
  public.admin_set_premium(uuid, text, int) to authenticated;

/** Admin uploads for our own ads: pictures and videos in the public "ads" bucket. */
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ads', 'ads', true, 52428800, array['image/webp', 'image/png', 'image/jpeg', 'video/mp4'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists bg_ads_insert on storage.objects';
    execute $p$create policy bg_ads_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'ads' and app.is_admin())$p$;
  end if;
end $$;

/** Settings only staff see: the Looker Studio (Google Analytics) report shown in the portal. */
create table public.portal_settings (
  id int primary key default 1 check (id = 1),
  analytics_embed_url text check (analytics_embed_url is null or analytics_embed_url ~ '^https://lookerstudio\.google\.com/embed/'),
  updated_at timestamptz not null default now()
);
insert into public.portal_settings (id) values (1) on conflict do nothing;
alter table public.portal_settings enable row level security;
create policy portal_settings_staff on public.portal_settings for select using (app.is_staff());
create policy portal_settings_admin on public.portal_settings for update using (app.is_admin()) with check (app.is_admin());
grant select, update on public.portal_settings to authenticated;
