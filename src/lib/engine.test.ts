import { describe, expect, it } from 'vitest';
import { samplePortfolio } from './defaultState';
import {
  affordableShares,
  bandShareLimits,
  cashPct,
  cashStatus,
  highestLotWithinBand,
  lotAwareTarget,
  lowestLotWithinBand,
  mandatoryStatus,
  needsDecision,
  planBuy,
  planSell,
  rawMaxBuy,
  rawMinSell,
  planToShares,
  totalValue,
  unpricedPositions,
  whatIf,
  weight,
} from './engine';
import { Portfolio, Stock } from './types';

const stockOf = (p: Portfolio, sym: string) => p.stocks.find((s) => s.sym === sym)!;

/** A hand-built portfolio, used where the default one cannot produce the case under test. */
const build = (stocks: Stock[], cash: number): Portfolio => ({
  stocks,
  cash,
  cashFloor: 3,
  cashTarget: 5,
  cashCeiling: 8,
  offModel: [],
});

describe('total account value', () => {
  it('is cash plus every model holding at current prices', () => {
    // 600×412.30 + 940×118.40 + 280×221.75 + 175×298.60 + 195×265.90 + 38,000
    expect(totalValue(samplePortfolio())).toBeCloseTo(562871.5, 6);
  });

  it('counts off-model holdings too, which widens every band in dollars', () => {
    const p = samplePortfolio();
    const withOther: Portfolio = {
      ...p,
      offModel: [{ id: 'o1', sym: 'OTHER', shares: 100, price: 50 }],
    };

    expect(totalValue(withOther)).toBeCloseTo(562871.5 + 5000, 6);

    // The same stock, unchanged, now has more room before its ceiling.
    const msft = stockOf(p, 'MSFT');
    expect(bandShareLimits(p, msft).maxShares).toBe(614);
    expect(bandShareLimits(withOther, stockOf(withOther, 'MSFT')).maxShares).toBe(619);
  });

  it('reports zero rather than NaN for an empty account', () => {
    const empty = build([], 0);
    expect(totalValue(empty)).toBe(0);
    expect(cashPct(empty)).toBe(0);
  });
});

describe('weights', () => {
  it('measures each holding against total account value', () => {
    const p = samplePortfolio();
    expect(weight(p, stockOf(p, 'MSFT'))).toBeCloseTo(43.95, 2);
    expect(weight(p, stockOf(p, 'MU'))).toBeCloseTo(19.773, 3);
    expect(weight(p, stockOf(p, 'NVDA'))).toBeCloseTo(11.031, 3);
    expect(weight(p, stockOf(p, 'AAPL'))).toBeCloseTo(9.284, 3);
    expect(weight(p, stockOf(p, 'AMZN'))).toBeCloseTo(9.212, 3);
    expect(cashPct(p)).toBeCloseTo(6.751, 3);
  });
});

describe('lot-aware target', () => {
  it('takes the nearest 100-share lot when its weight lands inside the band', () => {
    const p = samplePortfolio();

    // MSFT: raw 546.08 → nearest lot 500 → 36.62%, inside 35–45.
    const msft = lotAwareTarget(p, stockOf(p, 'MSFT'));
    expect(msft.raw).toBeCloseTo(546.08, 2);
    expect(msft.goal).toBe(500);
    expect(msft.isLot).toBe(true);

    // MU: raw 950.80 → nearest lot 1000 → 21.04%, inside 16–24.
    expect(lotAwareTarget(p, stockOf(p, 'MU')).goal).toBe(1000);
    // NVDA: raw 304.60 → 300.
    expect(lotAwareTarget(p, stockOf(p, 'NVDA')).goal).toBe(300);
    // AAPL: raw 188.50 → 200.
    expect(lotAwareTarget(p, stockOf(p, 'AAPL')).goal).toBe(200);
    // AMZN: raw 211.69 → 200.
    expect(lotAwareTarget(p, stockOf(p, 'AMZN')).goal).toBe(200);
  });

  it('falls back to the raw share count when no lot fits the band', () => {
    // 10 sh @ $500 = $5,000 of a $38,000 account, so a 30% target is 22.8 shares. The nearest
    // lot is 0, which is 0% and below the 25% floor, so the band wins and the odd count stands.
    const p = build(
      [
        { id: 'a', sym: 'X', price: 500, target: 30, bandMin: 25, bandMax: 35, shares: 10 },
        { id: 'b', sym: 'Y', price: 100, target: 60, bandMin: 55, bandMax: 90, shares: 300 },
      ],
      3000,
    );

    const lt = lotAwareTarget(p, stockOf(p, 'X'));
    expect(totalValue(p)).toBe(38000);
    expect(lt.raw).toBeCloseTo(22.8, 6);
    expect(lt.goal).toBe(23);
    expect(lt.isLot).toBe(false);
  });
});

describe('reachable lots', () => {
  it('finds the highest lot at or below the ceiling and the lowest at or above the floor', () => {
    const p = samplePortfolio();

    // MSFT holds 600 and the highest reachable lot is also 600: there is no higher one.
    expect(highestLotWithinBand(p, stockOf(p, 'MSFT')).highestLot).toBe(600);
    expect(lowestLotWithinBand(p, stockOf(p, 'MSFT')).lowestLot).toBe(500);

    expect(highestLotWithinBand(p, stockOf(p, 'MU')).highestLot).toBe(1100);
    expect(lowestLotWithinBand(p, stockOf(p, 'MU')).lowestLot).toBe(800);

    // NVDA holds 280; the lowest reachable lot is 300, above it, so there is no lower lot.
    expect(lowestLotWithinBand(p, stockOf(p, 'NVDA')).lowestLot).toBe(300);
    expect(highestLotWithinBand(p, stockOf(p, 'NVDA')).highestLot).toBe(300);
  });

  it('brackets the band with whole-share limits', () => {
    const p = samplePortfolio();
    expect(bandShareLimits(p, stockOf(p, 'MSFT'))).toMatchObject({ minShares: 478, maxShares: 614 });
    expect(bandShareLimits(p, stockOf(p, 'MU'))).toMatchObject({ minShares: 761, maxShares: 1140 });
    expect(bandShareLimits(p, stockOf(p, 'AMZN'))).toMatchObject({ minShares: 149, maxShares: 275 });
  });
});

describe('mandatory status', () => {
  it('is null while every holding sits inside its own band', () => {
    const p = samplePortfolio();
    p.stocks.forEach((s) => expect(mandatoryStatus(p, s)).toBeNull());
  });

  it('reports over and under the moment a weight leaves the band', () => {
    const p = build(
      [
        { id: 'a', sym: 'OVER', price: 100, target: 20, bandMin: 15, bandMax: 25, shares: 500 },
        { id: 'b', sym: 'UNDER', price: 100, target: 50, bandMin: 45, bandMax: 55, shares: 100 },
      ],
      40000,
    );
    // OVER is 50,000 of 100,000 = 50%; UNDER is 10,000 = 10%.
    expect(totalValue(p)).toBe(100000);
    expect(mandatoryStatus(p, stockOf(p, 'OVER'))).toBe('over');
    expect(mandatoryStatus(p, stockOf(p, 'UNDER'))).toBe('under');
  });
});

describe('needs a decision', () => {
  it('is true while the holding has not reached the lot-aware target', () => {
    const p = samplePortfolio();
    // MSFT sits at 600 against a goal of 500, so the model is still asking for something.
    expect(needsDecision(p, stockOf(p, 'MSFT'))).toBe(true);
  });

  it('is false once the holding sits on the target inside its band', () => {
    const p = samplePortfolio();
    const s = stockOf(p, 'MSFT');
    // Moving the shares moves the account total, and so the goal with it. Settle there first.
    s.shares = lotAwareTarget(p, s).goal;

    expect(lotAwareTarget(p, s).goal).toBe(s.shares);
    expect(mandatoryStatus(p, s)).toBeNull();
    expect(needsDecision(p, s)).toBe(false);
  });

  it('is true for a breach even when the holding sits exactly on the target', () => {
    // The whole account in one name, against a band that forbids it: the goal is already held
    // and the position is still out of bounds, so the two conditions have to be independent.
    const s: Stock = {
      id: 'x',
      sym: 'X',
      price: 10,
      target: 100,
      bandMin: 1,
      bandMax: 2,
      shares: 100,
    };
    const p = build([s], 0);

    expect(lotAwareTarget(p, s).goal).toBe(s.shares);
    expect(mandatoryStatus(p, s)).toBe('over');
    expect(needsDecision(p, s)).toBe(true);
  });

  it('is true without a price, since nothing about the row can be judged yet', () => {
    const s: Stock = { id: 'x', sym: 'X', price: 0, target: 5, bandMin: 3, bandMax: 7, shares: 0 };
    expect(needsDecision(build([s], 1000), s)).toBe(true);
  });
});

describe('cash band', () => {
  it('reads the floor and ceiling off the portfolio rather than assuming 3% and 8%', () => {
    const p = samplePortfolio(); // 6.751% cash
    expect(cashStatus(p)).toBe('ok');

    expect(cashStatus({ ...p, cashFloor: 10, cashCeiling: 20 })).toBe('below');
    expect(cashStatus({ ...p, cashFloor: 1, cashCeiling: 5 })).toBe('above');
  });
});

describe('raw room, no lot rounding', () => {
  it('takes the smaller of the room to the ceiling and what the cash affords', () => {
    const p = samplePortfolio();

    // MU: 1,140 max − 940 held = 200 of room; cash affords 320. The band binds.
    expect(rawMaxBuy(p, stockOf(p, 'MU'))).toMatchObject({
      rawCeilingShares: 1140,
      roomToCeiling: 200,
      cashAfford: 320,
      maxBuy: 200,
      limiter: 'band',
    });

    // MSFT: only 14 shares of room, against 92 affordable.
    expect(rawMaxBuy(p, stockOf(p, 'MSFT'))).toMatchObject({ maxBuy: 14, limiter: 'band' });
  });

  it('reports cash as the limiter when the band has more room than the balance', () => {
    const p = { ...samplePortfolio(), cash: 100 };
    const mu = rawMaxBuy(p, stockOf(p, 'MU'));
    expect(mu.roomToCeiling).toBeGreaterThan(mu.cashAfford);
    expect(mu.limiter).toBe('cash');
    expect(mu.maxBuy).toBe(0);
  });

  it('mirrors on the sell side, where only the floor binds', () => {
    const p = samplePortfolio();
    expect(rawMinSell(p, stockOf(p, 'MSFT'))).toEqual({ minShares: 478, maxSell: 122 });
    expect(rawMinSell(p, stockOf(p, 'MU'))).toEqual({ minShares: 761, maxSell: 179 });
    expect(rawMinSell(p, stockOf(p, 'NVDA'))).toEqual({ minShares: 229, maxSell: 51 });
  });

  it('never affords a share at a zero price', () => {
    const p = build([{ id: 'a', sym: 'Z', price: 0, target: 10, bandMin: 5, bandMax: 15, shares: 0 }], 1000);
    expect(affordableShares(p, stockOf(p, 'Z'))).toBe(0);
    expect(rawMaxBuy(p, stockOf(p, 'Z')).maxBuy).toBe(0);
  });
});

describe('planning a buy', () => {
  it('buys the gap up to the lot-aware target', () => {
    const p = samplePortfolio();
    const plan = planBuy(p, stockOf(p, 'MU'), 'target')!;

    expect(plan).toMatchObject({
      action: 'BUY',
      shares: 60, // 940 → 1,000
      goalShares: 1000,
      resultShares: 1000,
      resultIsLot: true,
      partial: false,
    });
    expect(plan.amount).toBeCloseTo(60 * 118.4, 6);
    expect(plan.label).toBe('buy to lot-aware target (a clean lot)');
  });

  it('buys up to the highest reachable lot', () => {
    const p = samplePortfolio();
    expect(planBuy(p, stockOf(p, 'MU'), 'highlot')).toMatchObject({
      shares: 160, // 940 → 1,100
      goalShares: 1100,
      resultIsLot: true,
    });
  });

  it('buys the raw maximum with no lot preference', () => {
    const p = samplePortfolio();
    const plan = planBuy(p, stockOf(p, 'MSFT'), 'rawmax')!;
    expect(plan.shares).toBe(14); // 600 → 614, the ceiling
    expect(plan.resultIsLot).toBe(false);
    expect(plan.label).toContain('limited by its own band');
  });

  it('fills partially and says so when the cash runs out first', () => {
    const p = build(
      [
        { id: 'a', sym: 'X', price: 500, target: 30, bandMin: 25, bandMax: 35, shares: 10 },
        { id: 'b', sym: 'Y', price: 100, target: 60, bandMin: 55, bandMax: 90, shares: 300 },
      ],
      3000,
    );

    // Target is 23 shares, so it wants 13 more, but $3,000 only covers 6 at $500.
    const plan = planBuy(p, stockOf(p, 'X'), 'target')!;
    expect(plan).toMatchObject({
      shares: 6,
      goalShares: 23,
      resultShares: 16,
      resultIsLot: false,
      partial: true,
    });
    expect(plan.label).toBe('buy to target (raw, no nearby lot fit inside the band)');
  });

  it('returns nothing when the holding is already at or above the goal', () => {
    const p = samplePortfolio();
    // MSFT sits above its target, so there is no buy to make.
    expect(planBuy(p, stockOf(p, 'MSFT'), 'target')).toBeNull();
    // And nothing higher than 600 is reachable.
    expect(planBuy(p, stockOf(p, 'MSFT'), 'highlot')).toBeNull();
  });

  it('returns nothing when the cash cannot cover even one share', () => {
    const p = { ...samplePortfolio(), cash: 10 };
    expect(planBuy(p, stockOf(p, 'MU'), 'target')).toBeNull();
  });
});

describe('planning a sell', () => {
  it('sells down to the lot-aware target', () => {
    const p = samplePortfolio();
    const plan = planSell(p, stockOf(p, 'MSFT'), 'target')!;

    expect(plan).toMatchObject({
      action: 'SELL',
      shares: 100, // 600 → 500
      goalShares: 500,
      resultShares: 500,
      resultIsLot: true,
      partial: false,
    });
    expect(plan.amount).toBeCloseTo(100 * 412.3, 6);
  });

  it('sells down to the lowest reachable lot', () => {
    const p = samplePortfolio();
    expect(planSell(p, stockOf(p, 'MU'), 'lowlot')).toMatchObject({
      shares: 140, // 940 → 800
      goalShares: 800,
    });
  });

  it('sells the raw maximum, stopping at the band floor', () => {
    const p = samplePortfolio();
    expect(planSell(p, stockOf(p, 'NVDA'), 'rawmax')).toMatchObject({
      shares: 51, // 280 → 229
      goalShares: 229,
      resultIsLot: false,
    });
  });

  it('is never limited by cash', () => {
    const p = { ...samplePortfolio(), cash: 0 };
    expect(planSell(p, stockOf(p, 'MSFT'), 'target')!.partial).toBe(false);
  });

  it('returns nothing when there is no lower lot to reach', () => {
    const p = samplePortfolio();
    // NVDA holds 280 and the lowest lot inside the band is 300, which is above it.
    expect(planSell(p, stockOf(p, 'NVDA'), 'lowlot')).toBeNull();
  });
});

describe('what if I held this many', () => {
  it('prices a buy, showing where cash and weight land', () => {
    const p = samplePortfolio();
    // MU holds 940 at $118.40; try 1,000. That is 60 sh for $7,104, well inside the cash.
    const w = whatIf(p, stockOf(p, 'MU'), 1000);

    expect(w).toMatchObject({ action: 'BUY', shares: 60, partial: false, targetShares: 1000 });
    expect(w.amount).toBeCloseTo(7104, 6);
    expect(w.cashAfter).toBeCloseTo(38000 - 7104, 6);
    expect(w.weightBefore).toBeCloseTo(19.773, 3);
    expect(w.weightAfter).toBeCloseTo(21.035, 3);
    expect(w.isLot).toBe(true);
  });

  it('prices a sell as cash coming back in', () => {
    const p = samplePortfolio();
    const w = whatIf(p, stockOf(p, 'MSFT'), 500);

    expect(w).toMatchObject({ action: 'SELL', shares: 100 });
    expect(w.cashAfter).toBeCloseTo(38000 + 41230, 6);
    expect(w.weightAfter).toBeLessThan(w.weightBefore);
  });

  it('flags a count that would leave the band without refusing to price it', () => {
    const p = samplePortfolio();

    // 700 MSFT is 51.3%, above the 45% ceiling: still answered, but marked.
    expect(whatIf(p, stockOf(p, 'MSFT'), 700).withinBand).toBe(false);
    // 550 lands at 40.3%, inside 35–45%.
    expect(whatIf(p, stockOf(p, 'MSFT'), 550).withinBand).toBe(true);
  });

  it('clamps a buy to what the cash can actually pay for', () => {
    const p = samplePortfolio();
    // 100 more MSFT costs $41,230 against $38,000 of cash, so only 92 shares are reachable.
    const w = whatIf(p, stockOf(p, 'MSFT'), 700);

    expect(w).toMatchObject({ action: 'BUY', shares: 92, requested: 100, partial: true });
    expect(w.amount).toBeCloseTo(92 * 412.3, 6);
    expect(w.cashAfter).toBeGreaterThanOrEqual(0);
    // The weight shown is where it actually lands, not where the advisor aimed.
    expect(w.weightAfter).toBeCloseTo(((692 * 412.3) / 562871.5) * 100, 6);
    expect(w.isLot).toBe(false);
  });

  it('never clamps a sell, since selling raises cash', () => {
    const p = { ...samplePortfolio(), cash: 0 };
    expect(whatIf(p, stockOf(p, 'MSFT'), 100)).toMatchObject({
      action: 'SELL',
      shares: 500,
      partial: false,
    });
  });

  it('reports nothing to do when the count matches what is held', () => {
    const p = samplePortfolio();
    const w = whatIf(p, stockOf(p, 'MSFT'), 600);
    expect(w.action).toBeNull();
    expect(w.shares).toBe(0);
    expect(w.cashAfter).toBe(w.cashBefore);
  });

  it('rounds a fractional request down and refuses a negative one', () => {
    const p = samplePortfolio();
    expect(whatIf(p, stockOf(p, 'MSFT'), 650.9).targetShares).toBe(650);
    expect(whatIf(p, stockOf(p, 'MSFT'), -50).targetShares).toBe(0);
  });

  it('turns into an executable trade that matches the preview', () => {
    const p = samplePortfolio();
    const w = whatIf(p, stockOf(p, 'MU'), 1000);
    const plan = planToShares(p, stockOf(p, 'MU'), 1000)!;

    expect(plan).toMatchObject({ action: 'BUY', shares: w.shares, resultShares: 1000 });
    expect(plan.amount).toBeCloseTo(w.amount, 6);
    expect(plan.label).toContain('1,000 shares');
  });

  it('carries the cash clamp into the trade, so the preview never overpromises', () => {
    const p = samplePortfolio();
    const w = whatIf(p, stockOf(p, 'MSFT'), 700);
    const plan = planToShares(p, stockOf(p, 'MSFT'), 700)!;

    expect(plan.shares).toBe(w.shares);
    expect(plan.partial).toBe(true);
    expect(plan.resultShares).toBe(692);
  });

  it('has no trade to make when the count is already held', () => {
    const p = samplePortfolio();
    expect(planToShares(p, stockOf(p, 'MSFT'), 600)).toBeNull();
  });
});

/**
 * A position with no price is not a blank cell, it is a wrong page: it contributes nothing to
 * total account value, so the denominator under every weight is too small and every other
 * position reads as a larger share of the account than it is. The trade log will not export
 * while one exists, because a spreadsheet outlives the session that made it.
 */
describe('positions the tool cannot value', () => {
  const priced = (sym: string, price: number, shares: number): Stock => ({
    id: sym,
    sym,
    price,
    target: 25,
    bandMin: 20,
    bandMax: 30,
    shares,
  });

  it('finds nothing to complain about when every position has a price', () => {
    expect(unpricedPositions(samplePortfolio())).toEqual([]);
  });

  it('names the positions carrying no price', () => {
    const p = build([priced('AAA', 100, 10), priced('BBB', 0, 0), priced('CCC', 0, 40)], 5000);

    expect(unpricedPositions(p).map((s) => s.sym)).toEqual(['BBB', 'CCC']);
  });

  /** A negative price is as unusable as none, and a hand-typed field can produce one. */
  it('treats a nonsense price the same as a missing one', () => {
    const p = build([priced('AAA', 100, 10), priced('BBB', -5, 10)], 0);
    expect(unpricedPositions(p).map((s) => s.sym)).toEqual(['BBB']);
  });

  it('shows why it matters: the unpriced row drags every other weight up', () => {
    const withPrice = build([priced('AAA', 100, 100), priced('BBB', 100, 100)], 0);
    const without = build([priced('AAA', 100, 100), priced('BBB', 0, 100)], 0);

    // AAA is genuinely half the account. With BBB unpriced it reports as the whole of it.
    expect(weight(withPrice, stockOf(withPrice, 'AAA'))).toBeCloseTo(50, 6);
    expect(weight(without, stockOf(without, 'AAA'))).toBeCloseTo(100, 6);
    expect(totalValue(without)).toBe(10_000);
  });
});

/**
 * The two faults kept apart. Both block the export; only one moves other positions' numbers, and
 * the copy on the page claims the stronger one only when it is true.
 */
describe('what an unpriced position does to the totals', () => {
  const row = (sym: string, price: number, shares: number): Stock => ({
    id: sym,
    sym,
    price,
    target: 25,
    bandMin: 20,
    bandMax: 30,
    shares,
  });

  it('leaves every total untouched when the position holds nothing', () => {
    // The common case: a model row the account has not bought. Zero shares are worth zero at
    // any price, so nothing downstream moves.
    const unpriced = build([row('MSFT', 412.3, 600), row('AAPL', 0, 0)], 38_000);
    const priced = build([row('MSFT', 412.3, 600), row('AAPL', 298.6, 0)], 38_000);

    expect(totalValue(unpriced)).toBe(totalValue(priced));
    expect(weight(unpriced, stockOf(unpriced, 'MSFT'))).toBeCloseTo(
      weight(priced, stockOf(priced, 'MSFT')),
      9,
    );
  });

  it('hides real value, and inflates every other weight, when shares are held', () => {
    const unpriced = build([row('MSFT', 412.3, 600), row('AAPL', 0, 500)], 38_000);
    const priced = build([row('MSFT', 412.3, 600), row('AAPL', 298.6, 500)], 38_000);

    expect(totalValue(priced) - totalValue(unpriced)).toBeCloseTo(149_300, 6);
    expect(weight(unpriced, stockOf(unpriced, 'MSFT'))).toBeCloseTo(86.684, 3);
    expect(weight(priced, stockOf(priced, 'MSFT'))).toBeCloseTo(56.911, 3);
  });

  it('blocks the export for either fault', () => {
    expect(unpricedPositions(build([row('AAPL', 0, 0)], 0))).toHaveLength(1);
    expect(unpricedPositions(build([row('AAPL', 0, 500)], 0))).toHaveLength(1);
  });
});
