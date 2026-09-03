import type { MetadataRoute } from 'next';

/**
 * What turns the hosted page into something that installs.
 *
 * With this in place Chrome, Edge and Safari offer to install the app: a real icon in the Dock or
 * Start menu that opens in its own window with no address bar, and double-clicks like any other
 * application. It is still the hosted site underneath, which is the point — a fix pushed here
 * reaches an installed copy the next time it is opened, with nothing to download or replace.
 *
 * `id` is set explicitly so the identity survives a change of start_url. Without it browsers key
 * the installed app on start_url, and moving that would strand the existing install as an
 * orphan the user has to remove by hand.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Cash Deployment Explorer, Lot-Aware',
    // What fits under an icon. The full name is truncated by every shell that shows one.
    short_name: 'Cash Explorer',
    description:
      'Deploy idle cash one decision at a time, with every buy checked against the nearest 100-share lot and the position’s own drift band.',
    start_url: '/',
    display: 'standalone',
    // The page's own paper, so the window does not flash white before the app paints.
    background_color: '#f4f6f9',
    theme_color: '#1f2e52',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      /* Shells that crop an icon to their own shape get the full-bleed variant, whose mark sits
         inside the 80% safe zone rather than being clipped at the corners. */
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
