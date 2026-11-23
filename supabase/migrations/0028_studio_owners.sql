-- 0028: studio co-owners. A studio keeps one main owner (studios.owner_id: payouts, account
-- deletion rules), and may add co-owners who manage it fully otherwise: its page, games, builds,
-- submissions, Boosts and the Verified tick. Used for the founders on BrainStorming Studios.

create table public.studio_members (
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);
create unique index studio_members_one_studio on public.studio_members (user_id);
alter table public.studio_members enable row level security;

/** The caller's studio: the one they own, or the one they co-own. */
create or replace function app.my_studio_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.studios where owner_id = auth.uid() limit 1),
    (select studio_id from public.studio_members where user_id = auth.uid() limit 1)
  )
$$;

create or replace function public.my_studio_id() returns uuid
language sql stable security definer set search_path = '' as $$ select app.my_studio_id() $$;
revoke all on function public.my_studio_id() from public, anon;
grant execute on function public.my_studio_id() to authenticated;

create or replace function app.owns_studio(p_studio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.studios s
    where s.id = p_studio and s.suspended_at is null
      and (s.owner_id = auth.uid() or exists (select 1 from public.studio_members m where m.studio_id = s.id and m.user_id = auth.uid()))
  );
$$;

create or replace function app.owns_game(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games g where g.id = p_game and app.owns_studio(g.studio_id));
$$;

create policy studio_members_select on public.studio_members for select
  using (user_id = auth.uid() or app.owns_studio(studio_id) or app.is_staff());
grant select on public.studio_members to authenticated;

drop policy studios_select on public.studios;
create policy studios_select on public.studios for select using (app.owns_studio(id) or owner_id = auth.uid() or app.is_staff());
drop policy studios_update on public.studios;
create policy studios_update on public.studios for update using (app.owns_studio(id)) with check (app.owns_studio(id));

drop policy referral_visits_select on public.referral_visits;
create policy referral_visits_select on public.referral_visits for select using (
  app.is_staff() or exists (select 1 from public.studios s where s.slug = studio_slug and app.owns_studio(s.id)));

/** Staff: makes the user with this e-mail a co-owner of the studio (they must have signed up). */
create or replace function public.admin_add_studio_owner(p_studio uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then perform app.fail('not_found'); end if;
  if exists (select 1 from public.studios where owner_id = v_user and id <> p_studio)
     or exists (select 1 from public.studio_members where user_id = v_user and studio_id <> p_studio) then
    perform app.fail('conflict');
  end if;
  insert into public.studio_members (studio_id, user_id, added_by) values (p_studio, v_user, auth.uid())
  on conflict do nothing;
  perform app.notify(v_user, 'studio', 'You are now a studio owner',
    'You can manage ' || (select name from public.studios where id = p_studio) || ' in the developer portal.', '/dev/');
  perform app.audit('studio_owner_added', 'studio', p_studio::text, jsonb_build_object('user', v_user));
  return v_user;
end $$;
revoke all on function public.admin_add_studio_owner(uuid, text) from public, anon;
grant execute on function public.admin_add_studio_owner(uuid, text) to authenticated;

-- One studio per person, owned or co-owned.
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
  if app.my_studio_id() is not null then perform app.fail('conflict'); end if;
  perform app.guard('create_studio', auth.uid()::text, 3, 3600);
  insert into public.studios (owner_id, name, slug, country, contact_email, terms_version, terms_accepted_at, guardian_name)
  values (auth.uid(), trim(p_name), lower(p_slug), upper(p_country), p_contact_email, p_terms_version, now(),
          case when p_holder = 'minor_with_guardian' then trim(p_guardian_name) end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.my_boost_credits()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.boost_credits c join public.studios s on s.id = c.studio_id
  where s.id = app.my_studio_id() and c.used_at is null;
$$;

create or replace function public.redeem_boost_credit(p_game_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_game record; v_credit uuid; v_boost uuid;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  select g.* into v_game from public.games g join public.studios s on s.id = g.studio_id
  where g.id = p_game_id and app.owns_studio(s.id);
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

create or replace function public.my_verified()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('verified', s.verified, 'source', s.verified_source, 'until', s.verified_until,
    'foundingNumber', s.founding_number, 'firstParty', s.is_first_party)
  from public.studios s where s.id = app.my_studio_id()
$$;
