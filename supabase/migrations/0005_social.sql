-- 0005_social: friends, party rooms, parental consent, profile settings, account data rights.

create table public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index friendships_addressee_idx on public.friendships (addressee);

-- A party is a short-lived lobby. Members are keyed by user id or anonymous id; chat lines are
-- ids of preset phrases only (no free text anywhere).
create table public.parties (
  code text primary key check (code ~ '^[A-Z0-9]{4,6}$'),
  host_key text not null,
  current_game_id uuid references public.games (id) on delete set null,
  members jsonb not null default '[]'::jsonb,
  votes jsonb not null default '{}'::jsonb,
  chat jsonb not null default '[]'::jsonb,
  state text not null default 'lobby' check (state in ('lobby', 'playing')),
  expires_at timestamptz not null default now() + interval '6 hours',
  updated_at timestamptz not null default now()
);

create table public.parental_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  parent_email_hash text not null,
  status public.consent_status not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days'
);
create index parental_consents_user_idx on public.parental_consents (user_id, requested_at desc);

alter table public.friendships enable row level security;
alter table public.parties enable row level security;
alter table public.parental_consents enable row level security;

create policy friendships_select on public.friendships for select using (auth.uid() in (requester, addressee));
-- Parties and consent records are reached only through the functions below.

create or replace function app.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = p_a and f.addressee = p_b) or (f.requester = p_b and f.addressee = p_a))
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------------------------
create or replace function public.friend_request(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_other uuid;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if not app.is_unrestricted(auth.uid()) then perform app.fail('not_allowed'); end if;
  perform app.guard('friend_request', auth.uid()::text, 20, 3600);
  select id into v_other from public.profiles where username = lower(trim(p_username)) and banned_at is null;
  if v_other is null or v_other = auth.uid() then perform app.fail('not_found'); end if;
  -- Minors without consent, and school-safe accounts, cannot be added either.
  if not app.is_unrestricted(v_other) then perform app.fail('not_found'); end if;
  if app.are_friends(auth.uid(), v_other) then return 'accepted'; end if;
  -- If they already asked us, this accepts it.
  update public.friendships set status = 'accepted', responded_at = now()
  where requester = v_other and addressee = auth.uid() and status = 'pending';
  if found then
    perform app.notify(v_other, 'friend', 'Friend request accepted', '', '/friends/');
    return 'accepted';
  end if;
  insert into public.friendships (requester, addressee) values (auth.uid(), v_other) on conflict do nothing;
  perform app.notify(v_other, 'friend', 'New friend request',
    (select username from public.profiles where id = auth.uid()), '/friends/');
  return 'pending';
end $$;

create or replace function public.friend_respond(p_requester uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_accept then
    if not app.is_unrestricted(auth.uid()) then perform app.fail('not_allowed'); end if;
    update public.friendships set status = 'accepted', responded_at = now()
    where requester = p_requester and addressee = auth.uid() and status = 'pending';
    if found then perform app.notify(p_requester, 'friend', 'Friend request accepted', '', '/friends/'); end if;
  else
    delete from public.friendships where requester = p_requester and addressee = auth.uid() and status = 'pending';
  end if;
end $$;

create or replace function public.friend_remove(p_other uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
  where (requester = auth.uid() and addressee = p_other) or (requester = p_other and addressee = auth.uid());
$$;

/** Friends and pending requests of the caller, with the public part of each profile. */
create or replace function public.my_friends()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'avatar_cosmetics', p.avatar_cosmetics, 'level', p.level,
    'status', f.status,
    'direction', case when f.requester = auth.uid() then 'outgoing' else 'incoming' end,
    'last_active', p.last_active) order by f.status, p.username), '[]'::jsonb)
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee) and p.banned_at is null;
$$;

-- ---------------------------------------------------------------------------------------------
-- Party rooms
-- ---------------------------------------------------------------------------------------------
create or replace function app.party_member(p_anon uuid, p_alias text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is not null then
    select * into p from public.profiles where id = auth.uid();
  end if;
  return jsonb_build_object(
    'key', app.caller_key(p_anon),
    'name', coalesce(nullif(p.display_name, ''), p.username, left(regexp_replace(coalesce(p_alias, 'Guest'), '[^A-Za-z0-9 _-]', '', 'g'), 16)),
    'cosmetics', coalesce(p.avatar_cosmetics, '{}'::jsonb),
    -- Party chat is off for minors without consent and in school-safe mode.
    'can_chat', auth.uid() is not null and app.is_unrestricted(auth.uid()));
end $$;

create or replace function public.party_create(p_anon_id uuid, p_alias text default 'Guest', p_game_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := app.caller_key(p_anon_id);
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_key is null then perform app.fail('invalid'); end if;
  perform app.guard('party_create', v_key, 6, 600);
  delete from public.parties where expires_at < now();
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.parties where code = v_code);
  end loop;
  insert into public.parties (code, host_key, current_game_id, members)
  values (v_code, v_key, p_game_id, jsonb_build_array(app.party_member(p_anon_id, p_alias)));
  return public.party_get(v_code);
end $$;

create or replace function public.party_get(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.parties p where p.code = upper(p_code) and p.expires_at > now();
$$;

create or replace function public.party_join(p_code text, p_anon_id uuid, p_alias text default 'Guest')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text := app.caller_key(p_anon_id); p public.parties;
begin
  if v_key is null then perform app.fail('invalid'); end if;
  perform app.guard('party_join', v_key, 30, 600);
  select * into p from public.parties where code = upper(p_code) and expires_at > now() for update;
  if p.code is null then perform app.fail('not_found'); end if;
  if jsonb_array_length(p.members) >= 12 and not exists (
    select 1 from jsonb_array_elements(p.members) m where m ->> 'key' = v_key) then
    perform app.fail('conflict');
  end if;
  update public.parties set
    members = (select coalesce(jsonb_agg(m), '[]'::jsonb) from jsonb_array_elements(p.members) m where m ->> 'key' <> v_key)
              || jsonb_build_array(app.party_member(p_anon_id, p_alias)),
    updated_at = now()
  where code = p.code;
  return public.party_get(p.code);
end $$;

create or replace function public.party_leave(p_code text, p_anon_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := app.caller_key(p_anon_id); p public.parties; v_members jsonb;
begin
  select * into p from public.parties where code = upper(p_code) for update;
  if p.code is null then return; end if;
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_members
  from jsonb_array_elements(p.members) m where m ->> 'key' <> v_key;
  if jsonb_array_length(v_members) = 0 then
    delete from public.parties where code = p.code;
  else
    update public.parties set members = v_members, votes = votes - v_key,
      host_key = case when host_key = v_key then v_members -> 0 ->> 'key' else host_key end,
      updated_at = now()
    where code = p.code;
  end if;
end $$;

/** Vote for the next game, send a preset chat line, or (host only) pick the game and start. */
create or replace function public.party_act(p_code text, p_anon_id uuid, p_action text, p_game_id uuid default null, p_phrase text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text := app.caller_key(p_anon_id); p public.parties; v_member jsonb;
begin
  perform app.guard('party_act', v_key, 60, 60);
  select * into p from public.parties where code = upper(p_code) and expires_at > now() for update;
  if p.code is null then perform app.fail('not_found'); end if;
  select m into v_member from jsonb_array_elements(p.members) m where m ->> 'key' = v_key;
  if v_member is null then perform app.fail('not_allowed'); end if;

  if p_action = 'vote' then
    if p_game_id is null or not exists (select 1 from public.games g where g.id = p_game_id and g.status in ('spark', 'rise', 'featured')) then
      perform app.fail('invalid');
    end if;
    update public.parties set votes = votes || jsonb_build_object(v_key, p_game_id), updated_at = now() where code = p.code;
  elsif p_action = 'chat' then
    -- Only ids from the fixed phrase list are accepted; there is no free text.
    if not coalesce((v_member ->> 'can_chat')::boolean, false) then perform app.fail('not_allowed'); end if;
    if p_phrase !~ '^[a-z0-9_]{1,24}$' then perform app.fail('invalid'); end if;
    update public.parties set
      chat = (select coalesce(jsonb_agg(c), '[]'::jsonb) from (
                select c from jsonb_array_elements(p.chat || jsonb_build_array(jsonb_build_object(
                  'key', v_key, 'name', v_member ->> 'name', 'phrase', p_phrase, 'at', now()))) with ordinality as t(c, n)
                order by n desc limit 30) recent),
      updated_at = now()
    where code = p.code;
  elsif p_action in ('set_game', 'start', 'lobby') then
    if p.host_key <> v_key then perform app.fail('not_allowed'); end if;
    update public.parties set
      current_game_id = case when p_action = 'lobby' then current_game_id else coalesce(p_game_id, current_game_id) end,
      state = case when p_action = 'start' then 'playing' when p_action = 'lobby' then 'lobby' else state end,
      votes = case when p_action = 'start' then '{}'::jsonb else votes end,
      expires_at = now() + interval '6 hours',
      updated_at = now()
    where code = p.code;
  else
    perform app.fail('invalid');
  end if;
  return public.party_get(p.code);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Parental consent
-- ---------------------------------------------------------------------------------------------
/** Called by the parental-consent Edge Function (service role) after it has e-mailed the link. */
create or replace function public.parental_consent_create(p_user uuid, p_token_hash text, p_parent_email_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then perform app.fail('not_allowed'); end if;
  if not exists (select 1 from public.profiles where id = p_user and is_minor) then perform app.fail('invalid'); end if;
  delete from public.parental_consents where user_id = p_user and status = 'pending';
  insert into public.parental_consents (user_id, token_hash, parent_email_hash) values (p_user, p_token_hash, p_parent_email_hash);
  update public.profiles set parental_consent_status = 'pending' where id = p_user;
end $$;

/** What the parent sees before deciding: the child's username and nothing else. */
create or replace function public.parental_consent_view(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', p.username, 'status', c.status, 'expired', c.expires_at < now())
  from public.parental_consents c join public.profiles p on p.id = c.user_id
  where c.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
$$;

/** The parent's decision. The token from the e-mail is the only credential. */
create or replace function public.parental_consent_resolve(p_token text, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.parental_consents;
begin
  perform app.guard('consent', md5(coalesce(p_token, '')), 10, 600);
  select * into c from public.parental_consents
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') for update;
  if c.id is null then perform app.fail('not_found'); end if;
  if c.expires_at < now() then perform app.fail('invalid'); end if;
  update public.parental_consents set
    status = case when p_approve then 'granted'::public.consent_status else 'denied'::public.consent_status end,
    resolved_at = now()
  where id = c.id;
  update public.profiles set
    parental_consent_status = case when p_approve then 'granted'::public.consent_status else 'denied'::public.consent_status end
  where id = c.user_id;
  perform app.notify(c.user_id, 'consent',
    case when p_approve then 'Your parent approved your account' else 'Your parent declined' end, '', '/settings/');
  return case when p_approve then 'granted' else 'denied' end;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Profile, guest merge, data export and account deletion
-- ---------------------------------------------------------------------------------------------
create or replace function public.update_profile(p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  update public.profiles set
    display_name = coalesce(left(p_patch ->> 'display_name', 40), display_name),
    locale = case when p_patch ->> 'locale' ~ '^[a-z]{2}$' then p_patch ->> 'locale' else locale end,
    low_data = coalesce((p_patch ->> 'low_data')::boolean, low_data),
    school_safe = coalesce((p_patch ->> 'school_safe')::boolean, school_safe),
    school_safe_pin_hash = case when p_patch ? 'school_safe_pin_hash' then p_patch ->> 'school_safe_pin_hash' else school_safe_pin_hash end,
    profile_public = coalesce((p_patch ->> 'profile_public')::boolean, profile_public),
    playtest_opt_in = coalesce((p_patch ->> 'playtest_opt_in')::boolean, playtest_opt_in)
  where id = auth.uid();
end $$;

/** Moves a guest's favourites and history into the account at first login. Safe to repeat. */
create or replace function public.merge_guest_data(p_favourites uuid[], p_history jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  insert into public.favorites (user_id, game_id)
  select auth.uid(), g.id from public.games g where g.id = any (coalesce(p_favourites, '{}'::uuid[]))
  on conflict do nothing;
  insert into public.play_history as h (user_id, game_id, last_played_at, play_count, seconds_played)
  select auth.uid(), g.id,
    least(now(), coalesce((e ->> 'lastPlayedAt')::timestamptz, now())),
    least(coalesce((e ->> 'playCount')::int, 1), 100000),
    least(coalesce((e ->> 'secondsPlayed')::int, 0), 100000000)
  from jsonb_array_elements(coalesce(p_history, '[]'::jsonb)) e
  join public.games g on g.id = (e ->> 'gameId')::uuid
  on conflict (user_id, game_id) do update set
    last_played_at = greatest(h.last_played_at, excluded.last_played_at),
    play_count = h.play_count + excluded.play_count,
    seconds_played = h.seconds_played + excluded.seconds_played;
end $$;

create or replace function public.record_play(p_game_id uuid, p_seconds int, p_new_session boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.play_history as h (user_id, game_id, play_count, seconds_played)
  select auth.uid(), p_game_id, 1, greatest(least(p_seconds, 3600), 0)
  where auth.uid() is not null and exists (select 1 from public.games where id = p_game_id)
  on conflict (user_id, game_id) do update set
    last_played_at = now(),
    play_count = h.play_count + (case when p_new_session then 1 else 0 end),
    seconds_played = h.seconds_played + greatest(least(p_seconds, 3600), 0);
$$;

/** Everything we hold about the caller, as one JSON document (the "download my data" button). */
create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'school_safe_pin_hash' from public.profiles p where p.id = auth.uid()),
    'favorites', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.favorites f where f.user_id = auth.uid()),
    'play_history', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.play_history h where h.user_id = auth.uid()),
    'ratings', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.ratings r where r.user_id = auth.uid()),
    'brain_points', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.brain_point_ledger l where l.user_id = auth.uid()),
    'quests', (select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from public.quest_progress q where q.user_id = auth.uid()),
    'cosmetics', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.user_cosmetics c where c.user_id = auth.uid()),
    'friends', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.friendships f where auth.uid() in (f.requester, f.addressee)),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from public.notifications n where n.user_id = auth.uid())
  )
  where auth.uid() is not null;
$$;

/** Deletes the caller's account. Foreign keys cascade to every table that holds their data. */
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if exists (select 1 from public.studios where owner_id = auth.uid()) then
    -- A studio with published games and payouts has to be closed by support first.
    perform app.fail('conflict');
  end if;
  delete from public.ratings where user_id = auth.uid();
  update public.events set user_id = null where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
