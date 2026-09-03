/**
 * The one piece of the password gate that both the proxy and the unlock endpoint need.
 *
 * Kept in its own module because `proxy.ts` runs in the edge runtime and the route handler runs
 * in Node: the only thing they can safely share is code that touches neither. Web Crypto is
 * present in both.
 */

export const UNLOCK_COOKIE = 'cde_unlock';

/** Thirty days. Long enough that an installed app is not asking weekly, short enough to lapse. */
export const UNLOCK_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * What goes in the cookie: a hash of the password, never the password itself.
 *
 * Anyone holding this value is already through the door, so the hash is not protecting them from
 * anything — it is protecting the password, which is shared and likely reused, from sitting in
 * plain text in a cookie jar, a proxy log, or over someone's shoulder in devtools.
 */
export async function unlockToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`cash-deployment-explorer:v1:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two tokens without leaking, through how long it takes, how much of one was right.
 *
 * Always run over hashes rather than the passwords themselves: hashes are a fixed length, so the
 * early length check below cannot reveal how long the real password is.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
