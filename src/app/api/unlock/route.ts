import { NextResponse } from 'next/server';
import { UNLOCK_COOKIE, UNLOCK_MAX_AGE, timingSafeEqual, unlockToken } from '@/lib/unlock';

/**
 * Where the unlock form posts.
 *
 * A plain form post rather than fetch, so the gate works before a single line of the app's own
 * JavaScript has run — and so a browser's password manager sees a real form submission and
 * offers to remember it.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const offered = String(form.get('password') ?? '');
  const from = String(form.get('from') ?? '/');
  const origin = new URL(request.url).origin;

  const expected = process.env.APP_PASSWORD;

  // Both sides hashed before comparing, so the compare runs over a fixed length either way.
  const ok =
    !!expected && timingSafeEqual(await unlockToken(offered), await unlockToken(expected));

  if (!ok) {
    const back = new URL('/unlock', origin);
    back.searchParams.set('error', '1');
    if (from !== '/') back.searchParams.set('from', from);
    return NextResponse.redirect(back, { status: 303 });
  }

  /* Only a same-site path is followed. Without this check a crafted `from` on a link would use
     this endpoint to bounce someone to another host, wearing this site's address on the way. */
  const safe = from.startsWith('/') && !from.startsWith('//') ? from : '/';

  const response = NextResponse.redirect(new URL(safe, origin), { status: 303 });
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
