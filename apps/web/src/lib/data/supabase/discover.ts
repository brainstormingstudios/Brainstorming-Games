import { emitTopic } from '../bus';
import type { DailyChallenge, DiscoverRepo, Discovery, RisingRow } from '../repo';
import { getSupabase } from './client';
import { toRepoError } from './errors';

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw toRepoError(error);
  return data as T;
}

export const supabaseDiscover: DiscoverRepo = {
  async myDiscoveries() {
    const { data: session } = await getSupabase().auth.getSession();
    if (!session.session) return [];
    return (await rpc<Discovery[] | null>('my_discoveries')) ?? [];
  },
  async discoverers(gameId) {
    return rpc<{ total: number; names: string[] } | null>('game_discoverers', { p_game_id: gameId });
  },
  async rising(limit) {
    const rows = (await rpc<RisingRow[] | null>('rising_games', { p_limit: limit })) ?? [];
    return rows.map((r) => ({ gameId: String(r.gameId), answers: Number(r.answers), score: Number(r.score) }));
  },
  async daily() {
    return rpc<DailyChallenge | null>('daily_challenge');
  },
  async pointDaysThisMonth() {
    const { data: session } = await getSupabase().auth.getSession();
    if (!session.session) return 0;
    return Number(await rpc<number>('point_days_this_month'));
  },
  async redeemPoints(option) {
    const r = await rpc<{ plan: 'plus' | 'max'; until: string }>('redeem_points', { p_option: option });
    emitTopic('session', { local: true });
    emitTopic('points');
    return r;
  },
};
