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
  planToBandEdge,
  planToLot,
  planToTarget,
  rawMaxBuy,
  rawMinSell,
  planToShares,
  totalValue,
  unpricedPositions,
  afterTrading,
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

    /* MSFT: raw 546.08, nearest lot 500 — which is also the lowest lot its band admits, and the
       Lot to lower band column's answer. So the target steps a rung up to 600, which the 45%
       ceiling still allows. */
    const msft = lotAwareTarget(p, stockOf(p, 'MSFT'));
    expect(msft.raw).toBeCloseTo(546.08, 2);
    expect(msft.goal).toBe(600);
    expect(msft.isLot).toBe(true);
    expect(lowestLotWithinBand(p, stockOf(p, 'MSFT')).lowestLot).toBe(500);

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
    /* The highest lot at or below NVDA's ceiling is also 300 — but its target is 305, so that lot
       sits *below* what the model asked for and a column named for the top of the range would be
       pointing under the target. The ceiling itself, 380, answers instead. */
    expect(highestLotWithinBand(p, stockOf(p, 'NVDA')).highestLot).toBe(380);
    expect(highestLotWithinBand(p, stockOf(p, 'NVDA')).isLot).toBe(false);
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
    // MU sits at 940 against a goal of 1,000, so the model is still asking for something.
    expect(needsDecision(p, stockOf(p, 'MU'))).toBe(true);
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

describe('planning a trade to the target', () => {
  it('buys the gap up to the lot-aware target', () => {
    const p = samplePortfolio();
    const plan = planToTarget(p, stockOf(p, 'MU'))!;

    expect(plan).toMatchObject({
      action: 'BUY',
      shares: 60, // 940 → 1,000
      goalShares: 1000,
      resultShares: 1000,
      resultIsLot: true,
      partial: false,
    });
    expect(plan.amount).toBeCloseTo(60 * 118.4, 6);
    expect(plan.label).toBe('buy up to the lot-aware target, a clean lot');
  });

  it('sells down to it from the other side, off the same call', () => {
    /* Built rather than taken from the sample: every position there now sits at or below its
       target lot, so the sample has no sell-to-target left to demonstrate. 4,000 shares at $100 in
       a $500,000 account is 80% against a 10% target. */
    const p = build(
      [{ id: 'a', sym: 'BIG', price: 100, target: 10, bandMin: 8, bandMax: 12, shares: 4000 }],
      100_000,
    );
    const plan = planToTarget(p, stockOf(p, 'BIG'))!;

    expect(plan).toMatchObject({
      action: 'SELL',
      shares: 3500, // 4,000 → 500
      goalShares: 500,
      resultShares: 500,
      resultIsLot: true,
      partial: false,
    });
    expect(plan.amount).toBeCloseTo(3500 * 100, 6);
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
    const plan = planToTarget(p, stockOf(p, 'X'))!;
    expect(plan).toMatchObject({
      shares: 6,
      goalShares: 23,
      resultShares: 16,
      resultIsLot: false,
      partial: true,
    });
    expect(plan.label).toBe('buy up to the target, raw — no nearby lot fits inside the band');
  });

  it('is never limited by cash on the sell side', () => {
    const p = { ...samplePortfolio(), cash: 0 };
    expect(planToTarget(p, stockOf(p, 'MSFT'))!.partial).toBe(false);
  });

  it('returns nothing when the holding already sits on the goal', () => {
    const p = samplePortfolio();
    const mu = stockOf(p, 'MU');
    const at = { ...p, stocks: p.stocks.map((s) => (s.id === mu.id ? { ...s, shares: 1000 } : s)) };
    expect(planToTarget(at, stockOf(at, 'MU'))).toBeNull();
  });

  it('returns nothing when the cash cannot cover even one share', () => {
    // X sits under its target and wants eight more shares at $500, against $5 of cash.
    const p = build(
      [
        { id: 'a', sym: 'X', price: 500, target: 60, bandMin: 50, bandMax: 70, shares: 10 },
        { id: 'b', sym: 'Y', price: 100, target: 35, bandMin: 30, bandMax: 40, shares: 100 },
      ],
      5,
    );
    expect(planToTarget(p, stockOf(p, 'X'))).toBeNull();
  });
});

describe('planning a trade to a band-edge lot', () => {
  it('buys up to the highest lot inside the ceiling', () => {
    const p = samplePortfolio();
    expect(planToLot(p, stockOf(p, 'MU'), 'high')).toMatchObject({
      action: 'BUY',
      shares: 160, // 940 → 1,100
      goalShares: 1100,
      resultIsLot: true,
    });
  });

  it('sells down to the lowest lot above the floor', () => {
    const p = samplePortfolio();
    expect(planToLot(p, stockOf(p, 'MU'), 'low')).toMatchObject({
      action: 'SELL',
      shares: 140, // 940 → 800
      goalShares: 800,
    });
  });

  /**
   * The bug this call exists for. NVDA holds 280 and the lowest lot inside its band is 300, so
   * the column shows a green BUY of 20 shares — and the old one-way planner answered null to it,
   * leaving a live-looking button that did nothing on exactly the rows that needed one.
   */
  it('buys up to the lower lot when the holding sits beneath it', () => {
    const p = samplePortfolio();
    expect(planToLot(p, stockOf(p, 'NVDA'), 'low')).toMatchObject({
      action: 'BUY',
      shares: 20, // 280 → 300
      goalShares: 300,
      resultIsLot: true,
    });
  });

  /** The mirror: a position past its ceiling sells down to the upper lot. */
  it('sells down to the upper lot when the holding sits above it', () => {
    const p = build(
      [{ id: 'a', sym: 'OVER', price: 100, target: 10, bandMin: 8, bandMax: 12, shares: 3000 }],
      10_000,
    );
    /* 300 is the highest lot under the 12% ceiling, but the target is 310 shares, so the lot sits
       below it and the ceiling stands in: 372 shares. Selling to a lot here would have sold 72
       shares further than the mandate asked for. */
    expect(planToLot(p, stockOf(p, 'OVER'), 'high')).toMatchObject({
      action: 'SELL',
      shares: 2628, // 3,000 → 372, the 12% ceiling itself
      goalShares: 372,
    });
  });

  it('has no answer where the lot rule does not apply', () => {
    const p = build(
      [
        {
          id: 'a',
          sym: 'FUND',
          price: 50,
          target: 10,
          bandMin: 8,
          bandMax: 12,
          shares: 100,
          lotRounding: false,
        },
      ],
      10_000,
    );
    expect(planToLot(p, stockOf(p, 'FUND'), 'high')).toBeNull();
    expect(planToLot(p, stockOf(p, 'FUND'), 'low')).toBeNull();
  });
});

describe('planning a trade to the band edge itself', () => {
  it('buys up to the ceiling with no lot preference', () => {
    const p = samplePortfolio();
    const plan = planToBandEdge(p, stockOf(p, 'MSFT'), 'high')!;
    expect(plan.shares).toBe(14); // 600 → 614, the ceiling
    expect(plan.resultIsLot).toBe(false);
    expect(plan.label).toBe("buy up to this stock's own 45% ceiling");
  });

  it('sells down to the floor, stopping there', () => {
    const p = samplePortfolio();
    expect(planToBandEdge(p, stockOf(p, 'NVDA'), 'low')).toMatchObject({
      action: 'SELL',
      shares: 51, // 280 → 229
      goalShares: 229,
      resultIsLot: false,
    });
  });

  /** A position under its own floor is bought up to it, which is the mandatory fix. */
  it('buys up to the floor when the holding is below the band', () => {
    const p = build(
      [{ id: 'a', sym: 'UNDER', price: 100, target: 10, bandMin: 8, bandMax: 12, shares: 20 }],
      100_000,
    );
    expect(planToBandEdge(p, stockOf(p, 'UNDER'), 'low')).toMatchObject({
      action: 'BUY',
      shares: 62, // 20 → 82
      goalShares: 82, // 8% of $102,000 at $100, rounded up into the band
    });
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

/**
 * The box beside these columns takes an amount to trade, because the columns beside it state
 * amounts to trade. It used to take a holding total, so reading 342 out of "room to the ceiling"
 * and typing it against a 379-share position produced a sell of 37 — the right figure, the
 * opposite trade, with nothing to say it had been misread.
 */
describe('turning an amount to trade into where the position lands', () => {
  const held = (shares: number): Stock => ({
    id: 'x',
    sym: 'AAPL',
    price: 319.02,
    target: 2.5,
    bandMin: 2,
    bandMax: 6,
    shares,
  });

  it('adds a buy to what is already held', () => {
    // The case from the real account: 379 held, 342 of room to the ceiling.
    expect(afterTrading(held(379), 342)).toBe(721);
  });

  it('subtracts a sell from it', () => {
    expect(afterTrading(held(379), -138)).toBe(241);
  });

  it('stops a sell at the whole holding rather than going negative', () => {
    // A negative share count would subtract value from the account total and inflate every
    // other weight drawn from it.
    expect(afterTrading(held(379), -500)).toBe(0);
    expect(afterTrading(held(0), -100)).toBe(0);
  });

  it('ignores a fractional amount rather than inventing a part share', () => {
    expect(afterTrading(held(379), 12.9)).toBe(391);
    expect(afterTrading(held(379), -12.9)).toBe(367);
  });

  it('prices the landing through the untouched engine', () => {
    const p = samplePortfolio();
    const msft = stockOf(p, 'MSFT'); // 600 held

    // Trading +100 has to price identically to asking for a holding of 700.
    const viaDelta = whatIf(p, msft, afterTrading(msft, 100));
    const viaTotal = whatIf(p, msft, 700);

    expect(viaDelta).toEqual(viaTotal);
    expect(viaDelta.action).toBe('BUY');

    // And the cash clamp still bites through the new path: $38,000 buys 92 of the 100 asked
    // for at $412.30, which is a partial fill rather than a silent shortfall.
    expect(viaDelta.requested).toBe(100);
    expect(viaDelta.shares).toBe(92);
    expect(viaDelta.partial).toBe(true);
  });
});

/**
 * The tolerance that lets a lot land just outside the band.
 *
 * Built from the CFP's own account rather than round numbers, because the case it exists for is
 * a real one and the margins in it are small enough that invented figures would not reproduce it.
 * AAPL, $316.22, in an account totalling $1,612,844.98: a 2.5% target is 127.5 shares and the
 * nearest lot of 100 comes to 1.961% against a 2% floor.
 */
describe('the lot tolerance', () => {
  /** The user's account, reduced to the one row under test plus a filler holding the total. */
  const aapl = (bandMin = 2, bandMax = 6, target = 2.5, price = 316.22) => {
    const stocks: Stock[] = [
      { id: 'a', sym: 'AAPL', price, target, bandMin, bandMax, shares: 127 },
      { id: 'f', sym: 'FILL', price: 1, target: 97.5, bandMin: 90, bandMax: 100, shares: 1_572_685 },
    ];
    const p = build(stocks, 0);
    // Nudge the filler so the account totals what the real one did.
    stocks[1].shares = Math.round(1_612_844.98 - 127 * price);
    return p;
  };

  it('takes the lot that misses the floor by less than a tenth of a point', () => {
    const p = aapl();
    const s = stockOf(p, 'AAPL');

    expect(totalValue(p)).toBeCloseTo(1_612_844.98, 0);
    expect(weight(p, s)).toBeCloseTo(2.49, 2);

    const lt = lotAwareTarget(p, s);
    expect(lt.raw).toBeCloseTo(127.5, 1);
    /* 100 shares are 1.961%, four hundredths of a point under the 2% floor — close enough for the
       column named after that floor, but this column points at the mandate, and 200 is the
       nearest lot the mandate actually admits. */
    expect(lt.goal).toBe(200);
    expect(lt.isLot).toBe(true);
    expect(lt.pushed).toBe(true);

    // The floor column is where the tolerance shows: 100 rather than a jump to 200.
    expect(lowestLotWithinBand(p, s)).toMatchObject({ lowestLot: 100, isLot: true });
  });

  it('does not flag the position the floor column just told you to hold', () => {
    const p = aapl();
    const s = stockOf(p, 'AAPL');
    // The Lot to lower band column answers 100, on the tolerance. Holding it must not then be
    // reported as a breach: a destination the tool names and then alarms about is not a
    // destination.
    s.shares = lowestLotWithinBand(p, s).lowestLot;

    expect(s.shares).toBe(100);
    expect(weight(p, s)).toBeLessThan(s.bandMin);
    expect(mandatoryStatus(p, s)).toBeNull();
  });

  it('takes the next lot up when the nearest one misses by more than the tolerance', () => {
    // A 2.4% floor puts the same 1.961% lot 0.44 of a point out — far past the tolerance. The
    // answer is the nearest lot that does fit, not an odd share count: this column owes a lot.
    const p = aapl(2.4);
    const lt = lotAwareTarget(p, stockOf(p, 'AAPL'));

    expect(lt.goal).toBe(200);
    expect(lt.isLot).toBe(true);
    expect(lt.pushed).toBe(true);
  });

  it('keeps the raw count only where no lot fits the band at all', () => {
    // A 2.5-3% band on a $316 stock spans 128 to 153 shares. Even stretched both ways it reaches
    // only 123 to 158, and no multiple of 100 lies in that: 100 is under it and 200 over it. With
    // no lot to name, the raw count is the only honest answer left.
    const p = aapl(2.5, 3);
    const lt = lotAwareTarget(p, stockOf(p, 'AAPL'));

    // Both lot columns fall back to their band edge, having no lot to offer on either side.
    expect(lowestLotWithinBand(p, stockOf(p, 'AAPL')).lowestLot).toBe(128);
    expect(highestLotWithinBand(p, stockOf(p, 'AAPL')).highestLot).toBe(153);
    expect(lt.goal).toBe(128);
    expect(lt.isLot).toBe(false);
  });

  it('steps up a rung when the nearest lot is the floor column\'s answer', () => {
    /* A 1.5% floor contains the 100-share lot outright, so no tolerance is spent here — and the
       target still moves to 200, because 100 is what the Lot to lower band column answers and two
       columns carrying one number is what the step exists to prevent. */
    const p = aapl(1.5);
    const s = stockOf(p, 'AAPL');

    expect(lowestLotWithinBand(p, s)).toMatchObject({ lowestLot: 100, isLot: true });
    expect(lotAwareTarget(p, s)).toMatchObject({ goal: 200, isLot: true });
  });

  it('works the same at the ceiling', () => {
    /* Squeeze the ceiling to 1.9% and put the target under it at 1.5%. The 100-share lot is now
       1.961%, six hundredths of a point *over* the ceiling — and the tolerance has to admit it
       from this side exactly as it does from the floor. Strictly, the highest lot under a 1.9%
       ceiling is zero. */
    const p = aapl(0.5, 1.9, 1.5);
    const s = stockOf(p, 'AAPL');

    expect(highestLotWithinBand(p, s)).toMatchObject({ highestLot: 100, isLot: true });
    expect(mandatoryStatus(p, { ...s, shares: 100 })).toBeNull();
  });

  it('leaves the three lot columns as a ladder, each a rung above the last', () => {
    const p = aapl();
    const s = stockOf(p, 'AAPL');

    /* The whole reason the target clamps strictly while the edges clamp tolerantly. Tolerant
       throughout, the floor lot and the target lot were both 100 and one of the two columns was
       carrying no information. */
    expect(lowestLotWithinBand(p, s).lowestLot).toBe(100);
    expect(lotAwareTarget(p, s).goal).toBe(200);
    expect(highestLotWithinBand(p, s).highestLot).toBe(300);
  });

  it('leaves the band edges themselves strict', () => {
    const p = aapl();
    const s = stockOf(p, 'AAPL');
    // The Lower band and Upper band columns state the mandate as written, tolerance or no.
    expect(bandShareLimits(p, s).minShares).toBe(103);
    expect(bandShareLimits(p, s).maxShares).toBe(306);
  });
});

/**
 * A band too narrow to hold any round lot.
 *
 * Both rows are the CFP's own, and both were dangerous rather than merely untidy. SNDK at
 * $1,737.99 in a $1.61m account has a 2–5% band of 19 to 46 shares; the multiples of 100 either
 * side of that are 0 and 100. So the two lot columns offered a buy that broke the ceiling they
 * were named after, and a sale of the entire position — and the universal buttons would have done
 * it to every row of this shape in one press.
 */
describe('a band with no lot in it', () => {
  /**
   * One row at a real price, with a filler position carrying the rest of a $1.61m account and the
   * cash balance the CFP actually has. The cash matters: a buy is clamped to what it can pay for,
   * so an account with none would return no plan and prove nothing about the destination chosen.
   */
  const CASH = 485_237.22;
  const account = (sym: string, price: number, shares: number, bandMin = 2, bandMax = 5) => {
    const stocks: Stock[] = [
      { id: 'a', sym, price, target: 2.5, bandMin, bandMax, shares },
      { id: 'f', sym: 'FILL', price: 1, target: 97.5, bandMin: 90, bandMax: 100, shares: 0 },
    ];
    const p = build(stocks, CASH);
    stocks[1].shares = Math.round(1_612_568 - CASH - shares * price);
    return p;
  };

  it('offers the band floor where the lowest lot would break the ceiling', () => {
    const p = account('SNDK', 1737.99, 27);
    const s = stockOf(p, 'SNDK');

    // 2–5% of the account is 19 to 46 shares. The lowest lot at or above 19 is 100 — which is
    // 10.8% of the account, more than double the 5% ceiling this column is named for.
    expect(bandShareLimits(p, s).minShares).toBe(19);
    expect(bandShareLimits(p, s).maxShares).toBe(46);

    const low = lowestLotWithinBand(p, s);
    expect(low.lowestLot).toBe(19);
    expect(low.isLot).toBe(false);
  });

  it('offers the band ceiling where the highest lot is nothing at all', () => {
    const p = account('SNDK', 1737.99, 27);
    const s = stockOf(p, 'SNDK');

    // The highest multiple of 100 at or below 46 shares is zero: the column read "0 sh" and its
    // button sold a position the model asks him to hold.
    const high = highestLotWithinBand(p, s);
    expect(high.highestLot).toBe(46);
    expect(high.isLot).toBe(false);
  });

  it('never plans a trade to zero on a position the model wants held', () => {
    const p = account('SNDK', 1737.99, 27);
    const plan = planToLot(p, stockOf(p, 'SNDK'), 'high');

    expect(plan).toMatchObject({ action: 'BUY', goalShares: 46 });
    expect(plan!.resultShares).toBe(46);
  });

  it('never plans the buy that breaks the ceiling', () => {
    const p = account('SNDK', 1737.99, 27);
    const plan = planToLot(p, stockOf(p, 'SNDK'), 'low');

    // Down to the floor, not up to a 100-share lot worth $126,873.
    expect(plan).toMatchObject({ action: 'SELL', goalShares: 19 });
    expect(plan!.amount).toBeLessThan(20_000);
  });

  it('does the same for MU, the other row of this shape', () => {
    const p = account('MU', 1000.26, 24);
    const s = stockOf(p, 'MU');

    // 2–5% is 33 to 80 shares, and again no multiple of 100 lies inside it.
    expect(bandShareLimits(p, s).minShares).toBe(33);
    expect(bandShareLimits(p, s).maxShares).toBe(80);
    expect(lowestLotWithinBand(p, s).lowestLot).toBe(33);
    expect(highestLotWithinBand(p, s).highestLot).toBe(80);
    // The target itself has no lot either, so it stays raw.
    expect(lotAwareTarget(p, s).isLot).toBe(false);
    expect(lotAwareTarget(p, s).goal).toBe(40);
  });

  it('leaves a row alone when its lots are genuinely usable', () => {
    // CSX at $49: a 2–5% band is 659 to 1,645 shares, which holds 700 through 1,600 comfortably.
    const p = account('CSX', 49, 984);
    const s = stockOf(p, 'CSX');

    expect(lowestLotWithinBand(p, s)).toMatchObject({ lowestLot: 700, isLot: true });
    expect(highestLotWithinBand(p, s)).toMatchObject({ highestLot: 1600, isLot: true });
    // …and the target keeps the nearest lot, rather than being pushed up a rung.
    expect(lotAwareTarget(p, s)).toMatchObject({ goal: 800, isLot: true, pushed: false });
  });
});

/**
 * The higher lot first, where the nearer one is already the floor column's answer.
 *
 * The CFP's rule, and the three rows he settled it on. It is a test, not a preference for buying:
 * a column showing the same share count as the column beside it is a column doing no work. CSX is
 * the row that proves it is not a blanket round-up.
 */
describe('stepping the target lot up a rung', () => {
  const TOTAL = 1_612_801.75;
  const at = (sym: string, price: number, shares: number, bandMin: number, bandMax: number) => {
    const stocks: Stock[] = [
      { id: 'a', sym, price, target: 2.5, bandMin, bandMax, shares },
      { id: 'f', sym: 'FILL', price: 1, target: 90, bandMin: 80, bandMax: 99, shares: 0 },
    ];
    stocks[1].shares = Math.round(TOTAL - shares * price);
    return build(stocks, 0);
  };

  it('steps CVS to 500, where 400 is both the nearest lot and the floor lot', () => {
    const p = at('CVS', 96.07, 659, 2, 5);
    const s = stockOf(p, 'CVS');

    // The band runs 336 to 839 shares, so 400 through 800 all fit and there is room to step.
    expect(bandShareLimits(p, s)).toMatchObject({ minShares: 336, maxShares: 839 });
    expect(lowestLotWithinBand(p, s).lowestLot).toBe(400);
    expect(lotAwareTarget(p, s).goal).toBe(500);
  });

  it('steps GOOGL to 200 even though its band holds only two lots', () => {
    const p = at('GOOGL', 338.36, 83, 2, 5);
    const s = stockOf(p, 'GOOGL');

    /* 96 to 238 shares admits 100 and 200 and nothing else, so the step lands on the same figure
       the ceiling column shows. Still worth taking: the alternative leaves the target column
       repeating the floor column, and the CFP would rather the clash sat at the top. */
    expect(lowestLotWithinBand(p, s).lowestLot).toBe(100);
    expect(lotAwareTarget(p, s).goal).toBe(200);
    expect(highestLotWithinBand(p, s).highestLot).toBe(200);
  });

  it('leaves CSX at 800, because its nearest lot already differs from its floor lot', () => {
    const p = at('CSX', 49, 984, 2, 5);
    const s = stockOf(p, 'CSX');

    /* The row that makes this a test rather than a rule. 800 is the nearest lot to an 823-share
       target and the floor lot is 700, so they already differ — and 900 would be four times
       further from what the model asked for, bought for nothing. */
    expect(lowestLotWithinBand(p, s).lowestLot).toBe(700);
    expect(lotAwareTarget(p, s)).toMatchObject({ goal: 800, pushed: false });
  });

  it('does not step where the band has no room for the next rung', () => {
    // NVDA's 9-15% band admits exactly one lot, 300. The clash stands rather than the mandate
    // being broken to separate two columns.
    const p = samplePortfolio();
    const s = stockOf(p, 'NVDA');

    expect(lowestLotWithinBand(p, s).lowestLot).toBe(300);
    expect(lotAwareTarget(p, s).goal).toBe(300);
  });

  it('does not step where the floor column is showing a band edge rather than a lot', () => {
    // SNDK has no lot anywhere in its band, so there is no clash to resolve and nothing to step.
    const p = at('SNDK', 1737.99, 27, 2, 5);
    const s = stockOf(p, 'SNDK');

    expect(lowestLotWithinBand(p, s).isLot).toBe(false);
    expect(lotAwareTarget(p, s)).toMatchObject({ goal: 23, isLot: false });
  });
});
