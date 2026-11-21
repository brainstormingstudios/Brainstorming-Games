/**
 * A tiny pub/sub for "this data changed" signals.
 * Mutations emit a topic; queries subscribed to it refetch. Signals also reach other tabs through
 * a BroadcastChannel, which is what makes two tabs feel like two connected players in mock mode.
 */
export type Topic =
  | 'catalogue'
  | 'creators'
  | 'ratings'
  | 'favourites'
  | 'history'
  | 'session'
  | 'profile'
  | 'quests'
  | 'points'
  | 'friends'
  | 'party'
  | 'notifications'
  | 'leaderboards'
  | 'studio'
  | 'dev-games'
  | 'qa'
  | 'admin'
  | 'revenue'
  | 'jams'
  | 'devlogs'
  | 'saves';

export const ALL_TOPICS: readonly Topic[] = [
  'catalogue',
  'ratings',
  'favourites',
  'history',
  'profile',
  'quests',
  'points',
  'friends',
  'party',
  'notifications',
  'leaderboards',
  'studio',
  'dev-games',
  'qa',
  'admin',
  'revenue',
  'jams',
  'devlogs',
  'saves',
];

type Listener = () => void;

let externalSignal: (() => void) | null = null;
/** Called just before a signal from another tab is delivered (the mock database drops its cache). */
export function onExternalSignal(fn: () => void): void {
  externalSignal = fn;
}

const listeners = new Map<string, Set<Listener>>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    channel = null;
    return channel;
  }
  channel = new BroadcastChannel('bg-bus');
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as { topic?: unknown } | null;
    if (data && typeof data.topic === 'string') {
      // Another tab changed something: whatever is cached about the shared store is suspect.
      externalSignal?.();
      notify(data.topic);
    }
  };
  return channel;
}

function notify(topic: string): void {
  const set = listeners.get(topic);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener();
    } catch (err) {
      console.error('[bus] listener failed', err);
    }
  }
}

/** Subscribes to a topic. Returns the unsubscribe function. */
export function onTopic(topic: Topic, listener: Listener): () => void {
  getChannel();
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Announces a change in this tab and, unless `local` is set, in every other tab. */
export function emitTopic(topic: Topic, options: { local?: boolean } = {}): void {
  notify(topic);
  if (!options.local) getChannel()?.postMessage({ topic });
}
