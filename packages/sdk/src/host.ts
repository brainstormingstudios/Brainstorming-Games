/**
 * Host-side message validation (used by the site, never bundled into games).
 * Every message from a game is parsed with these schemas; anything that does not match is
 * dropped. The parent never evaluates anything a game sends.
 */
import { z } from 'zod';
import { PROTOCOL, PROTOCOL_VERSION, type MethodName, type Methods } from './protocol';

export { AdRules, AD_RULES } from './adRules';
export { createMockProvider } from './ads/mock';
export { createAdsenseH5Provider } from './ads/adsenseH5';
export { detectAdblock, noneProvider, type AdOutcome, type AdProvider } from './ads/provider';
export * from './protocol';

const empty = z.object({}).strict();
const key = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const smallJson = z.unknown().refine((v) => {
  try {
    return JSON.stringify(v ?? null).length <= 1_048_576;
  } catch {
    return false;
  }
}, 'value too large or not JSON');

export const paramSchemas: { [M in MethodName]: z.ZodType<Methods[M]['params']> } = {
  hello: z.object({ version: z.string().max(20) }),
  'game.event': z.object({ name: z.enum(['loading_start', 'loading_stop', 'gameplay_start', 'gameplay_stop']) }),
  'game.celebrate': empty,
  'game.progress': z.object({ pct: z.number().min(0).max(100) }),
  'game.context': z.object({
    context: z
      .record(z.string().max(64), z.unknown())
      .refine((v) => JSON.stringify(v).length <= 4096, 'context too large')
      .nullable(),
  }),
  'game.room': z.object({
    roomId: z.string().min(1).max(64),
    isJoinable: z.boolean(),
    inviteParams: z.record(z.string().max(32), z.string().max(128)).optional(),
  }),
  'ad.midgame': empty,
  'ad.rewarded': empty,
  'ad.banner': z.object({
    containerId: z.string().min(1).max(64),
    size: z.string().regex(/^\d{2,4}x\d{2,4}$/),
    rect: z.object({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) }),
  }),
  'ad.hideBanner': z.object({ containerId: z.string().min(1).max(64) }),
  'ad.adblock': empty,
  'user.get': empty,
  'user.token': empty,
  'user.login': empty,
  'data.get': z.object({ key }),
  'data.set': z.object({ key, value: smallJson }),
  'data.remove': z.object({ key }),
  'lb.submit': z.object({ board: z.string().regex(/^[a-z0-9_-]{1,32}$/), score: z.number().finite() }),
  'lb.top': z.object({
    board: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    limit: z.number().int().min(1).max(100),
    friends: z.boolean(),
  }),
  'quests.track': z.object({ event: z.string().regex(/^[a-z0-9_]{1,40}$/), value: z.number().int().min(0).max(1000) }),
} as never;

const requestSchema = z.object({
  p: z.literal(PROTOCOL),
  v: z.literal(PROTOCOL_VERSION),
  kind: z.literal('req'),
  id: z.number().int().positive(),
  method: z.enum(Object.keys(paramSchemas) as [MethodName, ...MethodName[]]),
  params: z.unknown(),
});

export type ParsedRequest = { [M in MethodName]: { id: number; method: M; params: Methods[M]['params'] } }[MethodName];

/** Returns a validated request, or null when the message is not a well-formed SDK request. */
export function parseRequest(data: unknown): ParsedRequest | null {
  const envelope = requestSchema.safeParse(data);
  if (!envelope.success) return null;
  const params = paramSchemas[envelope.data.method].safeParse(envelope.data.params ?? {});
  if (!params.success) return { id: envelope.data.id, method: envelope.data.method, params: undefined } as never;
  return { id: envelope.data.id, method: envelope.data.method, params: params.data } as ParsedRequest;
}
