import { describe, expect, it } from 'vitest';
import { deployByRank, undoLast, resetAll } from './actions';
import { sampleState } from './defaultState';
import { cashPct, LOT_BAND_TOLERANCE, mandatoryStatus, totalValue, weight } from './engine';
import { netOrders } from './orders';
import {
  CASH_FLEX,
  cashLimit,
  inRankOrder,
  rankOf,
  runBlockers,
  stageShares,
  withinCashLimit,
} from './rank';
import { ExplorerState, Stock } from './types';

/** The worked example with a conviction order laid over it, best first. */
function ranked(order: string[], edit?: (s: Stock) => Stock): ExplorerState {
  const base = sampleState();
  return {
    ...base,
    portfolio: {
      ...base.portfolio,
      stocks: base.portfolio.stocks.map((s) => {
        const at = order.indexOf(s.sym);
        const withRank = at >= 0 ? { ...s, rank: at + 1 } : s;
        return edit ? edit(withRank) : withRank;
      }),
    },
  };
}

const bySym = (s: ExplorerState, sym: string) => s.portfolio.stocks.find((x) => x.sym === sym)!;

describe('the order itself', () => {
  it('reads rank 1 first and leaves everything unranked out', () => {
    const state = ranked(['MU', 'AAPL']);
    expect(inRankOrder(state.portfolio.stocks).map((s) => s.sym)).toEqual(['MU', 'AAPL']);
  });

  it('treats absent, zero and nonsense alike as unranked', () => {
    expect(rankOf({ sym: 'A' } as Stock)).toBe(0);
    expect(rankOf({ sym: 'A', rank: 0 } as Stock)).toBe(0);
    expect(rankOf({ sym: 'A', rank: -2 } as Stock)).toBe(0);
    expect(rankOf({ sym: 'A', rank: NaN } as Stock)).toBe(0);
    expect(rankOf({ sym: 'A', rank: 3 } as Stock)).toBe(3);
  });

  it('keeps model order between rows given the same rank, so a rerun compares like with like', () => {
    const state = sampleState();
    const stocks = state.portfolio.stocks.map((s) => ({ ...s, rank: 1 }));
    const once = inRankOrder(stocks).map((s) => s.sym);
    expect(inRankOrder(stocks).map((s) => s.sym)).toEqual(once);
    expect(once).toEqual(stocks.map((s) => s.sym));
  });
});

describe('where a stage points', () => {
  it('climbs: floor, then the low lot, then target, then the high lot', () => {
    const state = sampleState();
    for (const s of state.portfolio.stocks) {
      const at = (stage: Parameters<typeof stageShares>[2]) =>
        stageShares(state.portfolio, s, stage)!;
      expect(at('floor')).toBeLessThanOrEqual(at('lot-low'));
      expect(at('lot-low')).toBeLessThanOrEqual(at('target'));
      expect(at('target')).toBeLessThanOrEqual(at('lot-high'));
    }
  });

  /** A bond fund sits on no 100-share grid, so the two lot stages give it the band edge instead. */
  it('sends a row traded by weight to the band edge, not to nothing', () => {
    const state = ranked([], (s) =>
      s.sym === 'MU' ? { ...s, lotRounding: false, type: 'Fixed Income Sleeve' } : s,
    );
    const mu = bySym(state, 'MU');

    expect(stageShares(state.portfolio, mu, 'lot-low')).toBe(
      stageShares(state.portfolio, mu, 'floor'),
    );
    const high = stageShares(state.portfolio, mu, 'lot-high')!;
    expect(high).toBeGreaterThan(0);
    expect(high % 100).not.toBe(0);
  });

  it('has nothing to say about a position the tool does not trade', () => {
    const state = ranked([], (s) => (s.sym === 'MU' ? { ...s, tradeable: false } : s));
    expect(stageShares(state.portfolio, bySym(state, 'MU'), 'floor')).toBeNull();
  });
});

describe('how far the cash may fall', () => {
  it('stops at the floor less the flexibility, or at the ceiling', () => {
    const p = sampleState().portfolio;
    const total = totalValue(p);

    expect(cashLimit(p, 'floor')).toBeCloseTo(((p.cashFloor - CASH_FLEX) / 100) * total, 6);
    expect(cashLimit(p, 'ceiling')).toBeCloseTo((p.cashCeiling / 100) * total, 6);
    expect(cashLimit(p, 'floor')).toBeLessThan(cashLimit(p, 'ceiling'));
  });

  it('never lets a limit go negative, however wide the flexibility is against the floor', () => {
    const base = sampleState().portfolio;
    expect(cashLimit({ ...base, cashFloor: 0.2 }, 'floor')).toBe(0);
  });

  it('allows any sell, and a buy only while it leaves the limit intact', () => {
    const p = sampleState().portfolio;
    const room = p.cash - cashLimit(p, 'floor');

    expect(withinCashLimit(p, 0, 'floor')).toBe(true);
    expect(withinCashLimit(p, room, 'floor')).toBe(true);
    expect(withinCashLimit(p, room + 1, 'floor')).toBe(false);
  });
});

describe('what stops the run starting', () => {
  it('refuses while any model row has no price, and names them', () => {
    const state = ranked([], (s) => (s.sym === 'MU' ? { ...s, price: 0 } : s));
    const [reason] = runBlockers(state.portfolio);

    expect(reason).toContain('MU');
    expect(reason).toContain('account total');
    expect(runBlockers(sampleState().portfolio)).toEqual([]);
  });

  /** The block is about the account total, which an untraded row is still part of. */
  it('ignores a row it would never trade anyway', () => {
    const state = ranked([], (s) => (s.sym === 'MU' ? { ...s, tradeable: false, price: 0 } : s));
    expect(runBlockers(state.portfolio)).toEqual([]);
  });
});

describe('the ranked run', () => {
  it('sells everything the model never asked for, first', () => {
    const base = sampleState();
    const state: ExplorerState = {
      ...base,
      portfolio: {
        ...base.portfolio,
        offModel: [{ id: 'o1', sym: 'LEGACY', shares: 100, price: 50 }],
      },
      baseline: { ...base.baseline, offModel: [{ id: 'o1', sym: 'LEGACY', shares: 100, price: 50 }] },
    };

    const { state: after, outcome } = deployByRank(state);

    expect(outcome.offModelSold).toBe(1);
    expect(outcome.offModelProceeds).toBeCloseTo(5000, 6);
    expect(after.portfolio.offModel).toEqual([]);
  });

  it('puts every position on its floor, ranked or not', () => {
    const { state: after } = deployByRank(ranked([]));

    for (const s of after.portfolio.stocks) {
      expect(weight(after.portfolio, s)).toBeGreaterThanOrEqual(s.bandMin - 0.0001);
      expect(s.shares).toBe(stageShares(after.portfolio, s, 'floor'));
    }
  });

  it('leaves an unranked position at the floor and takes a ranked one past it', () => {
    const state = ranked(['MU']);
    const { state: after } = deployByRank(state);

    const mu = bySym(after, 'MU');
    expect(mu.shares).toBeGreaterThan(stageShares(after.portfolio, mu, 'floor')!);

    for (const s of after.portfolio.stocks) {
      if (s.sym === 'MU') continue;
      expect(s.shares).toBe(stageShares(after.portfolio, s, 'floor'));
    }
  });

  it('never takes cash below the limit it was given', () => {
    for (const stopAt of ['floor', 'ceiling'] as const) {
      const { state: after } = deployByRank(ranked(['MU', 'AAPL', 'AMZN', 'NVDA']), { stopAt });
      expect(after.portfolio.cash).toBeGreaterThanOrEqual(cashLimit(after.portfolio, stopAt) - 1e-6);
    }
  });

  /**
   * The mandate is never broken to climb a rung — within the tolerance the whole app already
   * allows a lot to miss a band edge by. `mandatoryStatus` reads the same figure, so a position
   * the run lands on is a position the table will not then flag; the run and the row it produces
   * cannot disagree about what is inside the band.
   */
  it('keeps every position inside its own band, whatever the cash allows', () => {
    const { state: after } = deployByRank(ranked(['MU', 'AAPL', 'AMZN', 'NVDA']));

    for (const s of after.portfolio.stocks) {
      const w = weight(after.portfolio, s);
      expect(w).toBeGreaterThanOrEqual(s.bandMin - LOT_BAND_TOLERANCE);
      expect(w).toBeLessThanOrEqual(s.bandMax + LOT_BAND_TOLERANCE);
      expect(mandatoryStatus(after.portfolio, s)).toBeNull();
    }
  });

  /**
   * The third ending, and the one the advisor has to be told about: every ranked position reached
   * its ceiling and the cash is still above its own. Nothing was skipped and nothing is left to
   * buy inside the mandate — the answer is more names in the order, not more money.
   */
  it('says when the order ran out before the cash did', () => {
    const { state: after, outcome } = deployByRank(ranked(['MU']));

    expect(outcome.stopped).toBe('complete');
    expect(outcome.skipped).toEqual([]);
    expect(outcome.cashAboveCeiling).toBe(true);
    expect(outcome.cashPctAfter).toBeGreaterThan(sampleState().portfolio.cashCeiling);

    // Nothing broke, and the money still did not go where it was asked to.
    expect(outcome.undeployed).toBeCloseTo(
      after.portfolio.cash - cashLimit(after.portfolio, 'floor'),
      6,
    );
    expect(outcome.headroom).toBeGreaterThan(0);
  });

  /**
   * The failure the outcome originally could not report, taken from the real account: a run told
   * to spend to the cash floor reaches every rung of its order, stops well above that floor, and
   * — because the leftover balance still sits inside the cash band — trips no other warning at all.
   * `stopped` reads complete, `cashAboveCeiling` is false, and a third of the deployable cash has
   * quietly gone nowhere.
   */
  it('reports cash left above the limit even when nothing else looks wrong', () => {
    /* A $100,000 account, 9% in cash against a 6-10% band, and one ranked name that can hold at
       most 5% of the account. The run takes it to its ceiling, nothing is skipped, and the cash it
       could not absorb settles back at 9% — comfortably inside its band, and $3,500 above the 5.5%
       the run was told to spend down to. */
    const stock = (
      id: string,
      shares: number,
      bandMin: number,
      bandMax: number,
      rank?: number,
    ): Stock => ({
      id,
      sym: id,
      price: 100,
      target: (bandMin + bandMax) / 2,
      bandMin,
      bandMax,
      shares,
      lotRounding: false,
      ...(rank ? { rank } : {}),
    });

    const state: ExplorerState = {
      portfolio: {
        stocks: [stock('A', 50, 2, 5, 1), stock('B', 860, 86, 90)],
        cash: 9_000,
        cashFloor: 6,
        cashTarget: 8,
        cashCeiling: 10,
        offModel: [],
      },
      baseline: { shares: { A: 50, B: 860 }, cash: 9_000, offModel: [] },
      log: [],
      nextId: 1,
    };

    const { state: after, outcome } = deployByRank(state, { stopAt: 'floor' });

    // Every other signal reads success.
    expect(outcome.stopped).toBe('complete');
    expect(outcome.skipped).toEqual([]);
    expect(outcome.cashAboveCeiling).toBe(false);
    expect(cashPct(after.portfolio)).toBeLessThan(after.portfolio.cashCeiling);
    expect(cashPct(after.portfolio)).toBeGreaterThan(after.portfolio.cashFloor);

    // And $3,500 the press asked to have invested is sitting where it started.
    expect(after.portfolio.cash).toBeCloseTo(9_000, 6);
    expect(outcome.undeployed).toBeCloseTo(3_500, 6);
    expect(outcome.headroom).toBeCloseTo(4_000, 6);
  });

  it('is silent about undeployed cash when the run actually spent down to its limit', () => {
    const { outcome } = deployByRank(ranked(['MU', 'NVDA', 'AAPL', 'AMZN', 'MSFT']), {
      stopAt: 'floor',
    });

    expect(outcome.stopped).toBe('cash');
    // Whatever is left is less than the cheapest step that was refused, or it would have been made.
    const cheapest = Math.min(...outcome.skipped.map((s) => s.needed));
    expect(outcome.undeployed).toBeLessThan(cheapest);
  });

  it('counts what the unranked positions could still absorb', () => {
    const { state: after, outcome } = deployByRank(ranked(['MU']));

    const byHand = after.portfolio.stocks
      .filter((s) => !s.rank)
      .reduce(
        (sum, s) =>
          sum + Math.max(stageShares(after.portfolio, s, 'lot-high')! - s.shares, 0) * s.price,
        0,
      );

    expect(outcome.headroom).toBeCloseTo(byHand, 6);
    // Every unranked position sits at its floor, so there is real room in all of them.
    expect(outcome.headroom).toBeGreaterThan(outcome.undeployed);
  });

  it('spends more when told to go to the floor than when told to stop at the ceiling', () => {
    const order = ['MU', 'AAPL', 'AMZN', 'NVDA'];
    const deep = deployByRank(ranked(order), { stopAt: 'floor' }).state;
    const shallow = deployByRank(ranked(order), { stopAt: 'ceiling' }).state;

    expect(deep.portfolio.cash).toBeLessThan(shallow.portfolio.cash);
    expect(cashPct(shallow.portfolio)).toBeGreaterThanOrEqual(shallow.portfolio.cashCeiling - 1e-6);
  });

  /**
   * The rule that makes an ordering mean anything: what rank 1 cannot use, rank 2 gets.
   *
   * Built to order rather than layered onto the worked example, because the arithmetic has to be
   * checkable by hand. A $100,000 account, nothing held, and a 60% cash floor — so $40,500 is
   * spendable once the 0.5 flexibility is allowed. Rank 1 wants 50% of the account, $50,000, and
   * cannot have it. Rank 2 wants 5%, $5,000, and can.
   */
  it('skips a step it cannot fund whole and carries on down the order', () => {
    const stock = (sym: string, price: number, target: number, rank: number): Stock => ({
      id: sym,
      sym,
      price,
      target,
      bandMin: 0,
      bandMax: 90,
      shares: 0,
      rank,
      // Traded by weight, so each stage is a plain percentage of the account with no lot grid
      // rounding the arithmetic away from the figures above.
      lotRounding: false,
    });

    const state: ExplorerState = {
      portfolio: {
        stocks: [stock('BIG', 1000, 50, 1), stock('SMALL', 10, 5, 2)],
        cash: 100_000,
        cashFloor: 60,
        cashTarget: 70,
        cashCeiling: 80,
        offModel: [],
      },
      baseline: { shares: { BIG: 0, SMALL: 0 }, cash: 100_000, offModel: [] },
      log: [],
      nextId: 1,
    };

    const { state: after, outcome } = deployByRank(state);

    expect(outcome.stopped).toBe('cash');
    expect(outcome.skipped).toContainEqual(
      expect.objectContaining({ sym: 'BIG', rank: 1, stage: 'target', needed: 50_000 }),
    );
    expect(outcome.steps).toContainEqual(
      expect.objectContaining({ sym: 'SMALL', rank: 2, stage: 'target', amount: 5_000 }),
    );

    // Rank 1 untouched, rank 2 on its target, and nothing part-filled anywhere.
    expect(bySym(after, 'BIG').shares).toBe(0);
    expect(bySym(after, 'SMALL').shares).toBe(500);
    expect(after.portfolio.cash).toBe(95_000);
    for (const step of outcome.steps) {
      expect(step.resultShares).toBe(
        stageShares(after.portfolio, bySym(after, step.sym), step.stage),
      );
    }
  });

  it('reports where each ranked position finished', () => {
    const { state: after, outcome } = deployByRank(ranked(['MU', 'AAPL']));

    expect(outcome.landed.map((l) => l.sym)).toEqual(['MU', 'AAPL']);
    expect(outcome.landed.map((l) => l.rank)).toEqual([1, 2]);
    for (const landing of outcome.landed) {
      expect(landing.shares).toBe(bySym(after, landing.sym).shares);
      expect(landing.reached).not.toBeNull();
    }
  });

  it('counts what it touched and reports the cash it left behind', () => {
    const state = ranked(['MU', 'AAPL']);
    const { state: after, outcome } = deployByRank(state);

    expect(outcome.ranked).toBe(2);
    expect(outcome.unranked).toBe(state.portfolio.stocks.length - 2);
    expect(outcome.cashBefore).toBe(state.portfolio.cash);
    expect(outcome.cashAfter).toBe(after.portfolio.cash);
    expect(outcome.cashPctAfter).toBeCloseTo(cashPct(after.portfolio), 10);
  });

  it('comes back in one undo, however many positions it moved', () => {
    const state = ranked(['MU', 'AAPL', 'NVDA']);
    const { state: after, outcome } = deployByRank(state);

    expect(after.log.length).toBeGreaterThan(3);
    expect(after.log.every((e) => e.batch === outcome.batch)).toBe(true);

    const back = undoLast(after);
    expect(back.log).toEqual([]);
    expect(back.portfolio.cash).toBeCloseTo(state.portfolio.cash, 6);
    for (const s of back.portfolio.stocks) {
      expect(s.shares).toBe(bySym(state, s.sym).shares);
    }
  });

  /** The testing loop: run, look, reset, re-rank, run again — with the order surviving the reset. */
  it('keeps the ranking through a reset, so a rerun is one edit away', () => {
    const state = ranked(['MU', 'AAPL']);
    const back = resetAll(deployByRank(state).state);

    expect(back.portfolio.stocks.map((s) => s.rank)).toEqual(
      state.portfolio.stocks.map((s) => s.rank),
    );
    expect(back.log).toEqual([]);
  });

  it('nets its stages into one order per position', () => {
    const { state: after } = deployByRank(ranked(['MU', 'AAPL']));
    const orders = netOrders(after);

    expect(new Set(orders.map((o) => o.sym)).size).toBe(orders.length);
    // More steps than orders is the point: the run climbs rungs, the desk gets a destination.
    expect(after.log.length).toBeGreaterThan(orders.length);
  });

  it('does nothing at all to a workspace with no positions', () => {
    const empty: ExplorerState = {
      portfolio: { stocks: [], cash: 0, cashFloor: 6, cashTarget: 8, cashCeiling: 10, offModel: [] },
      baseline: { shares: {}, cash: 0, offModel: [] },
      log: [],
      nextId: 1,
    };
    const { state: after, outcome } = deployByRank(empty);

    expect(after.log).toEqual([]);
    expect(outcome.ranked).toBe(0);
    expect(outcome.stopped).toBe('complete');
  });
});
