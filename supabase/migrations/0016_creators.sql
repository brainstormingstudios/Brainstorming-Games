-- 0016_creators: the creator program.
--
-- YouTubers, Reels makers and streamers share games with their own link (`?cr=handle`). Players
-- who arrive through it are credited to the creator for 30 days (in the browser), and the creator
-- earns 10% of the net ad revenue those players bring, computed by the same TypeScript revenue
-- engine as studio statements (apps/web/src/lib/domain/revenue.ts). A studio's own referral
-- players stay the studio's.

create table public.creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  channels jsonb not null default '[]'::jsonb check (jsonb_typeof(channels) = 'array'),
  about text not null default '' check (char_length(about) <= 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_note text,
  agreed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table public.creator_visits (
  id bigint generated always as identity primary key,
  handle text not null,
  anon_id uuid not null,
  landed_at timestamptz not null default now()
);
create index creator_visits_handle_idx on public.creator_visits (handle, landed_at desc);

alter table public.events add column ref_creator text check (ref_creator is null or ref_creator ~ '^[a-z0-9_]{3,24}$');
create index events_ref_creator_idx on public.events (ref_creator, ts) where ref_creator is not null;

create table public.creator_months (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.creators (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  currency text not null default 'USD',
  earned numeric(14, 2) not null default 0,
  carry_in numeric(14, 2) not null default 0,
  payout_due numeric(14, 2) not null default 0,
  breakdown jsonb not null default '[]'::jsonb,
  status text not null default 'finalised' check (status in ('finalised', 'rolled_over', 'paid')),
  created_at timestamptz not null default now(),
  unique (creator_id, month)
);

create table public.creator_payouts (
  id bigint generated always as identity primary key,
  creator_id uuid not null references public.creators (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  method text not null,
  reference text,
  months text[] not null default '{}',
  paid_at timestamptz not null default now()
);

-- Encrypted by the payout-profile Edge Function (same as studio_payout_profiles); no client policies.
create table public.creator_payout_profiles (
  creator_id uuid primary key references public.creators (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_version int not null default 1,
  method text not null,
  currency text not null check (currency in ('INR', 'USD')),
  updated_at timestamptz not null default now()
);

alter table public.creators enable row level security;
alter table public.creator_visits enable row level security;
alter table public.creator_months enable row level security;
alter table public.creator_payouts enable row level security;
alter table public.creator_payout_profiles enable row level security;

create policy creators_select on public.creators for select using (user_id = auth.uid() or app.is_staff());
create policy creator_months_select on public.creator_months for select using (
  app.is_admin() or exists (select 1 from public.creators c where c.id = creator_id and c.user_id = auth.uid()));
create policy creator_payouts_select on public.creator_payouts for select using (
  app.is_admin() or exists (select 1 from public.creators c where c.id = creator_id and c.user_id = auth.uid()));

grant select on public.creators, public.creator_months, public.creator_payouts to authenticated;

-- ---- Event ingest, now with the creator handle ------------------------------------------------
drop function public.ingest_events(uuid, text, text, jsonb, text);

create or replace function public.ingest_events(
  p_anon_id uuid,
  p_device text,
  p_ref_studio text,
  p_events jsonb,
  p_country text default null,
  p_ref_creator text default null
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_country text := upper(left(coalesce(p_country, app.header('cf-ipcountry'), ''), 2));
  v_event jsonb;
  v_type public.event_type;
  v_game uuid;
  v_session uuid;
  v_version uuid;
  v_ts timestamptz;
  v_count int := 0;
  v_plays jsonb := '{}'::jsonb;
begin
  if p_anon_id is null or jsonb_typeof(p_events) <> 'array' then perform app.fail('invalid'); end if;
  if jsonb_array_length(p_events) > 50 then perform app.fail('invalid'); end if;
  perform app.guard('events', p_anon_id::text, 120, 60);
  if p_device not in ('desktop', 'mobile', 'tablet') then p_device := null; end if;
  if p_ref_studio is not null and p_ref_studio !~ '^[a-z0-9-]{2,40}$' then p_ref_studio := null; end if;
  p_ref_creator := lower(p_ref_creator);
  if p_ref_creator is not null and p_ref_creator !~ '^[a-z0-9_]{3,24}$' then p_ref_creator := null; end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    begin
      v_type := (v_event ->> 'type')::public.event_type;
      v_game := nullif(v_event ->> 'game_id', '')::uuid;
      v_session := nullif(v_event ->> 'session_id', '')::uuid;
      v_version := nullif(v_event ->> 'version_id', '')::uuid;
      v_ts := coalesce((v_event ->> 'ts')::timestamptz, now());
    exception when others then
      continue;
    end;
    if v_game is not null and not exists (select 1 from public.games g where g.id = v_game) then
      continue;
    end if;
    if v_version is not null and not exists (select 1 from public.game_versions v where v.id = v_version) then
      v_version := null;
    end if;
    if v_ts not between now() - interval '2 hours' and now() + interval '5 minutes' then
      v_ts := now();
    end if;
    insert into public.events (anon_id, user_id, session_id, game_id, version_id, type, ts, payload, country, device, ref_studio, ref_creator)
    values (
      p_anon_id, auth.uid(), v_session, v_game, v_version, v_type, v_ts,
      coalesce(v_event -> 'payload', '{}'::jsonb),
      nullif(v_country, ''), p_device, p_ref_studio, p_ref_creator
    );
    v_count := v_count + 1;
    if v_type = 'play_click' and v_game is not null then
      v_plays := jsonb_set(v_plays, array[v_game::text], to_jsonb(coalesce((v_plays ->> v_game::text)::int, 0) + 1));
    end if;
  end loop;

  insert into public.game_stats as s (game_id, plays_total, plays_7d)
  select key::uuid, value::int, value::int from jsonb_each_text(v_plays)
  on conflict (game_id) do update
    set plays_total = s.plays_total + excluded.plays_total,
        plays_7d = s.plays_7d + excluded.plays_7d,
        updated_at = now();

  if v_count > 0 then perform app.on_events_ingested(p_anon_id, auth.uid(), p_events); end if;
  return v_count;
end $$;

-- ---- Creator accounts ---------------------------------------------------------------------------
create or replace function public.creator_handle_available(p_handle text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(p_handle) ~ '^[a-z0-9_]{3,24}$'
    and lower(p_handle) not in ('admin', 'brainstorming', 'support', 'staff', 'moderator', 'official', 'help')
    and not exists (select 1 from public.creators where handle = lower(p_handle));
$$;

create or replace function public.creator_apply(p_handle text, p_display_name text, p_channels jsonb, p_about text, p_agreed boolean)
returns public.creators language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_existing public.creators;
  v_handle text := lower(trim(coalesce(p_handle, '')));
  v_channels jsonb;
  v_row public.creators;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  perform app.guard('creator_apply', auth.uid()::text, 5, 3600);
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then perform app.fail('login_required'); end if;
  if v_profile.is_minor or v_profile.banned_at is not null then perform app.fail('not_allowed'); end if;
  if not coalesce(p_agreed, false) then perform app.fail('invalid'); end if;
  if v_handle !~ '^[a-z0-9_]{3,24}$' or v_handle in ('admin', 'brainstorming', 'support', 'staff', 'moderator', 'official', 'help') then
    perform app.fail('invalid');
  end if;
  if char_length(trim(coalesce(p_about, ''))) < 20 then perform app.fail('invalid'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', c ->> 'kind', 'url', trim(c ->> 'url'))), '[]'::jsonb) into v_channels
  from (select c from jsonb_array_elements(coalesce(p_channels, '[]'::jsonb)) c
        where c ->> 'kind' in ('youtube', 'instagram', 'twitch', 'other') and trim(c ->> 'url') ~ '^https://\S+$' limit 5) x;
  if jsonb_array_length(v_channels) = 0 then perform app.fail('invalid'); end if;

  select * into v_existing from public.creators where user_id = auth.uid();
  if found and v_existing.status <> 'rejected' then perform app.fail('conflict'); end if;
  if exists (select 1 from public.creators where handle = v_handle and user_id <> auth.uid()) then perform app.fail('conflict'); end if;

  insert into public.creators (user_id, handle, display_name, channels, about, status, review_note, agreed_at)
  values (auth.uid(), v_handle, left(coalesce(nullif(trim(p_display_name), ''), v_profile.username), 40), v_channels,
          left(trim(p_about), 600), 'pending', null, now())
  on conflict (user_id) do update set
    handle = excluded.handle, display_name = excluded.display_name, channels = excluded.channels,
    about = excluded.about, status = 'pending', review_note = null, agreed_at = now()
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.record_creator_visit(p_handle text, p_anon_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  p_handle := lower(p_handle);
  if p_handle !~ '^[a-z0-9_]{3,24}$' or p_anon_id is null then return; end if;
  if not app.take_token('cr:' || p_anon_id::text, 5, 3600) then return; end if;
  if exists (select 1 from public.creators where handle = p_handle and status = 'approved') then
    insert into public.creator_visits (handle, anon_id) values (p_handle, p_anon_id);
  end if;
end $$;

/** The signed-in creator's numbers for the last p_days days. */
create or replace function public.creator_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_creator public.creators;
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  select * into v_creator from public.creators where user_id = auth.uid() and status = 'approved';
  if not found then perform app.fail('not_allowed'); end if;
  return (
    with ev as (
      select e.anon_id, e.game_id, e.type, e.ref_studio, g.slug, g.title, s.slug as studio_slug
      from public.events e join public.games g on g.id = e.game_id join public.studios s on s.id = g.studio_id
      where e.ref_creator = v_creator.handle and e.ts >= v_since
    ),
    per_game as (
      select game_id, min(slug) as slug, min(title) as title,
        count(distinct anon_id) as visitors,
        count(*) filter (where type = 'play_click') as plays,
        count(*) filter (where type = 'ad_started' and ref_studio is distinct from studio_slug) as ad_impressions
      from ev group by game_id
    )
    select jsonb_build_object(
      'days', greatest(1, least(coalesce(p_days, 30), 365)),
      'visitors', (select count(distinct a) from (
          select anon_id as a from ev
          union select v.anon_id from public.creator_visits v where v.handle = v_creator.handle and v.landed_at >= v_since) u),
      'plays', coalesce((select sum(plays) from per_game), 0),
      'adImpressions', coalesce((select sum(ad_impressions) from per_game), 0),
      'games', coalesce((select jsonb_agg(jsonb_build_object('gameId', game_id, 'slug', slug, 'title', title,
          'visitors', visitors, 'plays', plays, 'adImpressions', ad_impressions) order by plays desc) from per_game), '[]'::jsonb))
  );
end $$;

-- ---- Staff ------------------------------------------------------------------------------------------
create or replace function public.admin_creators(p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object('username', p.username, 'email', u.email) order by c.created_at desc)
    from public.creators c
    left join public.profiles p on p.id = c.user_id
    left join auth.users u on u.id = c.user_id
    where p_status = 'all' or c.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_decide_creator(p_creator uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.creators;
  v_status text;
  v_email text;
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if p_decision not in ('approve', 'reject', 'suspend') then perform app.fail('invalid'); end if;
  if p_decision <> 'approve' and char_length(trim(coalesce(p_note, ''))) < 3 then perform app.fail('invalid'); end if;
  v_status := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'suspended' end;
  update public.creators set status = v_status, review_note = nullif(trim(coalesce(p_note, '')), ''),
    approved_at = case when v_status = 'approved' then now() else approved_at end
  where id = p_creator returning * into v_row;
  if not found then perform app.fail('not_found'); end if;
  perform app.notify(v_row.user_id, 'creator',
    case v_status when 'approved' then 'You are a Brainstorming creator' when 'rejected' then 'Your creator application'
      else 'Your creator account is suspended' end,
    coalesce(v_row.review_note, ''), '/creators/dashboard/');
  select email into v_email from auth.users where id = v_row.user_id;
  if v_status in ('approved', 'rejected') then
    perform app.queue_mail(v_email, case when v_status = 'approved' then 'creator_approved' else 'creator_declined' end,
      jsonb_build_object('handle', v_row.handle, 'note', coalesce(v_row.review_note, '')));
  end if;
  perform app.audit('creator_' || p_decision, 'creator', p_creator::text, jsonb_build_object('note', p_note));
end $$;

-- ---- Revenue: the inputs now carry creator impressions; statements are written in one call -------
create or replace function public.admin_revenue_inputs(p_month text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := (p_month || '-01')::date;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  return jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gameId', g.id, 'title', g.title, 'studioId', s.id, 'studioName', s.name, 'studioSlug', s.slug,
        'riseStartedAt', g.rise_started_at, 'exclusiveUntil', g.exclusive_until,
        'impressionsByCountry', x.by_country, 'impressions', x.impressions, 'refImpressions', x.ref_impressions,
        'creatorImpressions', coalesce((
          select jsonb_object_agg(c.id, n.cnt)
          from (select e.ref_creator, count(*) as cnt from public.events e
                where e.game_id = g.id and e.type = 'ad_started' and e.ref_creator is not null
                  and e.ref_studio is distinct from s.slug
                  and e.ts >= v_from and e.ts < v_from + interval '1 month'
                group by e.ref_creator) n
          join public.creators c on c.handle = n.ref_creator and c.status = 'approved'), '{}'::jsonb)))
      from (
        select k.game_id, sum(k.ad_impressions) as impressions, sum(k.ref_ad_impressions) as ref_impressions,
          (select coalesce(jsonb_object_agg(c.key, c.total), '{}'::jsonb) from (
             select e.key, sum(e.value::numeric) as total
             from public.daily_game_kpis k2, jsonb_each_text(k2.ad_impressions_by_country) e
             where k2.game_id = k.game_id and k2.day >= v_from and k2.day < v_from + interval '1 month'
             group by e.key) c) as by_country
        from public.daily_game_kpis k
        where k.day >= v_from and k.day < v_from + interval '1 month'
        group by k.game_id having sum(k.ad_impressions) > 0
      ) x join public.games g on g.id = x.game_id join public.studios s on s.id = g.studio_id), '[]'::jsonb),
    'weights', (select value from public.site_config where key = 'ad_country_weights'),
    'carry', coalesce((
      select jsonb_object_agg(r.studio_id, r.payout_due)
      from public.revenue_months r
      where r.status = 'rolled_over' and r.month = to_char(v_from - interval '1 month', 'YYYY-MM')), '{}'::jsonb),
    'creatorCarry', coalesce((
      select jsonb_object_agg(r.creator_id, r.payout_due)
      from public.creator_months r
      where r.status = 'rolled_over' and r.month = to_char(v_from - interval '1 month', 'YYYY-MM')), '{}'::jsonb));
end $$;

create or replace function public.admin_write_creator_revenue(p_month text, p_currency text, p_statements jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if exists (select 1 from public.creator_months where month = p_month and status = 'paid') then
    perform app.fail('conflict');
  end if;
  delete from public.creator_months where month = p_month;
  insert into public.creator_months (creator_id, month, currency, earned, carry_in, payout_due, breakdown, status)
  select (s ->> 'creatorId')::uuid, p_month, coalesce(p_currency, 'USD'),
    (s ->> 'earned')::numeric, coalesce((s ->> 'carryIn')::numeric, 0), (s ->> 'payoutDue')::numeric,
    coalesce(s -> 'games', '[]'::jsonb),
    case when (s ->> 'belowThreshold')::boolean then 'rolled_over' else 'finalised' end
  from jsonb_array_elements(coalesce(p_statements, '[]'::jsonb)) s
  where exists (select 1 from public.creators c where c.id = (s ->> 'creatorId')::uuid);
  get diagnostics v_count = row_count;
  perform app.notify(c.user_id, 'revenue', 'Your ' || p_month || ' creator statement is ready', '', '/creators/dashboard/')
  from public.creator_months r join public.creators c on c.id = r.creator_id where r.month = p_month;
  perform app.audit('creator_revenue_run', 'creator_month', p_month, jsonb_build_object('statements', v_count));
  return v_count;
end $$;

create or replace function public.admin_creator_months()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('handle', c.handle) order by r.month desc, r.payout_due desc)
    from public.creator_months r join public.creators c on c.id = r.creator_id), '[]'::jsonb);
end $$;

create or replace function public.admin_record_creator_payout(p_creator uuid, p_months text[], p_method text, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_amount numeric; v_currency text; v_user uuid; v_email text;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if char_length(trim(coalesce(p_reference, ''))) < 3 then perform app.fail('invalid'); end if;
  select sum(payout_due), max(currency) into v_amount, v_currency
  from public.creator_months where creator_id = p_creator and month = any (p_months) and status = 'finalised';
  if coalesce(v_amount, 0) <= 0 then perform app.fail('invalid'); end if;
  insert into public.creator_payouts (creator_id, amount, currency, method, reference, months)
  values (p_creator, v_amount, v_currency, p_method, trim(p_reference), p_months);
  update public.creator_months set status = 'paid' where creator_id = p_creator and month = any (p_months) and status = 'finalised';
  select user_id into v_user from public.creators where id = p_creator;
  select email into v_email from auth.users where id = v_user;
  perform app.notify(v_user, 'payout', 'Creator payout sent', v_amount::text || ' ' || v_currency, '/creators/dashboard/');
  perform app.queue_mail(v_email, 'payout_sent', jsonb_build_object('amount', v_amount::text || ' ' || v_currency, 'reference', trim(p_reference)));
  perform app.audit('creator_payout', 'creator', p_creator::text, jsonb_build_object('months', p_months, 'amount', v_amount, 'method', p_method));
end $$;

create or replace function public.admin_creator_payouts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  return coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('handle', c.handle) order by p.paid_at desc)
    from public.creator_payouts p join public.creators c on c.id = p.creator_id), '[]'::jsonb);
end $$;

-- ---- Grants --------------------------------------------------------------------------------------
grant execute on function
  public.ingest_events(uuid, text, text, jsonb, text, text),
  public.creator_handle_available(text),
  public.record_creator_visit(text, uuid)
to anon, authenticated;

grant execute on function
  public.creator_apply(text, text, jsonb, text, boolean),
  public.creator_stats(int),
  public.admin_creators(text),
  public.admin_decide_creator(uuid, text, text),
  public.admin_revenue_inputs(text),
  public.admin_write_creator_revenue(text, text, jsonb),
  public.admin_creator_months(),
  public.admin_record_creator_payout(uuid, text[], text, text),
  public.admin_creator_payouts()
to authenticated;
