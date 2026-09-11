import { describe, expect, it } from 'vitest';
import { emptyState, sampleState } from './defaultState';
import { migrate, restorable, Workspaces } from './workspaces';
import { Stock } from './types';

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

/**
 * Bringing a workspace saved under an older rule up to date.
 *
 * The case is real and was found on the CFP's own screen: his account was imported while fixed
 * income was untradeable, those flags were written into the saved state, and the fix shipped to a
 * build his loaded portfolio never passed through. A row said "held, not traded" no matter how
 * many times he reloaded.
 */
describe('migrating a restored workspace', () => {
  const bond = (over: Partial<Stock> = {}): Stock => ({
    id: 'b',
    sym: 'PPILX',
    type: 'Fixed Income Sleeve',
    price: 8.35,
    target: 7.5,
    bandMin: 5.5,
    bandMax: 9.5,
    shares: 7072.251,
    tradeable: false,
    lotRounding: false,
    ...over,
  });

  const saved = (stocks: Stock[]): Workspaces => {
    const w = { example: sampleState(), portfolio: emptyState() };
    w.portfolio.portfolio.stocks = stocks;
    return w;
  };

  it('makes a bond fund tradeable, and leaves it off the lot grid', () => {
    const out = migrate(saved([bond()]));
    expect(out.portfolio.portfolio.stocks[0]).toMatchObject({
      tradeable: true,
      lotRounding: false,
    });
  });

  it('never promotes a class the tool does not recognise', () => {
    // The one thing hold-only exists to protect: an unfamiliar sleeve stays untraded.
    const odd = bond({ sym: 'WEIRD', type: 'Structured Product' });
    expect(migrate(saved([odd])).portfolio.portfolio.stocks[0].tradeable).toBe(false);
  });

  it('leaves a stock alone, lot rule included', () => {
    const eq = bond({ sym: 'AAPL', type: 'Stocks / ETFs Sleeve', tradeable: true, lotRounding: true });
    expect(migrate(saved([eq])).portfolio.portfolio.stocks[0]).toMatchObject({
      tradeable: true,
      lotRounding: true,
    });
  });

  it('migrates the model set aside for the next account too', () => {
    const w = saved([]);
    w.portfolio.carried = {
      model: {
        name: 'M',
        rows: [
          { sym: 'PPILX', type: 'Fixed Income Sleeve', target: 7.5, bandMin: 5.5, bandMax: 9.5, tradeable: false, lotRounding: false },
        ],
      },
      prices: {},
      from: 'the account just closed',
    };

    // Otherwise closing this account and opening the next puts the old rule straight back.
    expect(migrate(w).portfolio.carried!.model.rows[0]).toMatchObject({
      tradeable: true,
      lotRounding: false,
    });
  });

  it('changes nothing in a workspace already written under the new rule', () => {
    const w = saved([bond({ tradeable: true })]);
    expect(migrate(w).portfolio.portfolio.stocks[0].tradeable).toBe(true);
  });
});
