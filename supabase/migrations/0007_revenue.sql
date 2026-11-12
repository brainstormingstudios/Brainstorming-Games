-- 0007_revenue: monthly revenue runs, statements, payouts, referral attribution.
--
-- The split itself is computed by the unit-tested TypeScript engine
-- (apps/web/src/lib/domain/revenue.ts) in the admin console. These functions give it its inputs
-- and persist its output, admin-only and audit-logged.

create table public.revenue_imports (
  id bigint generated always as identity primary key,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  currency text not null default 'USD' check (currency in ('USD', 'INR')),
  fx_inr numeric(10, 4),
  rows jsonb not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.revenue_months (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  currency text not null default 'USD',
  gross numeric(14, 2) not null default 0,
  net numeric(14, 2) not null default 0,
  share_pct numeric(5, 2) not null default 0,
  payout_due numeric(14, 2) not null default 0,
  carry_in numeric(14, 2) not null default 0,
  breakdown jsonb not null default '[]'::jsonb,
  status text not null default 'finalised' check (status in ('finalised', 'rolled_over', 'paid')),
  created_at timestamptz not null default now(),
  unique (studio_id, month)
);

create table public.payouts (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  method text not null,
  reference text,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  months text[] not null default '{}',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.referral_visits (
  id bigint generated always as identity primary key,
  studio_slug text not null,
  anon_id uuid not null,
  game_id uuid references public.games (id) on delete set null,
  landed_at timestamptz not null default now()
);
create index referral_visits_slug_idx on public.referral_visits (studio_slug, landed_at desc);

alter table public.revenue_imports enable row level security;
alter table public.revenue_months enable row level security;
alter table public.payouts enable row level security;
alter table public.referral_visits enable row level security;

create policy revenue_imports_select on public.revenue_imports for select using (app.is_admin());
create policy revenue_months_select on public.revenue_months for select using (app.owns_studio(studio_id) or app.is_admin());
create policy payouts_select on public.payouts for select using (app.owns_studio(studio_id) or app.is_admin());
create policy referral_visits_select on public.referral_visits for select using (
  app.is_staff() or exists (select 1 from public.studios s where s.slug = studio_slug and s.owner_id = auth.uid()));

create or replace function public.record_referral_visit(p_studio_slug text, p_anon_id uuid, p_game_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_studio_slug !~ '^[a-z0-9-]{2,40}$' or p_anon_id is null then return; end if;
  if not app.take_token('ref:' || p_anon_id::text, 5, 3600) then return; end if;
  if exists (select 1 from public.studios where slug = p_studio_slug) then
    insert into public.referral_visits (studio_slug, anon_id, game_id) values (p_studio_slug, p_anon_id, p_game_id);
  end if;
end $$;

/** Everything the revenue engine needs for one month: impressions per game and country. */
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
        'impressionsByCountry', x.by_country, 'impressions', x.impressions, 'refImpressions', x.ref_impressions))
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
      where r.status = 'rolled_over' and r.month = to_char(v_from - interval '1 month', 'YYYY-MM')), '{}'::jsonb));
end $$;

/** Persists one month's computed statements. Replaces an earlier run of the same month. */
create or replace function public.admin_write_revenue(p_month text, p_import jsonb, p_statements jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  if exists (select 1 from public.revenue_months where month = p_month and status = 'paid') then
    perform app.fail('conflict');
  end if;
  insert into public.revenue_imports (month, currency, fx_inr, rows, uploaded_by)
  values (p_month, coalesce(p_import ->> 'currency', 'USD'), (p_import ->> 'fxInr')::numeric, p_import -> 'rows', auth.uid());
  delete from public.revenue_months where month = p_month;
  insert into public.revenue_months (studio_id, month, currency, gross, net, share_pct, payout_due, carry_in, breakdown, status)
  select (s ->> 'studioId')::uuid, p_month, coalesce(p_import ->> 'currency', 'USD'),
    (s ->> 'gross')::numeric, (s ->> 'net')::numeric, (s ->> 'sharePct')::numeric,
    (s ->> 'payoutDue')::numeric, coalesce((s ->> 'carryIn')::numeric, 0), coalesce(s -> 'games', '[]'::jsonb),
    case when (s ->> 'belowThreshold')::boolean then 'rolled_over' else 'finalised' end
  from jsonb_array_elements(p_statements) s;
  get diagnostics v_count = row_count;
  perform app.notify(st.owner_id, 'revenue', 'Your ' || p_month || ' statement is ready', '', '/dev/payouts/')
  from public.revenue_months r join public.studios st on st.id = r.studio_id where r.month = p_month;
  perform app.audit('revenue_run', 'revenue_month', p_month, jsonb_build_object('statements', v_count));
  return v_count;
end $$;

create or replace function public.admin_record_payout(p_studio uuid, p_months text[], p_method text, p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_amount numeric; v_currency text;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  select sum(payout_due), max(currency) into v_amount, v_currency
  from public.revenue_months where studio_id = p_studio and month = any (p_months) and status = 'finalised';
  if coalesce(v_amount, 0) <= 0 then perform app.fail('invalid'); end if;
  insert into public.payouts (studio_id, amount, currency, method, reference, months)
  values (p_studio, v_amount, v_currency, p_method, p_reference, p_months);
  update public.revenue_months set status = 'paid' where studio_id = p_studio and month = any (p_months) and status = 'finalised';
  perform app.notify((select owner_id from public.studios where id = p_studio), 'payout', 'Payout sent',
    v_amount::text || ' ' || v_currency, '/dev/payouts/');
  perform app.audit('payout', 'studio', p_studio::text, jsonb_build_object('months', p_months, 'amount', v_amount, 'method', p_method));
end $$;
