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

/** Bumped whenever ExplorerState changes shape, so a stale tab cannot restore into a new app. */
const STORAGE_KEY = 'cash-deployment-explorer:v1';

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

/* Read once when this module first loads in a browser, before anything renders. Doing it here
   rather than in an effect keeps the restore out of React's render cycle entirely. */
if (typeof window !== 'undefined') {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    snapshot = saved ? (JSON.parse(saved) as Workspaces) : fresh();
  } catch {
    // A private window, a cleared store, or something written by an older shape of the app.
    snapshot = fresh();
  }
}

function save() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Out of quota, or storage blocked. The session keeps working; only the refresh net is lost.
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
