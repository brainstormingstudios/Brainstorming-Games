-- 0001_core: enums, helpers, profiles, studios, catalogue.
--
-- Security model (applies to every migration):
--   * RLS is enabled on every table. With no policy, a table is unreachable for anon and
--     authenticated (default deny).
--   * Clients read the catalogue through views that expose public columns only.
--   * Anything privileged (status changes, points, scores, ratings) goes through SECURITY DEFINER
--     functions that check the caller themselves.
--   * Table and function privileges are granted in one place: 0009_grants.sql.

create schema if not exists app;

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.game_status as enum
  ('draft', 'in_review', 'changes_requested', 'spark', 'rise', 'featured', 'paused', 'removed');
create type public.game_orientation as enum ('landscape', 'portrait', 'any');
create type public.game_platform as enum ('desktop', 'mobile', 'tablet');
create type public.media_kind as enum
  ('cover_landscape', 'cover_portrait', 'cover_square', 'preview_landscape', 'preview_portrait');
create type public.qa_status as enum
  ('uploaded', 'pre_qa_running', 'pre_qa_passed', 'pre_qa_warn', 'pre_qa_failed',
   'in_review', 'approved', 'changes_requested', 'rejected');
create type public.studio_level as enum ('rookie', 'pro', 'partner');
create type public.user_role as enum ('player', 'moderator', 'admin');
create type public.consent_status as enum ('not_required', 'pending', 'granted', 'denied');
create type public.event_type as enum
  ('page_view', 'play_click', 'loading_start', 'loading_stop', 'gameplay_start', 'gameplay_stop',
   'ad_requested', 'ad_started', 'ad_finished', 'ad_error', 'rewarded_granted', 'session_end');

-- ---------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_cosmetics jsonb not null default '{}'::jsonb,
  birth_year int check (birth_year between 1900 and 2100),
  is_minor boolean not null default true,
  parental_consent_status public.consent_status not null default 'pending',
  locale text not null default 'en' check (locale ~ '^[a-z]{2}$'),
  low_data boolean not null default false,
  school_safe boolean not null default false,
  school_safe_pin_hash text,
  brain_points int not null default 0 check (brain_points >= 0),
  level int not null default 1 check (level >= 1),
  streak_days int not null default 0 check (streak_days >= 0),
  streak_last_day date,
  last_active timestamptz,
  role public.user_role not null default 'player',
  banned_at timestamptz,
  profile_public boolean not null default true,
  playtest_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

-- Helper predicates. SECURITY DEFINER so policies can use them without recursive RLS.
create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'moderator') and p.banned_at is null
  );
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.banned_at is null
  );
$$;

/** True when the caller may use social features: an adult, or a minor with parental consent. */
create or replace function app.is_unrestricted(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.banned_at is null and not p.school_safe
      and (not p.is_minor or p.parental_consent_status = 'granted')
  );
$$;

create or replace function app.header(p_name text) returns text
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::json ->> p_name;
$$;

/** Stable key for "this caller": the user id, or the anonymous browser id for guests. */
create or replace function app.caller_key(p_anon uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.uid()::text, 'anon:' || p_anon::text);
$$;

create or replace function app.fail(p_code text) returns void
language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rate limiting: a Postgres token bucket
-- ---------------------------------------------------------------------------------------------
create table public.rate_limits (
  bucket_key text primary key,
  tokens double precision not null,
  updated_at timestamptz not null default now()
);

/**
 * Takes one token from `p_key`. The bucket holds `p_capacity` tokens and refills completely
 * every `p_window_seconds`. Returns false when the caller should be rate limited.
 */
create or replace function app.take_token(p_key text, p_capacity double precision, p_window_seconds double precision)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_tokens double precision;
  v_now timestamptz := clock_timestamp();
begin
  insert into public.rate_limits as r (bucket_key, tokens, updated_at)
  values (p_key, p_capacity - 1, v_now)
  on conflict (bucket_key) do update
    set tokens = least(
          p_capacity,
          r.tokens + extract(epoch from (v_now - r.updated_at)) / p_window_seconds * p_capacity
        ) - 1,
        updated_at = v_now
  returning r.tokens into v_tokens;
  if v_tokens < 0 then
    update public.rate_limits set tokens = 0 where bucket_key = p_key;
    return false;
  end if;
  return true;
end $$;

/** Rate-limit by caller and, when the request came through the API, by a hash of the IP too. */
create or replace function app.guard(p_action text, p_caller text, p_capacity double precision, p_window_seconds double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := split_part(coalesce(app.header('x-forwarded-for'), ''), ',', 1);
begin
  if not app.take_token(p_action || ':' || p_caller, p_capacity, p_window_seconds) then
    perform app.fail('rate_limited');
  end if;
  if v_ip <> '' and not app.take_token(p_action || ':ip:' || md5(v_ip), p_capacity * 4, p_window_seconds) then
    perform app.fail('rate_limited');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Studios
-- ---------------------------------------------------------------------------------------------
create table public.studios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  bio text not null default '' check (char_length(bio) <= 600),
  avatar_url text,
  country text check (country ~ '^[A-Z]{2}$'),
  contact_email text,
  links jsonb not null default '[]'::jsonb,
  verified boolean not null default false,
  is_first_party boolean not null default false,
  level public.studio_level not null default 'rookie',
  suspended_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  guardian_name text,
  created_at timestamptz not null default now()
);
create index studios_owner_idx on public.studios (owner_id);

create or replace function app.owns_studio(p_studio uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.studios s
    where s.id = p_studio and s.owner_id = auth.uid() and s.suspended_at is null
  );
$$;

-- Payout details are encrypted by the payout-profile Edge Function (AES-GCM, key held as a
-- function secret). No policy exists, so only the service role can touch this table.
create table public.studio_payout_profiles (
  studio_id uuid primary key references public.studios (id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_version int not null default 1,
  method text not null,
  currency text not null check (currency in ('INR', 'USD')),
  updated_at timestamptz not null default now()
);

create table public.studio_followers (
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------------------------
-- array_to_string is only STABLE in Postgres, so a generated column cannot call it directly.
-- For a text[] the result never depends on settings, which makes this wrapper safely IMMUTABLE.
create or replace function app.tags_text(p_tags text[]) returns text
language sql immutable as $$
  select array_to_string(p_tags, ' ');
$$;

create table public.games (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  title text not null check (char_length(title) between 1 and 80),
  short_description text not null default '' check (char_length(short_description) <= 160),
  description_md text not null default '',
  how_to_play_md text not null default '',
  controls jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  features_md text not null default '',
  tips_md text not null default '',
  category text not null default 'arcade',
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  orientation public.game_orientation not null default 'landscape',
  platforms public.game_platform[] not null default '{desktop,mobile,tablet}',
  engine text,
  is_multiplayer boolean not null default false,
  has_progress boolean not null default false,
  school_safe boolean not null default false,
  size_bytes bigint not null default 0,
  initial_load_bytes bigint,
  status public.game_status not null default 'draft',
  spark_started_at timestamptz,
  rise_started_at timestamptz,
  exclusive_until timestamptz,
  current_version_id uuid,
  max_score_per_sec double precision,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', app.tags_text(tags)), 'B') ||
    setweight(to_tsvector('simple', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(short_description, '')), 'C')
  ) stored
);
create index games_studio_idx on public.games (studio_id);
create index games_status_idx on public.games (status, released_at desc);
create index games_search_idx on public.games using gin (search);
create index games_tags_idx on public.games using gin (tags);
create index games_updated_idx on public.games (updated_at desc);

create or replace function app.owns_game(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.games g join public.studios s on s.id = g.studio_id
    where g.id = p_game and s.owner_id = auth.uid() and s.suspended_at is null
  );
$$;

create table public.game_versions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  version text not null check (version ~ '^[0-9a-zA-Z][0-9a-zA-Z._-]{0,19}$'),
  storage_prefix text not null,
  file_count int not null default 0 check (file_count <= 1500),
  total_bytes bigint not null default 0 check (total_bytes <= 262144000),
  entry_file text not null default 'index.html',
  uses_sdk boolean not null default false,
  pre_qa_report jsonb,
  qa_status public.qa_status not null default 'uploaded',
  qa_notes text,
  preview_token_hash text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (game_id, version)
);
alter table public.games
  add constraint games_current_version_fk
  foreign key (current_version_id) references public.game_versions (id) on delete set null;

create table public.game_media (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  kind public.media_kind not null,
  url text not null check (url ~ '^https?://'),
  widths int[] not null default '{}',
  width int not null default 0,
  height int not null default 0,
  placeholder text check (placeholder is null or char_length(placeholder) <= 4000),
  variant_label text check (variant_label is null or variant_label ~ '^[A-D]$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index game_media_game_idx on public.game_media (game_id);

-- Public counters. Written only by functions; read through the game_cards view.
create table public.game_stats (
  game_id uuid primary key references public.games (id) on delete cascade,
  plays_total bigint not null default 0,
  plays_7d bigint not null default 0,
  likes_180d int not null default 0,
  dislikes_180d int not null default 0,
  rating10 numeric(3, 1),
  updated_at timestamptz not null default now()
);

create table public.ratings (
  voter_key text not null,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  reason text check (reason in ('bugs', 'slow', 'boring', 'hard', 'controls', 'ads', 'not-my-type')),
  created_at timestamptz not null default now(),
  primary key (voter_key, game_id)
);
create index ratings_game_idx on public.ratings (game_id, created_at desc);

create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.play_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  last_played_at timestamptz not null default now(),
  play_count int not null default 1,
  seconds_played int not null default 0,
  primary key (user_id, game_id)
);

create table public.site_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.site_config (key, value, is_public) values
  ('home', '{"heroGameIds": [], "featuredGameIds": [], "railOrder": [], "hiddenRails": []}', true),
  ('ad_country_weights', '{"default": 0.2, "US": 1, "GB": 0.8, "CA": 0.8, "AU": 0.8, "DE": 0.7, "FR": 0.6, "JP": 0.6, "IN": 0.12}', false),
  ('deploy', '{"lastRequestedAt": null, "lastTriggeredAt": null}', false);

-- ---------------------------------------------------------------------------------------------
-- Rating maths (kept identical to apps/web/src/lib/domain/rating.ts)
-- ---------------------------------------------------------------------------------------------
create or replace function app.bayesian_rating10(p_likes int, p_dislikes int) returns numeric
language sql immutable as $$
  select case when p_likes + p_dislikes = 0 then null
    else round(10.0 * (20 * 0.7 + p_likes) / (20 + p_likes + p_dislikes), 1) end;
$$;

create or replace function app.refresh_rating(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_likes int; v_dislikes int;
begin
  select count(*) filter (where value = 1), count(*) filter (where value = -1)
    into v_likes, v_dislikes
  from public.ratings
  where game_id = p_game and created_at > now() - interval '180 days';
  insert into public.game_stats as s (game_id, likes_180d, dislikes_180d, rating10, updated_at)
  values (p_game, v_likes, v_dislikes, app.bayesian_rating10(v_likes, v_dislikes), now())
  on conflict (game_id) do update
    set likes_180d = excluded.likes_180d, dislikes_180d = excluded.dislikes_180d,
        rating10 = excluded.rating10, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public read models
-- ---------------------------------------------------------------------------------------------
-- These views run with the owner's rights on purpose: they are the public API of the catalogue
-- and expose only columns that are safe for anyone, for games that have been released.
create view public.game_cards with (security_barrier = true) as
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
  g.engine, g.has_progress, g.exclusive_until, g.created_at
from public.games g
join public.studios s on s.id = g.studio_id and s.suspended_at is null
left join public.game_stats st on st.game_id = g.id
left join public.game_versions v on v.id = g.current_version_id
where g.released_at is not null;

create view public.studio_pages with (security_barrier = true) as
select
  s.id, s.slug, s.name, s.country, s.is_first_party, s.verified, s.bio, s.avatar_url, s.links,
  s.level, s.created_at,
  (select count(*) from public.studio_followers f where f.studio_id = s.id) as followers
from public.studios s
where s.suspended_at is null;

create view public.public_profiles with (security_barrier = true) as
select p.id, p.username, p.display_name, p.avatar_cosmetics, p.level, p.brain_points, p.streak_days, p.created_at
from public.profiles p
where p.banned_at is null and p.profile_public
  and (not p.is_minor or p.parental_consent_status = 'granted');

-- ---------------------------------------------------------------------------------------------
-- Player functions
-- ---------------------------------------------------------------------------------------------
/** Casts, changes or (value 0) removes a vote. Guests vote with their anonymous browser id. */
create or replace function public.rate_game(p_game_id uuid, p_value int, p_reason text default null, p_anon_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := app.caller_key(p_anon_id);
begin
  if v_key is null then perform app.fail('invalid'); end if;
  if p_value not in (-1, 0, 1) then perform app.fail('invalid'); end if;
  perform app.guard('rate', v_key, 20, 60);
  if not exists (select 1 from public.games g where g.id = p_game_id and g.status in ('spark', 'rise', 'featured')) then
    perform app.fail('not_found');
  end if;
  if p_value = 0 then
    delete from public.ratings where voter_key = v_key and game_id = p_game_id;
  else
    insert into public.ratings (voter_key, game_id, user_id, value, reason)
    values (v_key, p_game_id, auth.uid(), p_value, case when p_value = -1 then p_reason end)
    on conflict (voter_key, game_id) do update
      set value = excluded.value, reason = excluded.reason, created_at = now();
  end if;
  perform app.refresh_rating(p_game_id);
  return (
    select jsonb_build_object('plays', s.plays_total, 'plays_7d', s.plays_7d, 'rating10', s.rating10,
      'votes', s.likes_180d + s.dislikes_180d, 'likes', s.likes_180d, 'dislikes', s.dislikes_180d)
    from public.game_stats s where s.game_id = p_game_id
  );
end $$;

/** Full-text search over public games, with prefix matching on the last word. */
create or replace function public.search_games(p_query text, p_limit int default 24)
returns setof public.game_cards language plpgsql stable security definer set search_path = '' as $$
declare
  v_terms text[];
  v_tsquery tsquery;
begin
  v_terms := array(
    select t from regexp_split_to_table(lower(left(coalesce(p_query, ''), 80)), '[^[:alnum:]]+') as t where t <> ''
  );
  if cardinality(v_terms) = 0 then return; end if;
  v_tsquery := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) as t), ' & '));
  return query
    select c.* from public.game_cards c
    join public.games g on g.id = c.id
    where c.status in ('spark', 'rise', 'featured') and g.search @@ v_tsquery
    order by ts_rank(g.search, v_tsquery) desc, c.popular_score desc
    limit least(greatest(p_limit, 1), 60);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.rate_limits enable row level security;
alter table public.studios enable row level security;
alter table public.studio_payout_profiles enable row level security;
alter table public.studio_followers enable row level security;
alter table public.games enable row level security;
alter table public.game_versions enable row level security;
alter table public.game_media enable row level security;
alter table public.game_stats enable row level security;
alter table public.ratings enable row level security;
alter table public.favorites enable row level security;
alter table public.play_history enable row level security;
alter table public.site_config enable row level security;

-- profiles: you see and edit your own row; staff see all. Others use public_profiles.
create policy profiles_select_own on public.profiles for select using (id = auth.uid() or app.is_staff());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- studios: owners manage their own; staff see all. The public reads studio_pages.
create policy studios_select on public.studios for select using (owner_id = auth.uid() or app.is_staff());
create policy studios_update on public.studios for update using (owner_id = auth.uid() and suspended_at is null)
  with check (owner_id = auth.uid());

create policy followers_select on public.studio_followers for select using (user_id = auth.uid() or app.owns_studio(studio_id));
create policy followers_insert on public.studio_followers for insert with check (user_id = auth.uid());
create policy followers_delete on public.studio_followers for delete using (user_id = auth.uid());

-- games: owners and staff work on the rows; the public reads game_cards.
create policy games_select on public.games for select using (app.owns_studio(studio_id) or app.is_staff());
create policy games_insert on public.games for insert with check (app.owns_studio(studio_id) and status = 'draft');
create policy games_update on public.games for update using (app.owns_studio(studio_id)) with check (app.owns_studio(studio_id));
create policy games_delete on public.games for delete using (app.owns_studio(studio_id) and status = 'draft');

create policy versions_select on public.game_versions for select using (app.owns_game(game_id) or app.is_staff());
create policy media_select on public.game_media for select using (app.owns_game(game_id) or app.is_staff());
create policy media_insert on public.game_media for insert with check (app.owns_game(game_id));
create policy media_update on public.game_media for update using (app.owns_game(game_id)) with check (app.owns_game(game_id));
create policy media_delete on public.game_media for delete using (app.owns_game(game_id));

create policy game_stats_select on public.game_stats for select using (true);

create policy ratings_select_own on public.ratings for select using (user_id = auth.uid() or app.owns_game(game_id) or app.is_staff());

create policy favorites_all on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy history_all on public.play_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy site_config_select on public.site_config for select using (is_public or app.is_staff());
