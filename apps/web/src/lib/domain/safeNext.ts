/**
 * A post-login destination: only a path on this site. Anything a browser could read as another
 * website ("//evil.com", "/\evil.com", "/%5Cevil.com", tabs or newlines inside the path,
 * "javascript:" and so on) becomes "/", so a sign-in link can never send a player elsewhere.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 2000 || !next.startsWith('/')) return '/';
  // Browsers treat "\" like "/" and drop tabs and newlines, so "/\evil.com" means "//evil.com".
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return '/';
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return '/';
  }
  if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return '/';
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
