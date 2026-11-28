/**
 * Turns whatever the owner pastes from Looker Studio into the embed link the portal can show:
 * the whole <iframe> code, an old datastudio.google.com link (sometimes with a stray ":" after
 * the address), or a normal report link without /embed.
 */
export function normaliseLookerUrl(input: string): string {
  let s = input.trim();
  const src = /src=["']([^"']+)["']/i.exec(s);
  if (src) s = src[1]!.trim();
  s = s.replace(/^https?:\/\/(?:datastudio|lookerstudio)\.google\.com:?\/+/i, 'https://lookerstudio.google.com/');
  s = s.replace(/^https:\/\/lookerstudio\.google\.com\/(?=reporting\/)/, 'https://lookerstudio.google.com/embed/');
  return s;
}

/** Whether the link is a Looker Studio embed link (the database checks the same). */
export function isLookerEmbedUrl(url: string): boolean {
  return /^https:\/\/lookerstudio\.google\.com\/embed\//.test(url);
}
