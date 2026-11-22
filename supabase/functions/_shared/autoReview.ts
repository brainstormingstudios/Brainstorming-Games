/**
 * Auto-review: the checks that run on every submission before a person reviews it. They catch
 * the common problems quickly and put the risky submissions at the top of the queue; a moderator
 * always makes the final decision.
 *
 * What a machine can honestly check here:
 *   - the developer declared they own or have licensed everything in the game
 *   - famous game, film and cartoon names in the title, description or tags (likely unlicensed),
 *     also when disguised ("M1necraft", "mine craft", "subwaysurfers", one letter off)
 *   - the same build, or a near-identical cover, already published by another studio (copied)
 *   - art, audio and model files identical to another studio's game (copied assets)
 *   - a description largely copied from another studio's game
 *   - a title very close to another studio's game
 *   - other portals' SDKs, ad networks or outside requests found by the pre-QA bot
 *   - words that point to gambling or adult content
 *   - an incomplete store page, and a studio with earlier rejections
 * Every check adds to a risk score (0 to 100) that tells the moderator where to look hardest.
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
  /** 0 (clean) to 100 (look very hard). Older reports lack it. */
  risk?: number;
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
  /** Short description and description, to spot copied text. */
  description?: string;
}

/** Another studio's game that shares asset files (art, audio, models) with this build. */
export interface AssetOverlap {
  title: string;
  studioId: string;
  /** How many of this build's hashed asset files that game also has. */
  shared: number;
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
  /** How many asset files of this build were fingerprinted, and which other games share them. */
  assetCount?: number;
  assetOverlaps?: AssetOverlap[];
  /** The store page, for the completeness check. */
  page?: { shortDescription: string; descriptionMd: string; howToPlayMd: string; controls: number; tags: number };
  /** The studio's record. */
  studio?: { createdAt: string; rejections: number; verified: boolean };
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

/** Undoes common disguises: digits for letters (m1necraft), symbols (p@c-man). */
const unLeet = (s: string) =>
  s.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's');

/**
 * A protected name hidden in the text: written with digits for letters, with the spaces moved
 * ("mine craft", "subwaysurfers"), or one letter off for longer names ("minecraf", "pokemom").
 * `hidden` = deliberately changed spelling or spacing; `close` = one letter off, which can also
 * be an honest word, so it only warns. Null when not found.
 */
export function disguisedName(text: string, name: string): 'hidden' | 'close' | null {
  const plain = normalise(unLeet(text));
  const target = normalise(name);
  if (` ${plain} `.includes(` ${target} `)) return 'hidden';
  const squashedTarget = target.replace(/ /g, '');
  const words = plain.split(' ');
  // Spacing moved: one to three neighbouring words that join into the name exactly.
  if (squashedTarget.length >= 5) {
    for (let i = 0; i < words.length; i++) {
      for (let k = 1; k <= 3 && i + k <= words.length; k++) if (words.slice(i, i + k).join('') === squashedTarget) return 'hidden';
    }
  }
  if (squashedTarget.length >= 7) {
    const n = target.split(' ').length;
    for (let i = 0; i + n <= words.length; i++) {
      const candidate = words.slice(i, i + n).join('');
      if (Math.abs(candidate.length - squashedTarget.length) <= 1 && similarity(candidate, squashedTarget) >= 1 - 1.5 / squashedTarget.length) return 'close';
    }
  }
  return null;
}

/** Share of word triples two texts have in common (0 to 1), relative to the shorter text. */
export function textOverlap(a: string, b: string): number {
  const shingles = (s: string) => {
    const w = normalise(s).split(' ').filter((x) => x.length > 2);
    const out = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3).join(' '));
    return out;
  };
  const x = shingles(a);
  const y = shingles(b);
  if (x.size < 5 || y.size < 5) return 0;
  let common = 0;
  for (const s of x) if (y.has(s)) common++;
  return common / Math.min(x.size, y.size);
}

const RISK_POINTS: Record<CheckStatus, number> = { fail: 40, warn: 15, manual: 0, pass: 0 };

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
  // Disguised names count more than plain mentions: hiding a name suggests the developer knew.
  const titleTags = `${input.title} ${input.tags.join(' ')}`;
  const found = PROTECTED_NAMES.filter((n) => !names.includes(n)).map((n) => ({ n, how: disguisedName(titleTags, n) }));
  const hidden = found.filter((x) => x.how === 'hidden').map((x) => x.n);
  const near = found.filter((x) => x.how === 'close').map((x) => x.n);
  const quote = (list: string[]) => list.slice(0, 5).map((n) => `"${n}"`).join(', ');
  checks.push(
    hidden.length
      ? { id: 'protected-names', status: 'fail', detail: `The title or tags hide ${quote(hidden)} (changed spelling or spacing). These belong to other companies.` }
      : names.length
        ? { id: 'protected-names', status: 'warn', detail: `Mentions ${quote(names)}: these belong to other companies. Ask for proof of a licence.` }
        : near.length
          ? { id: 'protected-names', status: 'warn', detail: `The title or tags look like ${quote(near)}. Check it is not a copy.` }
          : { id: 'protected-names', status: 'pass', detail: 'No well-known game, film or brand names found, also not disguised.' },
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

  // Asset files (art, audio, models) identical to another studio's game. Free asset packs are
  // shared by many honest games, so only a large share is a fail.
  const assetCount = input.assetCount ?? 0;
  const topAssets = (input.assetOverlaps ?? []).filter((o) => o.studioId !== input.studioId).sort((a, b) => b.shared - a.shared)[0];
  const assetShare = topAssets && assetCount ? topAssets.shared / assetCount : 0;
  checks.push(
    !assetCount
      ? { id: 'copied-assets', status: 'manual', detail: 'No asset fingerprints to compare (uploaded before this check existed).' }
      : topAssets && assetShare >= 0.6 && topAssets.shared >= 10
        ? { id: 'copied-assets', status: 'fail', detail: `${topAssets.shared} of ${assetCount} art and audio files are identical to "${topAssets.title}" from another studio.` }
        : topAssets && (assetShare >= 0.25 || topAssets.shared >= 20)
          ? { id: 'copied-assets', status: 'warn', detail: `${topAssets.shared} of ${assetCount} art and audio files also appear in "${topAssets.title}". Could be a free asset pack: check the credits.` }
          : { id: 'copied-assets', status: 'pass', detail: `${assetCount} art and audio files checked; none copied from another studio's game.` },
  );

  // Description text copied from another studio's game.
  const copiedText = others
    .filter((o) => o.description)
    .map((o) => ({ o, s: textOverlap(input.description, o.description!) }))
    .sort((a, b) => b.s - a.s)[0];
  checks.push(
    copiedText && copiedText.s >= 0.5
      ? { id: 'copied-text', status: 'fail', detail: `About ${Math.round(copiedText.s * 100)}% of the description matches "${copiedText.o.title}" from another studio.` }
      : copiedText && copiedText.s >= 0.25
        ? { id: 'copied-text', status: 'warn', detail: `Parts of the description (${Math.round(copiedText.s * 100)}%) match "${copiedText.o.title}".` }
        : { id: 'copied-text', status: 'pass', detail: 'The description is not copied from another studio’s game.' },
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

  // An incomplete store page: players cannot tell what the game is.
  if (input.page) {
    const p = input.page;
    const gaps = [
      p.shortDescription.trim().length < 20 ? 'a short description of at least 20 characters' : null,
      p.descriptionMd.trim().length < 80 ? 'a description of at least 80 characters' : null,
      !p.howToPlayMd.trim() ? 'how to play' : null,
      p.controls < 1 ? 'the controls' : null,
      p.tags < 3 ? 'at least 3 tags' : null,
    ].filter(Boolean);
    checks.push(
      gaps.length
        ? { id: 'page-complete', status: 'warn', detail: `The page is missing ${gaps.join(', ')}.` }
        : { id: 'page-complete', status: 'pass', detail: 'Title, descriptions, how to play, controls and tags are all filled in.' },
    );
  }

  // The studio's record: earlier rejections, or a brand-new unverified studio.
  if (input.studio) {
    const s = input.studio;
    const ageDays = (now.getTime() - Date.parse(s.createdAt)) / 86_400_000;
    checks.push(
      s.rejections >= 2
        ? { id: 'studio-record', status: 'warn', detail: `This studio had ${s.rejections} earlier submissions rejected.` }
        : !s.verified && ageDays < 7
          ? { id: 'studio-record', status: 'manual', detail: 'A studio less than a week old: look a little closer.' }
          : { id: 'studio-record', status: 'pass', detail: s.verified ? 'Verified studio.' : 'No earlier rejections.' },
    );
  }

  checks.push({
    id: 'art',
    status: 'manual',
    detail: d?.credits.trim()
      ? `Look at the covers, the video and the first minutes of play. Credits given: ${d.credits.trim().slice(0, 300)}`
      : 'Look at the covers, the video and the first minutes of play. No third-party credits were listed.',
  });

  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  const risk = Math.min(100, checks.reduce((n, c) => n + RISK_POINTS[c.status], 0));
  return { status, checks, ranAt: now.toISOString(), risk };
}
