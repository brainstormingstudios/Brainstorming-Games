-- 0009_grants: the complete privilege list, in one place.
--
-- Everything in `public` is first revoked from the API roles, then granted back explicitly.
-- A table or function that is not named below cannot be reached by a browser at all, whatever
-- its policies say. RLS then narrows the granted tables to the caller's own rows.
-- When a later migration adds objects, it must add its grants in the same explicit style.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on schema app from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ---- Public read models (guests included) ----------------------------------------------------
grant select on public.game_cards, public.studio_pages, public.public_profiles to anon, authenticated;
grant select on public.site_config, public.game_stats, public.leaderboards to anon, authenticated;
grant select on public.quests, public.cosmetics, public.jams, public.jam_entries, public.devlogs to anon, authenticated;

-- ---- Signed-in players: own rows only (RLS) -----------------------------------------------------
grant select on public.profiles to authenticated;
grant select, insert, delete on public.favorites, public.studio_followers to authenticated;
grant select on public.play_history, public.ratings, public.brain_point_ledger, public.quest_progress,
  public.user_cosmetics, public.friendships, public.play_sessions, public.scores, public.playtest_responses to authenticated;
grant select, update (read_at), delete on public.notifications to authenticated;
grant select, insert, update, delete on public.cloud_saves to authenticated;

-- ---- Developers: their studio and games (RLS). Status, launch and review columns are not
--      writable; those move only through the functions below. -----------------------------------
grant select on public.studios, public.games, public.game_versions, public.game_media, public.daily_game_kpis,
  public.qa_reviews, public.game_launches, public.feedback, public.revenue_months, public.payouts,
  public.referral_visits, public.media_variant_stats to authenticated;
grant update (name, bio, avatar_url, links, contact_email) on public.studios to authenticated;
grant insert (studio_id, slug, title, short_description, description_md, how_to_play_md, controls, faq, features_md,
  tips_md, category, tags, orientation, platforms, engine, is_multiplayer, has_progress, max_score_per_sec, wants_exclusive)
  on public.games to authenticated;
grant update (slug, title, short_description, description_md, how_to_play_md, controls, faq, features_md,
  tips_md, category, tags, orientation, platforms, engine, is_multiplayer, has_progress, max_score_per_sec, wants_exclusive)
  on public.games to authenticated;
grant delete on public.games to authenticated;
grant insert, update, delete on public.game_media to authenticated;
grant update (status) on public.feedback to authenticated;
grant insert, update, delete on public.leaderboards, public.devlogs to authenticated;
grant insert, delete on public.jam_entries to authenticated;

-- ---- Staff (RLS limits these to moderators and admins) ------------------------------------------
grant select on public.reports, public.admin_audit_log, public.revenue_imports to authenticated;
grant insert, update, delete on public.quests, public.cosmetics, public.jams to authenticated;
grant update (rank) on public.jam_entries to authenticated;

-- ---- Functions callable by guests ----------------------------------------------------------------
grant execute on function
  public.rate_game(uuid, int, text, uuid),
  public.search_games(text, int),
  public.ingest_events(uuid, text, text, jsonb, text),
  public.send_feedback(uuid, uuid, text, text, jsonb, text, uuid),
  public.report_content(text, text, text, text, uuid),
  public.preview_version(uuid, text),
  public.my_quests(),
  public.party_create(uuid, text, uuid),
  public.party_get(text),
  public.party_join(text, uuid, text),
  public.party_leave(text, uuid),
  public.party_act(text, uuid, text, uuid, text),
  public.parental_consent_view(text),
  public.parental_consent_resolve(text, boolean),
  public.start_play_session(uuid, uuid, uuid),
  public.leaderboard_top(uuid, text, text, boolean, int),
  public.points_top(text, boolean, int),
  public.record_referral_visit(text, uuid, uuid),
  public.record_variant_stats(uuid, jsonb),
  public.username_available(text)
to anon, authenticated;

-- ---- Functions that need a signed-in caller (each one checks ownership or role itself) -----------
grant execute on function
  public.complete_signup(text, int, text),
  public.update_profile(jsonb),
  public.merge_guest_data(uuid[], jsonb),
  public.record_play(uuid, int, boolean),
  public.export_my_data(),
  public.delete_my_account(),
  public.track_quest_event(text, int),
  public.unlock_cosmetic(uuid),
  public.equip_cosmetics(jsonb),
  public.friend_request(text),
  public.friend_respond(uuid, boolean),
  public.friend_remove(uuid),
  public.my_friends(),
  public.submit_score(uuid, text, double precision, uuid),
  public.submit_playtest(uuid, int, int, boolean),
  public.create_studio(text, text, text, text, text, text, text),
  public.add_game_version(uuid, text, int, bigint, text, boolean, boolean),
  public.mark_pre_qa_running(uuid),
  public.submit_for_review(uuid),
  public.rollback_version(uuid, uuid),
  public.set_game_status(uuid, public.game_status, text),
  public.game_kpis(uuid, date, date),
  public.playtest_summary(uuid),
  public.qa_decide(uuid, text, text, jsonb, boolean),
  public.spark_decide(uuid, boolean, text, jsonb),
  public.set_pre_qa_report(uuid, jsonb),
  public.refresh_daily_game_kpis(date),
  public.pick_ab_winners(),
  public.run_daily_jobs(),
  public.admin_resolve_report(bigint, text),
  public.admin_set_user(uuid, boolean, public.user_role, boolean),
  public.admin_set_studio(uuid, boolean, boolean, public.studio_level, boolean),
  public.admin_set_site_config(text, jsonb),
  public.admin_review_score(bigint, boolean),
  public.admin_revenue_inputs(text),
  public.admin_write_revenue(text, jsonb, jsonb),
  public.admin_record_payout(uuid, text[], text, text)
to authenticated;

-- public.parental_consent_create is for the service role only (granted above with the rest).

-- New objects created later by the migration role start with no API access.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
