-- 0035: two more daily puzzles, Sudoku and Mini Crossword, each with its own streak, points and hints.
alter table public.daily_puzzle_results drop constraint if exists daily_puzzle_results_kind_check;
alter table public.daily_puzzle_results add constraint daily_puzzle_results_kind_check check (kind in ('word', 'path', 'sudoku', 'crossword'));
alter table public.daily_streaks drop constraint if exists daily_streaks_kind_check;
alter table public.daily_streaks add constraint daily_streaks_kind_check check (kind in ('word', 'path', 'sudoku', 'crossword'));
alter table public.puzzle_hints drop constraint if exists puzzle_hints_kind_check;
alter table public.puzzle_hints add constraint puzzle_hints_kind_check check (kind in ('word', 'path', 'sudoku', 'crossword'));

/** The puzzle kinds the functions accept. */
create or replace function app.puzzle_kind_ok(p_kind text) returns boolean
language sql immutable set search_path = '' as $$ select p_kind in ('word', 'path', 'sudoku', 'crossword') $$;

create or replace function public.complete_daily_puzzle(p_kind text, p_day date, p_score int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; v_new int; v_freeze boolean := false; v_points int := 0; v_first boolean;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if not app.puzzle_kind_ok(p_kind) or p_day is null or p_day < current_date - 1 or p_day > current_date + 1
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

create or replace function public.buy_puzzle_hint(p_kind text, p_day date)
returns int language plpgsql security definer set search_path = '' as $$
declare p record; v_used int;
begin
  if auth.uid() is null then perform app.fail('login_required'); end if;
  if not app.puzzle_kind_ok(p_kind) or p_day is null or p_day < current_date - 1 or p_day > current_date + 1 then perform app.fail('invalid'); end if;
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
