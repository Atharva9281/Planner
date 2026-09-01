'use client';

import Link from 'next/link';
import { isLoaded, useHydrated, useWorkspaces } from '@/lib/workspaces';

/**
 * The way in. Deliberately bare: the tool explains itself once you are inside it, and a wall of
 * text in front of a door only delays the person trying to open it.
 *
 * Both doors lead to a real address, so the browser's own Back button gets you out of either one.
 * If a portfolio is already loaded in this tab the door says so, because after a Back or a
 * refresh the advisor needs to know their work is still there before they go looking for it.
 */
export default function Page() {
  const { portfolio } = useWorkspaces();
  const loaded = useHydrated() && isLoaded(portfolio);
  const label = portfolio.source?.label;

  return (
    <div className="mx-auto max-w-[100rem] px-5 py-6 sm:px-7">
      <div className="flex min-h-[78vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-[-0.02em] sm:text-5xl">
          Cash Deployment Explorer
          <span className="mt-1 block text-accent">Lot-Aware</span>
        </h1>

        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-soft">
          Put idle cash to work one decision at a time, with every target checked against the
          nearest 100-share lot and the stock&rsquo;s own drift band.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link className="btn-solid px-8 py-3.5 text-[16px]" href="/portfolio">
            {loaded ? 'Continue' : 'Load a portfolio'}
          </Link>
          <Link className="btn-outline px-8 py-3.5 text-[16px]" href="/example">
            Open the worked example
          </Link>
        </div>

        {loaded && (
          <p className="mt-4 text-[13.5px] text-ink-soft">
            <b className="text-ink">{label ?? 'A portfolio'}</b> is still open in this tab.
          </p>
        )}
      </div>
    </div>
  );
}
