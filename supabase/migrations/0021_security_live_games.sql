-- 0021_security_live_games: no bait-and-switch.
--
-- 1. Text edits to a released game are held for review instead of going live (title, descriptions,
--    tags and so on). The live page keeps the reviewed text until staff approve the change.
-- 2. New covers and videos for a released game are held for review too, and media URLs must point
--    at the game's own folder in our storage, never at another website.
-- 3. The "media" storage bucket: images and videos only, 50 MB a file, uploads only into the
--    folder of a game you own, no overwriting, no deleting through the API.
-- 4. Build uploads: every file is registered before its upload link is signed, so the database
--    knows each path and size; links are short-lived and write-once (see presign-upload). Nothing
--    is approved while upload links may still be open, and a "minor update" only publishes itself
--    when it is close in size to the reviewed build.

-- ---------------------------------------------------------------------------------------------
-- 1. Held text edits
-- ---------------------------------------------------------------------------------------------
create table public.game_pending_edits (
  game_id uuid primary key references public.games (id) on delete cascade,
  changes jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now()
);
alter table public.game_pending_edits enable row level security;
create policy pending_edits_select on public.game_pending_edits
  for select using (app.owns_game(game_id) or app.is_staff());
grant select on public.game_pending_edits to authenticated;

/** The columns of a released game that only change after review. */
create or replace function app.held_columns() returns text[]
language sql immutable set search_path = '' as $$
  select array['title', 'short_description', 'description_md', 'how_to_play_md', 'controls', 'faq',
    'features_md', 'tips_md', 'category', 'tags', 'max_score_per_sec']
$$;

/** Merges a developer's changes into the game's held edit (owner only). */
create or replace function app.save_pending_edit(p_game uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.owns_game(p_game) then perform app.fail('not_allowed'); end if;
  if p_changes = '{}'::jsonb then return; end if;
  insert into public.game_pending_edits as e (game_id, changes, submitted_by)
  values (p_game, p_changes, auth.uid())
  on conflict (game_id) do update
    set changes = e.changes || excluded.changes, submitted_by = excluded.submitted_by, submitted_at = now();
end $$;

/**
 * Runs as the caller (not security definer), so `current_user` tells an update straight from the
 * API ('authenticated') apart from one made inside our own reviewed functions.
 */
create or replace function app.hold_live_edits() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_live jsonb := '{}'::jsonb;
  v_col text;
begin
  if current_user not in ('authenticated', 'anon') or old.released_at is null then
    return new;
  end if;
  -- The address of a released game never changes: links, saves and leaderboards depend on it.
  if new.slug is distinct from old.slug then perform app.fail('invalid'); end if;
  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_col in array app.held_columns() loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      v_changes := v_changes || jsonb_build_object(v_col, v_new -> v_col);
    end if;
    v_live := v_live || jsonb_build_object(v_col, v_old -> v_col);
  end loop;
  perform app.save_pending_edit(old.id, v_changes);
  -- The live page keeps the reviewed values.
  new := jsonb_populate_record(new, v_live);
  return new;
end $$;
create trigger games_hold_live_edits before update on public.games
  for each row execute function app.hold_live_edits();

/** The developer withdraws their held edit and held media. */
create or replace function public.discard_pending_edit(p_game_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.owns_game(p_game_id) then perform app.fail('not_allowed'); end if;
  delete from public.game_pending_edits where game_id = p_game_id;
  delete from public.game_media where game_id = p_game_id and pending;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Held media and own-storage URLs
-- ---------------------------------------------------------------------------------------------
alter table public.game_media add column pending boolean not null default false;
create index game_media_pending_idx on public.game_media (game_id) where pending;

/**
 * The public URL of our storage, e.g. https://<project>.supabase.co (site_config 'media_host',
 * value {"url": "..."}). Until it is set, media URLs are not restricted: set it before launch.
 */
create or replace function app.media_host() returns text
language sql stable security definer set search_path = '' as $$
  select nullif(rtrim(value ->> 'url', '/'), '') from public.site_config where key = 'media_host'
$$;

create or replace function app.game_released(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select released_at is not null from public.games where id = p_game), false)
$$;

/** True when `p_url` is a file in the game's own folder of our media bucket. */
create or replace function app.media_url_ok(p_game uuid, p_url text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_host text := app.media_host();
  v_prefix text;
begin
  if v_host is null then return true; end if;
  v_prefix := v_host || '/storage/v1/object/public/media/' || p_game::text || '/';
  return starts_with(p_url, v_prefix)
    and substr(p_url, char_length(v_prefix) + 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9]{2,4})?\.(webp|mp4|webm)$';
end $$;

create or replace function app.guard_media() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- The main cover or video of a released game is replaced through review, never just removed.
    if app.game_released(old.game_id) and not old.pending and old.variant_label is null and old.is_active then
      perform app.fail('invalid');
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not app.media_url_ok(new.game_id, new.url) then perform app.fail('invalid'); end if;
    new.pending := app.game_released(new.game_id);
    if new.pending then new.is_active := false; end if;
    return new;
  end if;
  -- UPDATE: only the duplicate-check hash and the on/off switch of an approved file may change.
  if new.game_id is distinct from old.game_id or new.kind is distinct from old.kind
     or new.url is distinct from old.url or new.widths is distinct from old.widths
     or new.width is distinct from old.width or new.height is distinct from old.height
     or new.placeholder is distinct from old.placeholder or new.variant_label is distinct from old.variant_label
     or new.pending is distinct from old.pending then
    perform app.fail('invalid');
  end if;
  if new.pending then new.is_active := false; end if;
  return new;
end $$;
create trigger game_media_guard before insert or update or delete on public.game_media
  for each row execute function app.guard_media();

-- The thumbnail test never switches on a cover that is still waiting for review.
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
    where game_id = g.game_id and kind = 'cover_landscape' and variant_label is not null and not pending;
    update public.games set updated_at = now() where id = g.game_id;
    perform app.notify(app.game_owner(g.game_id), 'ab_test', 'Thumbnail test finished',
      'Cover ' || v_winner || ' won and is now your only cover.', '/dev/games/view/?id=' || g.game_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Staff review of held changes
-- ---------------------------------------------------------------------------------------------
/** Released games with held text or media, oldest first, with the live values beside them. */
create or replace function public.admin_pending_changes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  return coalesce((
    select jsonb_agg(x.item order by x.since)
    from (
      select g.id,
        least(e.submitted_at, (select min(m.created_at) from public.game_media m where m.game_id = g.id and m.pending)) as since,
        jsonb_build_object(
          'game_id', g.id, 'title', g.title, 'slug', g.slug, 'status', g.status, 'studio', s.name,
          'submitted_at', least(e.submitted_at, (select min(m.created_at) from public.game_media m where m.game_id = g.id and m.pending)),
          'changes', coalesce(e.changes, '{}'::jsonb),
          'live', coalesce((select jsonb_object_agg(k, to_jsonb(g) -> k) from jsonb_object_keys(coalesce(e.changes, '{}'::jsonb)) k), '{}'::jsonb),
          'media', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'variant_label', m.variant_label,
              'live_url', (select l.url from public.game_media l where l.game_id = g.id and l.kind = m.kind and not l.pending
                and l.is_active and l.variant_label is not distinct from m.variant_label limit 1)) order by m.created_at)
            from public.game_media m where m.game_id = g.id and m.pending), '[]'::jsonb)
        ) as item
      from public.games g
      join public.studios s on s.id = g.studio_id
      left join public.game_pending_edits e on e.game_id = g.id
      where e.game_id is not null or exists (select 1 from public.game_media m where m.game_id = g.id and m.pending)
    ) x
  ), '[]'::jsonb);
end $$;

/** Staff approve or decline a released game's held text and media together. */
create or replace function public.admin_decide_change(p_game_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_changes jsonb;
  v_row public.games;
  m record;
begin
  if not app.is_staff() then perform app.fail('not_allowed'); end if;
  if not p_approve and char_length(trim(coalesce(p_note, ''))) < 10 then perform app.fail('invalid'); end if;
  select changes into v_changes from public.game_pending_edits where game_id = p_game_id;
  if p_approve then
    if v_changes is not null then
      select * into v_row from public.games where id = p_game_id;
      v_row := jsonb_populate_record(v_row, v_changes);
      update public.games set
        title = v_row.title, short_description = v_row.short_description, description_md = v_row.description_md,
        how_to_play_md = v_row.how_to_play_md, controls = v_row.controls, faq = v_row.faq,
        features_md = v_row.features_md, tips_md = v_row.tips_md, category = v_row.category, tags = v_row.tags,
        max_score_per_sec = v_row.max_score_per_sec, updated_at = now()
      where id = p_game_id;
    end if;
    for m in select * from public.game_media where game_id = p_game_id and pending order by created_at loop
      delete from public.game_media
      where game_id = p_game_id and kind = m.kind and not pending and variant_label is not distinct from m.variant_label;
      update public.game_media set pending = false, is_active = true where id = m.id;
    end loop;
    update public.games set updated_at = now() where id = p_game_id;
    perform app.notify(app.game_owner(p_game_id), 'qa', 'Changes approved', 'Your updated page is live.',
      '/dev/games/view/?id=' || p_game_id);
  else
    delete from public.game_media where game_id = p_game_id and pending;
    perform app.notify(app.game_owner(p_game_id), 'qa', 'Changes declined', p_note, '/dev/games/view/?id=' || p_game_id);
  end if;
  delete from public.game_pending_edits where game_id = p_game_id;
  perform app.audit(case when p_approve then 'change_approve' else 'change_decline' end, 'game', p_game_id::text,
    jsonb_build_object('changes', v_changes, 'note', p_note));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. The media bucket (Supabase Storage; skipped where there is no storage schema, as in tests)
-- ---------------------------------------------------------------------------------------------
/** True when `p_name` is `<game id>/<file id>[-<width>].<webp|mp4|webm>` for a game the caller owns. */
create or replace function app.media_path_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9]{2,4})?\.(webp|mp4|webm)$' then
    return false;
  end if;
  if not app.owns_game(split_part(p_name, '/', 1)::uuid) then return false; end if;
  -- 120 files an hour per developer is plenty (each cover is a few sizes).
  return app.take_token('media_upload:' || auth.uid()::text, 120, 3600);
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 52428800, array['image/webp', 'video/mp4', 'video/webm'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists bg_media_insert on storage.objects';
    execute $p$create policy bg_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and app.media_path_ok(name))$p$;
    -- No update or delete policy: files cannot be overwritten or removed through the API.
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Build uploads
-- ---------------------------------------------------------------------------------------------
alter table public.game_versions
  add column upload_manifest jsonb not null default '{}'::jsonb,
  add column last_presign_at timestamptz;

/** Upload links last 5 minutes (presign-upload); a minute of margin on top. */
create or replace function app.uploads_open(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select last_presign_at > now() - interval '6 minutes' from public.game_versions where id = p_version), false)
$$;

/**
 * Called by presign-upload (as the developer) before it signs links: records each path and its
 * exact size. A path keeps its first size; the files may not add up to more than the version's
 * declared file count and bytes; links are only handed out while the version is still uploading.
 */
create or replace function public.register_upload(p_version uuid, p_files jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v record;
  f jsonb;
  v_path text;
  v_size bigint;
  v_manifest jsonb;
begin
  select id, game_id, qa_status, upload_manifest, file_count, total_bytes into v
  from public.game_versions where id = p_version;
  if v.id is null or not app.owns_game(v.game_id) then perform app.fail('not_allowed'); end if;
  if v.qa_status <> 'uploaded' then perform app.fail('invalid'); end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 or jsonb_array_length(p_files) > 100 then
    perform app.fail('invalid');
  end if;
  perform app.guard('presign', auth.uid()::text, 60, 3600);
  v_manifest := v.upload_manifest;
  for f in select * from jsonb_array_elements(p_files) loop
    v_path := f ->> 'path';
    v_size := case when jsonb_typeof(f -> 'size') = 'number' then (f ->> 'size')::numeric::bigint end;
    if v_path is null or char_length(v_path) > 300 or v_path ~ '(^/|\\|//|(^|/)\.\.?(/|$)|[[:cntrl:]])'
       or v_size is null or v_size <= 0 or v_size > 104857600 then
      perform app.fail('invalid');
    end if;
    if v_manifest ? v_path and (v_manifest ->> v_path)::bigint <> v_size then perform app.fail('invalid'); end if;
    v_manifest := v_manifest || jsonb_build_object(v_path, v_size);
  end loop;
  if (select count(*) from jsonb_object_keys(v_manifest)) > v.file_count
     or (select coalesce(sum(value::text::bigint), 0) from jsonb_each(v_manifest)) > v.total_bytes then
    perform app.fail('invalid');
  end if;
  update public.game_versions set upload_manifest = v_manifest, last_presign_at = now() where id = p_version;
end $$;

-- Nothing is approved while its upload links could still be used.
create or replace function app.block_open_uploads() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.qa_status = 'approved' and old.qa_status is distinct from 'approved'
     and new.last_presign_at > now() - interval '6 minutes' then
    perform app.fail('uploads_open');
  end if;
  return new;
end $$;
create trigger game_versions_block_open_uploads before update of qa_status on public.game_versions
  for each row execute function app.block_open_uploads();

/** A minor update may skip human review only when it is close to the reviewed build. */
create or replace function app.minor_update_ok(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select v.minor_update and g.status in ('rise', 'featured') and v.qa_status = 'pre_qa_passed'
      and coalesce(v.pre_qa_report ->> 'status', '') = 'pass'
      and cur.id is not null and v.entry_file = cur.entry_file
      and v.total_bytes between cur.total_bytes * 0.5 and cur.total_bytes * 1.5
      and abs(v.file_count - cur.file_count) <= greatest(10, cur.file_count / 4)
      and not app.uploads_open(v.id)
    from public.game_versions v
    join public.games g on g.id = v.game_id
    left join public.game_versions cur on cur.id = g.current_version_id
    where v.id = p_version
  ), false)
$$;

/**
 * Stores the pre-QA bot's report. A clean minor update of a Full Launch game that is close to
 * the reviewed build publishes straight away, or, while its upload links are still open, as
 * soon as the developer presses Publish (publish_minor_update) a few minutes later.
 */
create or replace function public.set_pre_qa_report(p_version_id uuid, p_report jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_status text := coalesce(p_report ->> 'status', 'fail');
  v record;
  v_new public.qa_status;
begin
  if auth.role() <> 'service_role' and not app.is_staff() then perform app.fail('not_allowed'); end if;
  select gv.id, gv.game_id, gv.minor_update, gv.qa_status, g.status as game_status into v
  from public.game_versions gv join public.games g on g.id = gv.game_id where gv.id = p_version_id;
  if v.id is null then perform app.fail('not_found'); end if;
  v_new := case v_status when 'pass' then 'pre_qa_passed' when 'warn' then 'pre_qa_warn' else 'pre_qa_failed' end;
  update public.game_versions set pre_qa_report = p_report, qa_status = v_new,
    uses_sdk = coalesce((p_report ->> 'usesSdk')::boolean, uses_sdk)
  where id = p_version_id;
  if app.minor_update_ok(p_version_id) and app.take_token('minor_publish:' || v.game_id::text, 3, 604800) then
    perform app.publish_version(p_version_id);
    perform app.notify(app.game_owner(v.game_id), 'version', 'Update published',
      'Your minor update passed pre-QA and is live.', '/dev/games/view/?id=' || v.game_id);
    return 'approved';
  end if;
  perform app.notify(app.game_owner(v.game_id), 'pre_qa', 'Pre-QA report ready',
    'Result: ' || v_status, '/dev/games/view/?id=' || v.game_id);
  return v_new::text;
end $$;

/** The developer publishes a clean minor update once its upload links have closed. */
create or replace function public.publish_minor_update(p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  select game_id into v_game from public.game_versions where id = p_version_id;
  if v_game is null or not app.owns_game(v_game) then perform app.fail('not_allowed'); end if;
  if app.uploads_open(p_version_id) then perform app.fail('uploads_open'); end if;
  if not app.minor_update_ok(p_version_id) then perform app.fail('invalid'); end if;
  if not app.take_token('minor_publish:' || v_game::text, 3, 604800) then perform app.fail('rate_limited'); end if;
  perform app.publish_version(p_version_id);
  perform app.audit('minor_publish', 'game_version', p_version_id::text, jsonb_build_object('game_id', v_game));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function app.save_pending_edit(uuid, jsonb), app.media_path_ok(text), public.register_upload(uuid, jsonb),
  public.discard_pending_edit(uuid), public.publish_minor_update(uuid), public.admin_pending_changes(),
  public.admin_decide_change(uuid, boolean, text) from public, anon;
grant execute on function app.save_pending_edit(uuid, jsonb), app.media_path_ok(text) to authenticated;
-- Read-only helpers the row triggers call as the caller.
grant execute on function app.held_columns(), app.media_host(), app.game_released(uuid), app.media_url_ok(uuid, text)
  to anon, authenticated;
grant execute on function public.register_upload(uuid, jsonb), public.discard_pending_edit(uuid),
  public.publish_minor_update(uuid), public.admin_pending_changes(), public.admin_decide_change(uuid, boolean, text)
  to authenticated;
