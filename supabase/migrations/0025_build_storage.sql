-- 0025: game builds in Supabase Storage (the free launch, without a card for Cloudflare R2).
--
-- A private "builds" bucket holds every game build at <storage prefix>/<path>, for example
-- <game id>/1.0/index.html. Only the games server (workers/play) reads it, with its own secret
-- key; nobody can read it straight from Supabase.
--
-- Developers upload into it with their own sign-in, and the rules below keep the same promises as
-- the signed R2 links did:
-- - only into a version of a game they own that is still uploading;
-- - only paths registered first (register_upload, through presign-upload), at the registered size;
-- - only while uploads are open (6 minutes after the last registration), so nothing is added
--   after review (app.block_open_uploads refuses approval while uploads are open);
-- - write-once: there is no update or delete rule, so a file cannot be swapped or removed.
-- 50 MB a file is the Supabase free-plan limit.

/**
 * True when the caller may store `p_name` in the builds bucket now. `p_size` is the stored size
 * when Supabase knows it (null on its early permission check before the upload).
 */
create or replace function app.build_upload_ok(p_name text, p_size bigint) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prefix text := split_part(p_name, '/', 1) || '/' || split_part(p_name, '/', 2);
  v_path text := substr(p_name, char_length(v_prefix) + 2);
  v record;
begin
  if split_part(p_name, '/', 1) = '' or split_part(p_name, '/', 2) = '' or v_path = '' then return false; end if;
  select id, game_id, qa_status, upload_manifest into v from public.game_versions where storage_prefix = v_prefix;
  if v.id is null or v.qa_status <> 'uploaded' or not app.owns_game(v.game_id) or not app.uploads_open(v.id)
     or not (v.upload_manifest ? v_path) then
    return false;
  end if;
  return p_size is null or (v.upload_manifest ->> v_path)::bigint = p_size;
end $$;

revoke all on function app.build_upload_ok(text, bigint) from public, anon;
grant execute on function app.build_upload_ok(text, bigint) to authenticated;

create index if not exists game_versions_storage_prefix_idx on public.game_versions (storage_prefix);

-- Skipped where there is no storage schema, as in tests.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('builds', 'builds', false, 52428800)
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
    execute 'drop policy if exists bg_builds_insert on storage.objects';
    execute $p$create policy bg_builds_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'builds' and app.build_upload_ok(name, nullif(metadata ->> 'size', '')::bigint))$p$;
    -- No select, update or delete policy: only the games server reads, nothing is overwritten.
  end if;
end $$;
