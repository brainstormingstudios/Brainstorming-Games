-- 0015: the developer preview page shows the build's size, review state and pre-QA report
-- (the requirements panel). Still only for someone holding the preview link's token.
create or replace function public.preview_version(p_version_id uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('game_id', g.id, 'title', g.title, 'slug', g.slug, 'orientation', g.orientation,
    'version_id', v.id, 'version', v.version, 'storage_prefix', v.storage_prefix, 'entry_file', v.entry_file,
    'uses_sdk', v.uses_sdk, 'total_bytes', v.total_bytes, 'qa_status', v.qa_status, 'game_status', g.status,
    'pre_qa_report', v.pre_qa_report)
  from public.game_versions v join public.games g on g.id = v.game_id
  where v.id = p_version_id
    and v.preview_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
$$;
