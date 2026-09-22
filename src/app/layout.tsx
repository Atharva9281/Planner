import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Portfolio Optimizer',
  description: 'Optimizing portfolio allocations to maximize covered call writing.',
  // Safari reads this rather than the manifest when adding to the Dock.
  appleWebApp: { capable: true, title: 'Optimizer', statusBarStyle: 'default' },
};

/* themeColor belongs to the viewport export, not to metadata, where it has been deprecated since
   Next 14. It tints the installed window's title bar to match the app's own header. */
export const viewport: Viewport = {
  themeColor: '#1f2e52',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
