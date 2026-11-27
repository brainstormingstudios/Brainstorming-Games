-- 0033: daily puzzles, streak freezes, profile pictures.
--
-- 1. Daily puzzles (a word puzzle and a path puzzle, the same for everyone each day). Signed-in
--    players keep a streak per puzzle and earn Brain Points once per puzzle per day.
-- 2. Streak freezes: a new thing to spend Brain Points on (not Premium). A freeze keeps a streak
--    alive over one missed day. Up to 3 can be held.
-- 3. Profile pictures: a new Locker slot ('picture') with ready-made pictures bought with Brain
--    Points, and adults may upload their own picture (a small square image) instead.

-- ---- 1. Daily puzzles -----------------------------------------------------------------------
create table public.daily_puzzle_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('word', 'path')),
  day date not null,
  score int not null check (score between 0 and 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.daily_puzzle_results enable row level security;
create policy daily_results_own on public.daily_puzzle_results for select using (user_id = auth.uid());

create table public.daily_streaks (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('word', 'path')),
  streak int not null default 0,
  best int not null default 0,
  last_day date,
  primary key (user_id, kind)
);
alter table public.daily_streaks enable row level security;
create policy daily_streaks_own on public.daily_streaks for select using (user_id = auth.uid());
grant select on public.daily_puzzle_results, public.daily_streaks to authenticated;

alter table public.profiles add column streak_freezes int not null default 0 check (streak_freezes between 0 and 3);

/**
 * A player solved today's puzzle. The day comes from the player's own clock, so it may be a day
 * either side of the server's. Points once per puzzle per day; a missed day uses a freeze if one
 * is held. Returns the streak, the best streak, the points given and whether a freeze was used.
 */
create or replace function public.complete_daily_puzzle(p_kind text, p_day date, p_score int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; v_new int; v_freeze boolean := false; v_points int := 0; v_first boolean;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_kind not in ('word', 'path') or p_day is null or p_day < current_date - 1 or p_day > current_date + 1
     or p_score is null or p_score not between 0 and 1000 then perform app.fail('invalid'); end if;
  perform app.guard('daily_puzzle', auth.uid()::text, 20, 3600);
  insert into public.daily_puzzle_results (user_id, kind, day, score) values (auth.uid(), p_kind, p_day, p_score)
  on conflict do nothing;
  v_first := found;
  select * into s from public.daily_streaks where user_id = auth.uid() and kind = p_kind for update;
  if v_first then
    if s is null or s.last_day is null then
      v_new := 1;
    elsif s.last_day >= p_day then
      v_new := s.streak; -- an earlier day solved late: no change
    elsif s.last_day = p_day - 1 then
      v_new := s.streak + 1;
    elsif s.last_day = p_day - 2 and (select streak_freezes from public.profiles where id = auth.uid()) > 0 then
      update public.profiles set streak_freezes = streak_freezes - 1 where id = auth.uid();
      v_freeze := true;
      v_new := s.streak + 1;
    else
      v_new := 1;
    end if;
    insert into public.daily_streaks (user_id, kind, streak, best, last_day)
    values (auth.uid(), p_kind, v_new, v_new, p_day)
    on conflict (user_id, kind) do update
      set streak = excluded.streak, best = greatest(public.daily_streaks.best, excluded.streak),
          last_day = greatest(coalesce(public.daily_streaks.last_day, excluded.last_day), excluded.last_day);
    -- 10 points, plus 1 for every day of streak up to 10 more.
    v_points := 10 + least(v_new - 1, 10);
    perform app.award_points(auth.uid(), v_points, 'daily_puzzle', p_kind, p_day::text);
    select * into s from public.daily_streaks where user_id = auth.uid() and kind = p_kind;
  end if;
  return jsonb_build_object('streak', coalesce(s.streak, 0), 'best', coalesce(s.best, 0), 'points', v_points, 'freezeUsed', v_freeze, 'first', v_first);
end $$;

/** Today's state for the signed-in player: streaks, results and freezes held. */
create or replace function public.my_daily_puzzles(p_day date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'freezes', coalesce((select streak_freezes from public.profiles where id = auth.uid()), 0),
    'streaks', coalesce((select jsonb_object_agg(kind, jsonb_build_object('streak',
        case when last_day >= p_day - 1 then streak
             when last_day = p_day - 2 and (select streak_freezes from public.profiles where id = auth.uid()) > 0 then streak
             else 0 end, 'best', best, 'lastDay', last_day))
      from public.daily_streaks where user_id = auth.uid()), '{}'::jsonb),
    'done', coalesce((select jsonb_object_agg(kind, score) from public.daily_puzzle_results where user_id = auth.uid() and day = p_day), '{}'::jsonb)
  ) where auth.uid() is not null
$$;

/** Spends 60 Brain Points on a streak freeze (3 at most). Returns how many are held now. */
create or replace function public.buy_streak_freeze()
returns int language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  select * into p from public.profiles where id = auth.uid() and banned_at is null for update;
  if not found then perform app.fail('not_allowed'); end if;
  if p.streak_freezes >= 3 then perform app.fail('conflict'); end if;
  if p.brain_points < 60 then perform app.fail('insufficient_points'); end if;
  perform app.award_points(auth.uid(), -60, 'streak_freeze', 'freeze', extract(epoch from clock_timestamp())::text);
  update public.profiles set streak_freezes = streak_freezes + 1 where id = auth.uid();
  return p.streak_freezes + 1;
end $$;

revoke all on function public.complete_daily_puzzle(text, date, int), public.my_daily_puzzles(date), public.buy_streak_freeze() from public, anon;
grant execute on function public.complete_daily_puzzle(text, date, int), public.my_daily_puzzles(date), public.buy_streak_freeze() to authenticated;

-- ---- 3. Profile pictures --------------------------------------------------------------------
alter table public.cosmetics drop constraint if exists cosmetics_slot_check;
alter table public.cosmetics add constraint cosmetics_slot_check
  check (slot in ('colour', 'hat', 'glasses', 'headphones', 'glow', 'frame', 'picture'));

insert into public.cosmetics (slot, code, name, cost_points, min_level, sort) values
  ('picture', 'rocket', '{"en":"Rocket","hi":"रॉकेट"}', 0, 1, 1),
  ('picture', 'controller', '{"en":"Controller","hi":"कंट्रोलर"}', 0, 1, 2),
  ('picture', 'star', '{"en":"Star","hi":"सितारा"}', 0, 1, 3),
  ('picture', 'cat', '{"en":"Cat","hi":"बिल्ली"}', 80, 1, 4),
  ('picture', 'ghost', '{"en":"Ghost","hi":"भूत"}', 80, 2, 5),
  ('picture', 'planet', '{"en":"Planet","hi":"ग्रह"}', 120, 2, 6),
  ('picture', 'bolt', '{"en":"Lightning","hi":"बिजली"}', 120, 3, 7),
  ('picture', 'flame', '{"en":"Flame","hi":"ज्वाला"}', 160, 3, 8),
  ('picture', 'crown', '{"en":"Crown","hi":"ताज"}', 250, 4, 9),
  ('picture', 'dragon', '{"en":"Dragon","hi":"ड्रैगन"}', 300, 5, 10),
  ('picture', 'trophy', '{"en":"Trophy","hi":"ट्रॉफ़ी"}', 400, 6, 11),
  ('picture', 'brain', '{"en":"Big brain","hi":"बड़ा दिमाग"}', 500, 8, 12)
on conflict (slot, code) do nothing;

alter table public.profiles add column avatar_upload_path text;

/** Uploaded pictures: avatars/<user id>/<name>.webp, small images only, adults only. */
create or replace function app.avatar_path_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  if split_part(p_name, '/', 1) <> auth.uid()::text or p_name !~ '^[0-9a-f-]{36}/[a-z0-9-]{1,40}\.webp$' then return false; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and (is_minor or banned_at is not null)) then return false; end if;
  return app.take_token('avatar_upload:' || auth.uid()::text, 10, 3600);
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 262144, array['image/webp'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists bg_avatars_insert on storage.objects';
    execute $p$create policy bg_avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and app.avatar_path_ok(name))$p$;
  end if;
end $$;

/** Uses an uploaded picture (already in the avatars bucket under the player's folder), or clears it. */
create or replace function public.set_avatar_upload(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if p_path is null then
    update public.profiles set avatar_upload_path = null,
      avatar_cosmetics = avatar_cosmetics - 'picture' - 'pictureUrl' where id = auth.uid();
    return;
  end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text or p_path !~ '^[0-9a-f-]{36}/[a-z0-9-]{1,40}\.webp$' then perform app.fail('invalid'); end if;
  if exists (select 1 from public.profiles where id = auth.uid() and is_minor) then perform app.fail('not_allowed'); end if;
  update public.profiles set avatar_upload_path = p_path where id = auth.uid();
end $$;

/** Admins: removes a player's uploaded picture (for example after a report). */
create or replace function public.admin_clear_avatar(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then perform app.fail('not_allowed'); end if;
  update public.profiles set avatar_upload_path = null,
    avatar_cosmetics = avatar_cosmetics - 'picture' - 'pictureUrl' where id = p_user;
  perform app.audit('clear_avatar', 'user', p_user::text, '{}'::jsonb);
end $$;
revoke all on function public.set_avatar_upload(text), public.admin_clear_avatar(uuid) from public, anon;
grant execute on function public.set_avatar_upload(text), public.admin_clear_avatar(uuid) to authenticated;

/**
 * Wearing items: as in 0004, plus the picture slot. 'upload' means the player's own uploaded
 * picture; its public path is stored next to it so every page can draw it.
 */
create or replace function public.equip_cosmetics(p_equipped jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot text; v_code text; v_out jsonb := '{}'::jsonb; v_path text;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  for v_slot, v_code in select key, value from jsonb_each_text(coalesce(p_equipped, '{}'::jsonb)) loop
    if v_code is null or v_code = '' or v_slot = 'pictureUrl' then continue; end if;
    if v_slot = 'picture' and v_code = 'upload' then
      select avatar_upload_path into v_path from public.profiles where id = auth.uid();
      if v_path is null then perform app.fail('not_allowed'); end if;
      v_out := v_out || jsonb_build_object('picture', 'upload', 'pictureUrl', 'avatars/' || v_path);
      continue;
    end if;
    if not exists (
      select 1 from public.user_cosmetics uc join public.cosmetics c on c.id = uc.cosmetic_id
      where uc.user_id = auth.uid() and c.slot = v_slot and c.code = v_code
    ) then perform app.fail('not_allowed'); end if;
    v_out := v_out || jsonb_build_object(v_slot, v_code);
  end loop;
  update public.profiles set avatar_cosmetics = v_out where id = auth.uid();
  return v_out;
end $$;
