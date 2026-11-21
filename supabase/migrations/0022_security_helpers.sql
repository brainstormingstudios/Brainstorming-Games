-- 0022_security_helpers: least privilege for the internal app.* functions.
--
-- Functions made before 0009 kept Postgres's default "anyone may execute". The app schema is not
-- exposed through the API, but if it ever were (or a future function called one by mistake),
-- helpers such as app.publish_version, app.notify, app.audit or app.take_token would let a caller
-- publish builds, message anyone, forge the audit log or rate-limit other people.
--
-- Rule: signed-in users and guests may execute an app.* function only when something that runs
-- as them needs it: a row-security policy, a view, a column default or check, or a function
-- that is not SECURITY DEFINER. Everything else is reachable only from our reviewed
-- SECURITY DEFINER functions (which run as the owner) and the service role.

do $$
declare
  f record;
  v_pat text;
  v_used boolean;
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f'
  loop
    v_pat := '\mapp\.' || f.proname || '\s*\(';
    v_used :=
      exists (select 1 from pg_policies where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ v_pat)
      or exists (select 1 from pg_views where schemaname in ('public', 'app') and definition ~ v_pat)
      or exists (select 1 from pg_attrdef d where pg_get_expr(d.adbin, d.adrelid) ~ v_pat)
      or exists (select 1 from pg_constraint c where c.contype = 'c' and pg_get_constraintdef(c.oid) ~ v_pat)
      or exists (
        select 1 from pg_proc q join pg_namespace qn on qn.oid = q.pronamespace
        where qn.nspname in ('public', 'app') and not q.prosecdef and q.oid <> f.oid and q.prosrc ~ v_pat
      );
    execute format('revoke execute on function app.%I(%s) from public, anon, authenticated', f.proname, f.args);
    execute format('grant execute on function app.%I(%s) to service_role', f.proname, f.args);
    if v_used then
      execute format('grant execute on function app.%I(%s) to anon, authenticated', f.proname, f.args);
    end if;
  end loop;
end $$;

-- Secrets stay out of reach even of helpers that happen to be callable.
revoke all on function app.set_secret(text, text), app.secret_matches(text, text) from anon, authenticated;
