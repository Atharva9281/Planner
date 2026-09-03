import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, UNLOCK_MAX_AGE, timingSafeEqual, unlockToken } from '@/lib/unlock';

/**
 * Where the unlock form posts.
 *
 * A plain form post rather than fetch, so the gate works before a single line of the app's own
 * JavaScript has run — and so a browser's password manager sees a real form submission and
 * offers to remember it.
 */
/**
 * Every redirect here is a bare path, never an absolute URL.
 *
 * A host behind a CDN does not necessarily see its own public hostname on the incoming request:
 * on Netlify `request.url` carries the immutable per-deploy address
 * (`<id>--<site>.netlify.app`), not the site address the browser is actually on. Redirecting to
 * a URL built from it moves the browser to a different host — and the unlock cookie, which has
 * no Domain attribute and so belongs to one host only, does not follow. The result was a login
 * loop: the right password sent you straight back to the unlock page.
 *
 * A relative Location has been legal since RFC 7231 and is resolved by the browser against the
 * address it is already on, which is by definition the right one.
 */
const seeOther = (location: string) =>
  new NextResponse(null, { status: 303, headers: { Location: location } });

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const offered = String(form.get('password') ?? '');
  const from = String(form.get('from') ?? '/');

  const expected = process.env.APP_PASSWORD;

  // Both sides hashed before comparing, so the compare runs over a fixed length either way.
  const ok =
    !!expected && timingSafeEqual(await unlockToken(offered), await unlockToken(expected));

  if (!ok) {
    const query = new URLSearchParams({ error: '1' });
    if (from !== '/') query.set('from', from);
    return seeOther(`/unlock?${query}`);
  }

  /* Only a same-site path is followed. Without this check a crafted `from` on a link would use
     this endpoint to bounce someone to another host, wearing this site's address on the way. */
  const safe = from.startsWith('/') && !from.startsWith('//') ? from : '/';

  const response = seeOther(safe);
  response.cookies.set(UNLOCK_COOKIE, await unlockToken(expected), {
    httpOnly: true,
    sameSite: 'lax',
    // Plain http on localhost would otherwise refuse to store it during development.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UNLOCK_MAX_AGE,
  });
  return response;
}
