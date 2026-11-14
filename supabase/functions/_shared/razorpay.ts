// Razorpay REST calls and signature checks. Keys: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// RAZORPAY_WEBHOOK_SECRET; subscription plans: RAZORPAY_PLAN_PLUS, RAZORPAY_PLAN_MAX.
const enc = new TextEncoder();

export const razorpayKeyId = () => Deno.env.get('RAZORPAY_KEY_ID') ?? '';

export async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = btoa(`${razorpayKeyId()}:${Deno.env.get('RAZORPAY_KEY_SECRET') ?? ''}`);
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`razorpay ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json as T;
}

/** HMAC-SHA256 of `message` with `secret`, hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
