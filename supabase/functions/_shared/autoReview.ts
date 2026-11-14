/**
 * Auto-review: the checks that run on every submission before a person reviews it. They catch
 * the common problems quickly and put the risky submissions at the top of the queue; a moderator
 * always makes the final decision.
 *
 * What a machine can honestly check here:
 *   - the developer declared they own or have licensed everything in the game
 *   - famous game, film and cartoon names in the title, description or tags (likely unlicensed)
 *   - the same build, or a near-identical cover, already published by another studio (copied)
 *   - a title very close to another studio's game
 *   - other portals' SDKs, ad networks or outside requests found by the pre-QA bot
 *   - words that point to gambling or adult content
 * What it cannot: judge whether art is appropriate, or prove who owns a game. Those stay with the
 * moderator, and the report says so.
 *
 * Plain TypeScript with no imports: used by the web app and by the Edge Functions (Deno).
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'manual';

export interface AutoCheck {
  id: string;
  status: CheckStatus;
  /** Short explanation for the moderator (and the developer, on a fail). */
  detail: string;
}

export interface AutoReviewReport {
  status: 'pass' | 'warn' | 'fail';
  checks: AutoCheck[];
  ranAt: string;
}

export interface Declaration {
  /** "I made this game, or I have a licence for every part of it: code, art, music, fonts." */
  ownsRights: boolean;
  /** "Nothing in it is copied from another game, film or brand." */
  noCopies: boolean;
  /** Third-party assets and their licences, e.g. "Music: Kevin MacLeod, CC BY 4.0". */
  credits: string;
}

export interface OtherGame {
  title: string;
  studioId: string;
  buildFingerprints: string[];
  coverHashes: string[];
}

export interface ReviewInput {
  title: string;
  description: string;
  tags: string[];
  studioId: string;
  declaration: Declaration | null;
  buildFingerprint: string | null;
  coverHashes: string[];
  /** Ids of pre-QA checks that failed or warned. */
  preQaProblems: { id: string; status: 'warn' | 'fail' }[];
  /** Released games of all studios (this one included; it is skipped by studio id). */
  others: OtherGame[];
}

/** Names of well-known games, characters and brands. A match needs a licence, not a guess. */
export const PROTECTED_NAMES = [
  'subway surfers', 'minecraft', 'mario', 'luigi', 'pokemon', 'pokémon', 'pikachu', 'fortnite', 'among us', 'roblox',
  'angry birds', 'bad piggies', 'candy crush', 'temple run', 'pubg', 'battlegrounds', 'free fire', 'gta', 'grand theft auto',
  'sonic', 'pac-man', 'pacman', 'tetris', 'flappy bird', 'clash of clans', 'clash royale', 'brawl stars', 'hill climb racing',
  'ludo king', 'fifa', 'call of duty', 'zelda', 'kirby', 'donkey kong', 'spider-man', 'spiderman', 'marvel', 'avengers',
  'disney', 'pixar', 'frozen', 'barbie', 'hot wheels', 'lego', 'toca boca', 'purble place', 'stick war', 'bowmasters',
  'doraemon', 'shinchan', 'shin-chan', 'chhota bheem', 'motu patlu', 'peppa pig', 'paw patrol', 'cocomelon', 'harry potter',
  'star wars', 'geometry dash', 'slither.io', 'agar.io', 'cut the rope', 'plants vs zombies', 'fruit ninja', 'crossy road',
  'talking tom', 'pou', 'five nights at freddy', 'fnaf', 'poppy playtime', 'huggy wuggy', 'skibidi', 'squid game',
  'counter-strike', 'valorant', 'league of legends', 'dota', 'overwatch', 'apex legends', 'genshin', 'batman', 'superman',
  'naruto', 'dragon ball', 'one piece', 'shrek', 'minions', 'sponge bob', 'spongebob', 'tom and jerry', 'scooby',
];

const RISKY_WORDS: { word: RegExp; why: string }[] = [
  { word: /\b(casino|real[- ]money|betting|bet to win|jackpot|teen ?patti|rummy|satta|lottery)\b/i, why: 'gambling' },
  { word: /\b(nsfw|porn|sexy|nude|xxx|18\+|adults? only)\b/i, why: 'adult content' },
  { word: /\b(gore|dismember|torture)\b/i, why: 'graphic violence' },
];

/** Problems found by the pre-QA bot that mean code or content from somewhere else. */
const PRE_QA_SOURCING = new Set(['third-party-sdk', 'external-ads', 'external-requests', 'other-portal-sdk']);

const normalise = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function similarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

/** Bits that differ between two 64-bit hex hashes. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let v = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (v) {
      n += v & 1;
      v >>= 1;
    }
  }
  return n;
}

function hasName(text: string, name: string): boolean {
  const t = ` ${normalise(text)} `;
  return t.includes(` ${normalise(name)} `);
}

export function runAutoReview(input: ReviewInput, now: Date = new Date()): AutoReviewReport {
  const checks: AutoCheck[] = [];
  const d = input.declaration;

  checks.push(
    d?.ownsRights && d.noCopies
      ? { id: 'rights', status: 'pass', detail: 'The developer declared they own or have licensed everything, and copied nothing.' }
      : { id: 'rights', status: 'fail', detail: 'The rights declaration was not given.' },
  );

  const text = `${input.title}\n${input.description}\n${input.tags.join(' ')}`;
  const names = PROTECTED_NAMES.filter((n) => hasName(text, n));
  checks.push(
    names.length
      ? { id: 'protected-names', status: 'warn', detail: `Mentions ${names.slice(0, 5).map((n) => `"${n}"`).join(', ')}: these belong to other companies. Ask for proof of a licence.` }
      : { id: 'protected-names', status: 'pass', detail: 'No well-known game, film or brand names found.' },
  );

  const others = input.others.filter((o) => o.studioId !== input.studioId);
  const sameBuild = input.buildFingerprint ? others.find((o) => o.buildFingerprints.includes(input.buildFingerprint!)) : undefined;
  checks.push(
    sameBuild
      ? { id: 'copied-build', status: 'fail', detail: `The build is identical to "${sameBuild.title}" from another studio.` }
      : { id: 'copied-build', status: input.buildFingerprint ? 'pass' : 'manual', detail: input.buildFingerprint ? 'No other studio has published this build.' : 'No build fingerprint to compare.' },
  );

  let coverMatch: OtherGame | undefined;
  for (const h of input.coverHashes) {
    coverMatch = others.find((o) => o.coverHashes.some((x) => hammingHex(h, x) <= 6));
    if (coverMatch) break;
  }
  checks.push(
    coverMatch
      ? { id: 'copied-cover', status: 'fail', detail: `A cover is nearly identical to one of "${coverMatch.title}" from another studio.` }
      : { id: 'copied-cover', status: input.coverHashes.length ? 'pass' : 'manual', detail: input.coverHashes.length ? 'The covers do not match other studios’ covers.' : 'No cover fingerprints to compare.' },
  );

  const close = others.map((o) => ({ o, s: similarity(input.title, o.title) })).filter((x) => x.s >= 0.85).sort((a, b) => b.s - a.s)[0];
  checks.push(
    close
      ? { id: 'similar-title', status: 'warn', detail: `The title is very close to "${close.o.title}" from another studio.` }
      : { id: 'similar-title', status: 'pass', detail: 'No other studio has a game with a similar title.' },
  );

  const sourcing = input.preQaProblems.filter((p) => PRE_QA_SOURCING.has(p.id));
  checks.push(
    sourcing.some((p) => p.status === 'fail')
      ? { id: 'outside-code', status: 'fail', detail: 'The pre-QA bot found another portal’s SDK, an ad network or calls to outside servers.' }
      : sourcing.length
        ? { id: 'outside-code', status: 'warn', detail: 'The pre-QA bot flagged outside requests. Check what they load.' }
        : { id: 'outside-code', status: 'pass', detail: 'No other SDKs, ad networks or outside requests.' },
  );

  const risky = RISKY_WORDS.filter((r) => r.word.test(text)).map((r) => r.why);
  checks.push(
    risky.length
      ? { id: 'content-words', status: 'warn', detail: `The text suggests ${[...new Set(risky)].join(' and ')}. Not allowed under the content rules.` }
      : { id: 'content-words', status: 'pass', detail: 'Nothing in the text points to gambling, adult content or gore.' },
  );

  checks.push({
    id: 'art',
    status: 'manual',
    detail: d?.credits.trim()
      ? `Look at the covers, the video and the first minutes of play. Credits given: ${d.credits.trim().slice(0, 300)}`
      : 'Look at the covers, the video and the first minutes of play. No third-party credits were listed.',
  });

  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { status, checks, ranAt: now.toISOString() };
}
