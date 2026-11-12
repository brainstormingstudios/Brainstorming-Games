export type ClassValue = string | number | false | null | undefined;

/** Joins class names, skipping falsy values. */
export function cn(...parts: ClassValue[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    out = out ? `${out} ${p}` : String(p);
  }
  return out;
}
