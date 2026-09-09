import { describe, expect, it } from 'vitest';
import { emptyState, sampleState } from './defaultState';
import { restorable } from './workspaces';

/**
 * The check that stands between a stored workspace and the first render.
 *
 * Both directions matter, and they pull against each other. Accepting something malformed throws
 * during render, which leaves no way into an app whose whole promise is that the work is still
 * there. Rejecting something sound silently empties a real account built from two exports the
 * browser cannot read again. So the tests below pin the shapes this app has actually written to
 * storage as accepted, and only genuinely unrenderable ones as rejected.
 */

const current = () => ({ example: sampleState(), portfolio: emptyState() });

describe('restoring a saved workspace', () => {
  it('accepts what this build writes', () => {
    expect(restorable(JSON.parse(JSON.stringify(current())))).toBe(true);
  });

  /* Every field added since the storage key was set is optional and read through a fallback,
     which is the reason the key has never been bumped: bumping it discards real accounts. Each of
     these is a payload an older build wrote, and each still has to come back. */
  it('accepts a payload written before baseline.offModel existed', () => {
    const saved = current();
    delete (saved.portfolio.baseline as { offModel?: unknown }).offModel;
    expect(restorable(saved)).toBe(true);
  });

  it('accepts a payload written before source.modelName existed', () => {
    const saved = current();
    delete (saved.example.source as { modelName?: unknown }).modelName;
    expect(restorable(saved)).toBe(true);
  });

  it('accepts a payload with no carried model and no source at all', () => {
    const saved = current();
    delete (saved.portfolio as { source?: unknown }).source;
    delete (saved.portfolio as { carried?: unknown }).carried;
    expect(restorable(saved)).toBe(true);
  });

  /* The faults that end in a thrown error rather than a wrong figure: the first render maps over
     these arrays and indexes into baseline.shares without a guard of its own. */
  it('rejects a slot whose portfolio is missing', () => {
    const saved = current() as { portfolio: { portfolio?: unknown } };
    delete saved.portfolio.portfolio;
    expect(restorable(saved)).toBe(false);
  });

  it('rejects a portfolio whose stocks are not an array', () => {
    const saved = current();
    (saved.example.portfolio as { stocks: unknown }).stocks = { s1: {} };
    expect(restorable(saved)).toBe(false);
  });

  it('rejects a state with no log to render', () => {
    const saved = current();
    delete (saved.portfolio as { log?: unknown }).log;
    expect(restorable(saved)).toBe(false);
  });

  it('rejects a baseline with no share map to index', () => {
    const saved = current();
    delete (saved.example.baseline as { shares?: unknown }).shares;
    expect(restorable(saved)).toBe(false);
  });

  it('rejects a payload missing a slot entirely', () => {
    expect(restorable({ portfolio: emptyState() })).toBe(false);
  });

  it('rejects what JSON.parse can return that is not a workspace', () => {
    for (const value of [null, undefined, 0, '', 'null', [], true]) {
      expect(restorable(value)).toBe(false);
    }
  });
});
