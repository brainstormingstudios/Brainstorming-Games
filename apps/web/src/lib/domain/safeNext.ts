/** True for "\" and control characters: browsers read "\" as "/" and drop tabs and newlines. */
function hasTrickChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c || c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * A post-login destination: only a path on this site. Anything a browser could read as another
 * website ("//evil.com", "/\evil.com", "/%5Cevil.com", tabs or newlines inside the path,
 * "javascript:" and so on) becomes "/", so a sign-in link can never send a player elsewhere.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 2000 || !next.startsWith('/') || hasTrickChars(next)) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return '/';
  }
  if (decoded.startsWith('//') || hasTrickChars(decoded)) return '/';
  const base = 'https://same.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return '/';
  }
  if (url.origin !== base) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
