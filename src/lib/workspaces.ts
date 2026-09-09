'use client';

import { useSyncExternalStore } from 'react';
import { emptyState, sampleState } from './defaultState';
import { ExplorerState } from './types';

/**
 * The two workspaces, held outside React so a route change cannot destroy them.
 *
 * Navigating between /example, /portfolio and the welcome page unmounts the page component, and
 * with it any state that lived there. Keeping the workspaces in a module-level store instead is
 * what lets the browser's own Back button replace the "Close and start over" button: leaving a
 * page no longer empties it.
 *
 * The two slots are deliberately independent. Opening the worked example must never touch a real
 * account, because that account came from files the browser cannot read a second time — the
 * trades on it are the only copy of that work.
 */

export type Slot = 'example' | 'portfolio';

export interface Workspaces {
  example: ExplorerState;
  portfolio: ExplorerState;
}

/**
 * The key the workspaces are saved under.
 *
 * Deliberately *not* bumped for every change to `ExplorerState`, whatever an earlier note here
 * claimed. Bumping abandons whatever is stored, and what is stored is a real account built from
 * two exports the browser cannot read a second time — so a bump destroys someone's work rather
 * than protecting it. Every field added since has therefore been optional and read through a
 * fallback (`baseline.offModel`, `source.modelName`, `carried`), which is what lets a payload
 * written by an older build restore into this one.
 *
 * Bump it only for a change an old payload genuinely cannot survive, and know that the cost is
 * every account currently open in every browser this has been used from.
 */
const STORAGE_KEY = 'cash-deployment-explorer:v1';

/*
 * localStorage, not sessionStorage.
 *
 * Once this is installed as a desktop app, closing the window is how people put work down for the
 * hour, not how they discard it — and sessionStorage dies with the window, taking the loaded
 * account and every trade on the log with it. The two files that built the account cannot be read
 * back automatically, so that loss is unrecoverable.
 *
 * The trade is that a client's holdings now sit in this browser profile until they are cleared.
 * "Load different files" is the way out: it replaces the workspace with an empty one, and the
 * write below persists that emptiness immediately.
 */
const store = () => window.localStorage;

const fresh = (): Workspaces => ({ example: sampleState(), portfolio: emptyState() });

/*
 * Rendered on the server with nothing loaded, which is also what the browser shows for the single
 * hydration render. Its identity is stable because useSyncExternalStore compares snapshots by
 * reference, and a new object every call would loop forever.
 */
const SERVER_SNAPSHOT: Workspaces = fresh();

let snapshot: Workspaces = SERVER_SNAPSHOT;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether a restored payload is shaped enough to render.
 *
 * Deliberately shallow. It checks only what the first render reaches into without a guard of its
 * own — the two slots, the portfolio in each, and the arrays that are iterated or indexed — and
 * nothing beyond that. Anything stricter would start discarding accounts over fields the app
 * already reads defensively, and this is the one place where being wrong throws away work that
 * cannot be loaded again.
 *
 * It exists because the alternative to an empty workspace is not a smaller one: without it a
 * payload missing any of these throws during render, and an app whose whole promise is that your
 * work is still here has no way back in at all.
 */
export function restorable(value: unknown): value is Workspaces {
  if (typeof value !== 'object' || value === null) return false;
  const slots = value as Record<string, ExplorerState | undefined>;

  return (['example', 'portfolio'] as const).every((slot) => {
    const s = slots[slot];
    return (
      typeof s === 'object' &&
      s !== null &&
      typeof s.portfolio === 'object' &&
      s.portfolio !== null &&
      Array.isArray(s.portfolio.stocks) &&
      Array.isArray(s.portfolio.offModel) &&
      Array.isArray(s.log) &&
      typeof s.baseline === 'object' &&
      s.baseline !== null &&
      typeof s.baseline.shares === 'object' &&
      s.baseline.shares !== null
    );
  });
}

/* Read once when this module first loads in a browser, before anything renders. Doing it here
   rather than in an effect keeps the restore out of React's render cycle entirely. */
if (typeof window !== 'undefined') {
  try {
    const saved = store().getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    snapshot = restorable(parsed) ? parsed : fresh();
  } catch {
    // A private window, a cleared store, or something that is not JSON at all.
    snapshot = fresh();
  }
}

function save() {
  try {
    store().setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Out of quota, or storage blocked. The session keeps working; only the restore is lost.
  }
}

export function setWorkspace(
  slot: Slot,
  next: ExplorerState | ((cur: ExplorerState) => ExplorerState),
): void {
  const value = typeof next === 'function' ? next(snapshot[slot]) : next;
  if (value === snapshot[slot]) return;

  snapshot = { ...snapshot, [slot]: value };
  save();
  emit();
}

export function useWorkspaces(): Workspaces {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}

/**
 * False for the one render that has to match the server's HTML, true from then on.
 *
 * A page whose content depends on what was restored waits for this, so a portfolio recovered from
 * the tab never flashes its upload screen on the way in.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** True when a slot holds something worth returning to. */
export const isLoaded = (s: ExplorerState) =>
  s.portfolio.stocks.length > 0 || s.portfolio.offModel.length > 0;
