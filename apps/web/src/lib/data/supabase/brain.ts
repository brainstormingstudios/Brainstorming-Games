import { normaliseSkills } from '@/lib/domain/brain';
import { emitTopic } from '../bus';
import { getAnonId } from '../local';
import type { BrainData, BrainRepo } from '../repo';
import { getSupabase } from './client';
import { toRepoError } from './errors';

type Raw = { rows?: { gameId: string; day: string; seconds: number | string }[]; skills?: Record<string, string[]> } | null;

function toData(raw: Raw): BrainData {
  return {
    rows: (raw?.rows ?? []).map((r) => ({ gameId: String(r.gameId), day: String(r.day), seconds: Number(r.seconds) || 0 })),
    skills: Object.fromEntries(Object.entries(raw?.skills ?? {}).map(([id, s]) => [id, normaliseSkills(s ?? [])])),
  };
}

export const supabaseBrain: BrainRepo = {
  async mine() {
    const { data, error } = await getSupabase().rpc('brain_profile', { p_anon_id: getAnonId() });
    if (error) throw toRepoError(error);
    return toData(data as Raw);
  },
  async of(username) {
    const { data, error } = await getSupabase().rpc('brain_profile_of', { p_username: username });
    if (error) throw toRepoError(error);
    if (!data) return null;
    const d = data as Raw & { username: string; displayName: string };
    return { username: d.username, displayName: d.displayName ?? '', ...toData(d) };
  },
  async reportEnabled() {
    const { data: session } = await getSupabase().auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return false;
    const { data } = await getSupabase().from('profiles').select('brain_report').eq('id', uid).maybeSingle();
    return (data as { brain_report?: boolean } | null)?.brain_report !== false;
  },
  async setReport(on) {
    const { error } = await getSupabase().rpc('set_brain_report', { p_on: on });
    if (error) throw toRepoError(error);
    emitTopic('profile');
  },
};
