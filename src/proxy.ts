import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { UNLOCK_COOKIE, timingSafeEqual, unlockToken } from '@/lib/unlock';

/**
 * The password on the front door.
 *
 * Runs before any route renders, on the server, so it cannot be stepped around by reading the
 * page source the way a password checked in the browser can. Nothing about it protects account
 * data, because no account data ever reaches the server — the two exports are parsed in the
 * browser and stay there. What it protects is the tool itself, so a URL that gets forwarded does
 * not hand a stranger a working copy.
 *
 * With `APP_PASSWORD` unset the gate is off entirely, which is how `npm run dev` and the test
 * suite keep working without anybody having to log in to look at a table.
 *
 * In Next 16 this file is `proxy.ts`. The `middleware.ts` convention it replaces is deprecated.
 */
export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const expected = await unlockToken(password);
  const presented = request.cookies.get(UNLOCK_COOKIE)?.value ?? '';

  if (timingSafeEqual(presented, expected)) return NextResponse.next();

  /* Where they were headed, so unlocking returns them there rather than dumping everyone on the
     landing page. Only the path is carried, and it is validated on the way back. */
  const url = request.nextUrl.clone();
  url.pathname = '/unlock';
  url.search = '';
  const from = request.nextUrl.pathname;
  if (from !== '/') url.searchParams.set('from', from);
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Everything except the unlock screen itself, the endpoint it posts to, and the static assets.
   * The icons and manifest stay open on purpose: a browser fetches them while deciding whether
   * the app can be installed, and a redirect in the middle of that breaks the install prompt.
   */
  matcher: ['/((?!unlock|api/unlock|_next/static|_next/image|.*\\.png$|.*\\.ico$|manifest\\.webmanifest).*)'],
};
