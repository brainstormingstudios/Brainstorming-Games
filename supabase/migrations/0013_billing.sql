-- 0013_billing: Brainstorming Premium for players, Boost for developers, payments, guest passes
-- and the outbox of automated e-mails.
--
-- Money only ever moves through Razorpay. These tables are written by the `billing` and
-- `razorpay-webhook` Edge Functions with the service role after Razorpay has confirmed a payment
-- (the webhook signature is checked). Browsers can read their own rows and nothing else.

alter table public.profiles
  add column premium_plan text check (premium_plan in ('plus', 'max')),
  add column premium_until timestamptz,
  add column premium_auto_renew boolean not null default false,
  add column premium_from_pass boolean not null default false,
  add column razorpay_subscription_id text;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('premium', 'boost')),
  what text not null,
  amount_paise int not null check (amount_paise >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  provider text not null default 'razorpay',
  -- Razorpay ids: the order or subscription, and the payment.
  provider_ref text not null,
  provider_payment_id text,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref, provider_payment_id)
);
create index payments_user_idx on public.payments (user_id, created_at desc);

create table public.boosts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  package text not null check (package in ('spotlight', 'push', 'launch')),
  amount_paise int not null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'live', 'done', 'cancelled')),
  razorpay_order_id text unique,
  short_urls text[] not null default '{}',
  reel_urls text[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  hero_until timestamptz,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index boosts_active_idx on public.boosts (game_id, ends_at) where status in ('paid', 'live');

create table public.guest_passes (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  from_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);

create table public.email_outbox (
  id bigint generated always as identity primary key,
  to_email text not null,
  template text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_queued_idx on public.email_outbox (created_at) where status = 'queued';

alter table public.payments enable row level security;
alter table public.boosts enable row level security;
alter table public.guest_passes enable row level security;
alter table public.email_outbox enable row level security;

create policy payments_select on public.payments for select using (user_id = auth.uid() or app.is_staff());
create policy boosts_select on public.boosts for select using (app.owns_studio(studio_id) or app.is_staff());
create policy guest_passes_select on public.guest_passes for select using (from_user = auth.uid() or app.is_staff());
create policy email_outbox_select on public.email_outbox for select using (app.is_staff());

-- ---------------------------------------------------------------------------------------------
-- E-mails: anything that should reach a person is queued here; the mail-outbox Edge Function
-- sends the queue (a database webhook calls it on every insert).
-- ---------------------------------------------------------------------------------------------
create or replace function app.queue_mail(p_to text, p_template text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_to is null or p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  insert into public.email_outbox (to_email, template, data) values (lower(p_to), p_template, coalesce(p_data, '{}'::jsonb));
end $$;

/** The address to write to about a studio: its owner's sign-in e-mail, else its contact address. */
create or replace function app.studio_email(p_studio uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(u.email, s.contact_email) from public.studios s left join auth.users u on u.id = s.owner_id where s.id = p_studio;
$$;

create or replace function app.mail_on_studio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.queue_mail(app.studio_email(new.id), 'welcome_studio', jsonb_build_object('studio', new.name));
  return new;
end $$;
create trigger studios_mail after insert on public.studios for each row execute function app.mail_on_studio();

create or replace function app.mail_on_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.qa_status = 'in_review' and old.qa_status is distinct from 'in_review' then
    select gm.id, gm.title, gm.studio_id, st.name as studio into g from public.games gm join public.studios st on st.id = gm.studio_id where gm.id = new.game_id;
    perform app.queue_mail(app.studio_email(g.studio_id), 'submission_received',
      jsonb_build_object('game', g.title, 'version', new.version, 'studio', g.studio, 'gameId', g.id));
  end if;
  return new;
end $$;
create trigger game_versions_mail after update of qa_status on public.game_versions for each row execute function app.mail_on_version();

create or replace function app.mail_on_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  select id, title, studio_id, released_at into g from public.games where id = new.game_id;
  perform app.queue_mail(app.studio_email(g.studio_id),
    case new.action when 'approve' then 'review_approved' when 'changes' then 'review_changes' else 'review_rejected' end,
    jsonb_build_object('game', g.title, 'gameId', g.id, 'notes', new.notes));
  return new;
end $$;
create trigger qa_reviews_mail after insert on public.qa_reviews for each row execute function app.mail_on_review();

create or replace function app.mail_on_launch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if new.decision is not null and old.decision is null then
    select id, title, studio_id into g from public.games where id = new.game_id;
    perform app.queue_mail(app.studio_email(g.studio_id), case new.decision when 'promoted' then 'rise_invite' else 'spark_ended' end,
      jsonb_build_object('game', g.title, 'gameId', g.id, 'reason', new.reason));
  end if;
  return new;
end $$;
create trigger game_launches_mail after update of decision on public.game_launches for each row execute function app.mail_on_launch();

create or replace function app.mail_on_statement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.queue_mail(app.studio_email(new.studio_id), 'statement_ready', jsonb_build_object(
    'month', new.month,
    'earned', new.currency || ' ' || to_char(new.payout_due - new.carry_in, 'FM999G999G990D00'),
    'due', new.currency || ' ' || to_char(new.payout_due, 'FM999G999G990D00')));
  return new;
end $$;
create trigger revenue_months_mail after insert on public.revenue_months for each row execute function app.mail_on_statement();

create or replace function app.mail_on_payout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.queue_mail(app.studio_email(new.studio_id), 'payout_sent', jsonb_build_object(
    'amount', new.currency || ' ' || to_char(new.amount, 'FM999G999G990D00'), 'reference', new.reference));
  return new;
end $$;
create trigger payouts_mail after insert on public.payouts for each row execute function app.mail_on_payout();

-- ---------------------------------------------------------------------------------------------
-- Premium perks enforced in the database
-- ---------------------------------------------------------------------------------------------
create or replace function app.premium_plan(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select premium_plan from public.profiles where id = p_user and premium_until > now();
$$;

-- Max members earn double Brain Points from quests. Everything else is unchanged from 0004.
create or replace function app.award_points(p_user uuid, p_delta int, p_reason text, p_ref_type text default null, p_ref_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_lifetime int; v_delta int := p_delta;
begin
  if p_reason = 'quest' and p_delta > 0 and app.premium_plan(p_user) = 'max' then v_delta := p_delta * 2; end if;
  begin
    insert into public.brain_point_ledger (user_id, delta, reason, ref_type, ref_id)
    values (p_user, v_delta, p_reason, p_ref_type, p_ref_id);
  exception when unique_violation then
    return false;
  end;
  select coalesce(sum(delta) filter (where delta > 0), 0) into v_lifetime
  from public.brain_point_ledger where user_id = p_user;
  update public.profiles set
    brain_points = greatest(0, brain_points + v_delta),
    level = app.level_for(v_lifetime)
  where id = p_user;
  return true;
end $$;

/** Max members share two guest passes a month: 7 days of Plus for a friend. */
create or replace function public.create_guest_pass()
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text; v_used int;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if app.premium_plan(auth.uid()) is distinct from 'max'
     or (select premium_from_pass from public.profiles where id = auth.uid()) then perform app.fail('not_allowed'); end if;
  select count(*) into v_used from public.guest_passes where from_user = auth.uid() and created_at >= date_trunc('month', now());
  if v_used >= 2 then perform app.fail('not_allowed'); end if;
  loop
    -- 6 characters from a 32-letter alphabet, from the core random UUID generator (no extension).
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % 32), 1), '') from generate_series(1, 6));
    begin
      insert into public.guest_passes (code, from_user) values (v_code, auth.uid());
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;
  return v_code;
end $$;

create or replace function public.redeem_guest_pass(p_code text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_pass record; v_until timestamptz := now() + interval '7 days'; v_email text;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  perform app.guard('pass', auth.uid()::text, 5, 600);
  select * into v_pass from public.guest_passes where code = upper(trim(p_code)) for update;
  if v_pass is null or v_pass.redeemed_by is not null then perform app.fail('not_found'); end if;
  if v_pass.from_user = auth.uid() then perform app.fail('invalid'); end if;
  if exists (select 1 from public.profiles where id = auth.uid() and premium_plan is not null) then perform app.fail('conflict'); end if;
  update public.guest_passes set redeemed_by = auth.uid(), redeemed_at = now() where code = v_pass.code;
  update public.profiles set premium_plan = 'plus', premium_until = v_until, premium_auto_renew = false, premium_from_pass = true where id = auth.uid();
  select email into v_email from auth.users where id = auth.uid();
  perform app.queue_mail(v_email, 'guest_pass_redeemed', jsonb_build_object('until', to_char(v_until, 'FMDD Month YYYY')));
  return v_until;
end $$;

/** Staff: progress of a Boost order (status, the posted video links, notes). */
create or replace function public.admin_update_boost(p_id uuid, p_status text, p_short_urls text[], p_reel_urls text[], p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare b record; v_new text[];
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  select * into b from public.boosts where id = p_id for update;
  if b is null then perform app.fail('not_found'); end if;
  update public.boosts set
    status = coalesce(p_status, status),
    short_urls = coalesce((select array_agg(u) from unnest(p_short_urls) u where u ~ '^https://'), case when p_short_urls is null then short_urls else '{}' end),
    reel_urls = coalesce((select array_agg(u) from unnest(p_reel_urls) u where u ~ '^https://'), case when p_reel_urls is null then reel_urls else '{}' end),
    notes = coalesce(left(p_notes, 1000), notes)
  where id = p_id;
  select array_agg(u) into v_new from (
    select unnest(short_urls || reel_urls) as u from public.boosts where id = p_id
    except select unnest(b.short_urls || b.reel_urls)
  ) x;
  if v_new is not null then
    perform app.queue_mail(app.studio_email(b.studio_id), 'boost_posted', jsonb_build_object(
      'game', (select title from public.games where id = b.game_id), 'links', array_to_string(v_new, E'\n')));
  end if;
  perform app.audit('update_boost', 'boost', p_id::text, jsonb_build_object('status', p_status));
end $$;

-- The public read model gains the promotion window (new columns go at the end of a view).
create or replace view public.game_cards with (security_barrier = true) as
select
  g.id, g.slug, g.title, g.short_description, g.category, g.tags, g.orientation, g.platforms,
  g.is_multiplayer, g.size_bytes, g.initial_load_bytes, g.status, g.school_safe,
  g.released_at, g.updated_at, g.spark_started_at,
  s.id as studio_id, s.slug as studio_slug, s.name as studio_name, s.country as studio_country,
  s.is_first_party as studio_first_party, s.verified as studio_verified,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', m.kind, 'url', m.url, 'widths', m.widths, 'width', m.width, 'height', m.height,
      'placeholder', m.placeholder, 'variantLabel', m.variant_label) order by m.created_at)
    from public.game_media m where m.game_id = g.id and m.is_active
  ), '[]'::jsonb) as media,
  coalesce(st.plays_total, 0) as plays,
  coalesce(st.plays_7d, 0) as plays_7d,
  st.rating10,
  coalesce(st.likes_180d, 0) + coalesce(st.dislikes_180d, 0) as votes,
  coalesce(st.likes_180d, 0) as likes,
  coalesce(st.dislikes_180d, 0) as dislikes,
  v.id as version_id, v.version, v.storage_prefix, v.entry_file, v.uses_sdk,
  (coalesce(st.plays_total, 0) * (0.5 + coalesce(st.rating10, 7) / 10.0))::double precision as popular_score,
  (coalesce(st.plays_7d, 0) * (0.5 + coalesce(st.rating10, 7) / 10.0))::double precision as trending_score,
  g.description_md, g.how_to_play_md, g.controls, g.faq, g.features_md, g.tips_md,
  g.engine, g.has_progress, g.exclusive_until, g.created_at,
  coalesce(st.rank_score, 0)::double precision as rank_score,
  bo.ends_at as promo_until,
  bo.hero_until as promo_hero_until
from public.games g
join public.studios s on s.id = g.studio_id and s.suspended_at is null
left join public.game_stats st on st.game_id = g.id
left join public.game_versions v on v.id = g.current_version_id
left join lateral (
  select b.ends_at, b.hero_until from public.boosts b
  where b.game_id = g.id and b.status in ('paid', 'live') and b.ends_at > now()
  order by b.ends_at desc limit 1
) bo on true
where g.released_at is not null;

-- Grants, in the explicit style of 0009.
revoke all on public.payments, public.boosts, public.guest_passes, public.email_outbox from anon, authenticated;
grant select on public.payments, public.boosts, public.guest_passes, public.email_outbox to authenticated;
grant all on public.payments, public.boosts, public.guest_passes, public.email_outbox to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke execute on function public.create_guest_pass(), public.redeem_guest_pass(text), public.admin_update_boost(uuid, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.create_guest_pass(), public.redeem_guest_pass(text), public.admin_update_boost(uuid, text, text[], text[], text) to authenticated, service_role;
revoke execute on function app.queue_mail(text, text, jsonb), app.studio_email(uuid) from public, anon, authenticated;
grant execute on function app.queue_mail(text, text, jsonb), app.studio_email(uuid) to service_role;
