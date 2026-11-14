'use client';

import type { HostLogEntry } from '@/lib/sdk-host/bridge';

export type SdkItem = { id: string; required: boolean; match: (e: HostLogEntry) => boolean };

const event = (name: string) => (e: HostLogEntry) => e.direction === 'in' && e.method === 'game.event' && e.detail.includes(`"${name}"`);
const call = (...methods: string[]) => (e: HostLogEntry) => e.direction === 'in' && methods.includes(e.method);

/** What the Brainstorming SDK expects, in the order a game normally calls it. Required = Rise Launch. */
export const SDK_ITEMS: SdkItem[] = [
  { id: 'init', required: true, match: call('hello') },
  { id: 'loadingStart', required: true, match: event('loading_start') },
  { id: 'loadingStop', required: true, match: event('loading_stop') },
  { id: 'gameplayStart', required: true, match: event('gameplay_start') },
  { id: 'gameplayStop', required: true, match: event('gameplay_stop') },
  { id: 'saves', required: false, match: call('data.get', 'data.set', 'data.remove') },
  { id: 'midgame', required: false, match: call('ad.midgame') },
  { id: 'rewarded', required: false, match: call('ad.rewarded') },
  { id: 'banner', required: false, match: call('ad.banner') },
  { id: 'happytime', required: false, match: call('game.celebrate') },
  { id: 'user', required: false, match: call('user.get', 'user.login', 'user.token') },
];

/** The ids of the SDK features the game has used so far in this run. */
export function sdkSeen(log: HostLogEntry[]): Set<string> {
  return new Set(SDK_ITEMS.filter((it) => log.some(it.match)).map((it) => it.id));
}
