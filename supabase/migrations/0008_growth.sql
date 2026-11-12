-- 0008_growth: devlogs, jams, thumbnail A/B tests, playtest panel.

create table public.devlogs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  game_id uuid references public.games (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body_md text not null check (char_length(body_md) <= 20000),
  published_at timestamptz not null default now(),
  hidden_at timestamptz
);
create index devlogs_game_idx on public.devlogs (game_id, published_at desc);

create table public.jams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  title text not null,
  theme text not null default '',
  description_md text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.jam_entries (
  jam_id uuid not null references public.jams (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  rank int,
  primary key (jam_id, game_id)
);

create table public.media_variant_stats (
  game_id uuid not null references public.games (id) on delete cascade,
  variant_label text not null check (variant_label ~ '^[A-D]$'),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  winner boolean not null default false,
  decided_at timestamptz,
  primary key (game_id, variant_label)
);

create table public.playtest_responses (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fun smallint not null check (fun between 1 and 5),
  clarity smallint not null check (clarity between 1 and 5),
  play_again boolean not null,
  created_at timestamptz not null default now(),
  unique (game_id, user_id)
);

alter table public.devlogs enable row level security;
alter table public.jams enable row level security;
alter table public.jam_entries enable row level security;
alter table public.media_variant_stats enable row level security;
alter table public.playtest_responses enable row level security;

create policy devlogs_select on public.devlogs for select using (hidden_at is null or app.owns_studio(studio_id) or app.is_staff());
create policy devlogs_insert on public.devlogs for insert with check (app.owns_studio(studio_id) and (game_id is null or app.owns_game(game_id)));
create policy devlogs_update on public.devlogs for update using (app.owns_studio(studio_id) or app.is_staff())
  with check (app.owns_studio(studio_id) or app.is_staff());
create policy devlogs_delete on public.devlogs for delete using (app.owns_studio(studio_id));
create policy jams_select on public.jams for select using (status <> 'draft' or app.is_staff());
create policy jams_admin on public.jams for all using (app.is_staff()) with check (app.is_staff());
create policy jam_entries_select on public.jam_entries for select using (true);
create policy jam_entries_insert on public.jam_entries for insert with check (
  app.owns_studio(studio_id) and app.owns_game(game_id)
  and exists (select 1 from public.jams j where j.id = jam_id and j.status = 'published' and now() between j.starts_at and j.ends_at));
create policy jam_entries_delete on public.jam_entries for delete using (app.owns_studio(studio_id) or app.is_staff());
create policy jam_entries_rank on public.jam_entries for update using (app.is_staff()) with check (app.is_staff());
create policy variant_stats_select on public.media_variant_stats for select using (app.owns_game(game_id) or app.is_staff());
create policy playtest_select on public.playtest_responses for select using (user_id = auth.uid() or app.is_staff());

-- Followers hear about a studio's new devlog.
create or replace function app.devlog_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select f.user_id, 'devlog', new.title, s.name, '/studio/' || s.slug || '/'
  from public.studio_followers f join public.studios s on s.id = f.studio_id
  where f.studio_id = new.studio_id;
  return new;
end $$;
create trigger devlogs_notify after insert on public.devlogs for each row execute function app.devlog_notify();

/** Batched tile impressions and clicks for thumbnail A/B tests. */
create or replace function public.record_variant_stats(p_anon_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_anon_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then return; end if;
  if not app.take_token('variants:' || p_anon_id::text, 30, 60) then return; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into public.media_variant_stats as s (game_id, variant_label, impressions, clicks)
      values ((r ->> 'gameId')::uuid, r ->> 'variant', least(coalesce((r ->> 'impressions')::int, 0), 5), least(coalesce((r ->> 'clicks')::int, 0), 2))
      on conflict (game_id, variant_label) do update
        set impressions = s.impressions + excluded.impressions, clicks = s.clicks + excluded.clicks
        where s.decided_at is null;
    exception when others then
      continue;
    end;
  end loop;
end $$;

/**
 * Ends every test whose variants have all reached 1,000 impressions: the cover with the best
 * click-through rate stays, the others are switched off. Run by the daily job.
 */
create or replace function public.pick_ab_winners()
returns int language plpgsql security definer set search_path = '' as $$
declare g record; v_winner text; v_count int := 0;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  for g in
    select s.game_id from public.media_variant_stats s
    where s.decided_at is null
    group by s.game_id having count(*) >= 2 and min(s.impressions) >= 1000
  loop
    select variant_label into v_winner from public.media_variant_stats
    where game_id = g.game_id order by clicks::numeric / nullif(impressions, 0) desc nulls last, variant_label limit 1;
    update public.media_variant_stats set decided_at = now(), winner = (variant_label = v_winner) where game_id = g.game_id;
    update public.game_media set is_active = (variant_label = v_winner),
      variant_label = case when variant_label = v_winner then null else variant_label end
    where game_id = g.game_id and kind = 'cover_landscape' and variant_label is not null;
    update public.games set updated_at = now() where id = g.game_id;
    perform app.notify(app.game_owner(g.game_id), 'ab_test', 'Thumbnail test finished',
      'Cover ' || v_winner || ' won and is now your only cover.', '/dev/games/view/?id=' || g.game_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

/** A playtest panel member's three answers about a Spark game. One response per game. */
create or replace function public.submit_playtest(p_game_id uuid, p_fun int, p_clarity int, p_play_again boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and playtest_opt_in and banned_at is null) then
    perform app.fail('not_allowed');
  end if;
  insert into public.playtest_responses (game_id, user_id, fun, clarity, play_again)
  values (p_game_id, auth.uid(), p_fun, p_clarity, p_play_again)
  on conflict (game_id, user_id) do update set fun = excluded.fun, clarity = excluded.clarity, play_again = excluded.play_again;
  perform app.award_points(auth.uid(), 15, 'playtest', 'game', p_game_id::text);
end $$;

create or replace function public.playtest_summary(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.owns_game(p_game_id) or app.is_staff()) then perform app.fail('not_allowed'); end if;
  return (select jsonb_build_object('responses', count(*), 'fun', round(avg(fun), 2), 'clarity', round(avg(clarity), 2),
    'play_again', round(avg(play_again::int), 3)) from public.playtest_responses where game_id = p_game_id);
end $$;

/** The daily job: yesterday's KPIs, finished A/B tests. Called by the health Edge Function. */
create or replace function public.run_daily_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_kpis int; v_ab int;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  v_kpis := public.refresh_daily_game_kpis(current_date - 1);
  perform public.refresh_daily_game_kpis(current_date);
  v_ab := public.pick_ab_winners();
  delete from public.parties where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 days';
  return jsonb_build_object('kpi_rows', v_kpis, 'ab_tests_decided', v_ab);
end $$;
