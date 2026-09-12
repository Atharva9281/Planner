/**
 * The lot-aware cash deployment math.
 *
 * Every function here is pure: it reads a portfolio and returns numbers, and never mutates
 * anything. State transitions live in `actions.ts`.
 *
 * The one idea underneath all of it: a stock's band is expressed in percent of *total account
 * value*, so the dollar width of every band moves whenever cash moves, whenever a price changes,
 * and whenever an off-model holding is sold. Nothing here caches a total.
 */

import { Destination, LotEdge, OffModelHolding, Portfolio, Stock, TradePlan } from './types';

export const LOT = 100;

/**
 * How far outside its own band a position may land, in percentage points of total account value,
 * when landing there is what buys a clean round lot.
 *
 * The reason it exists, from the CFP's own file. AAPL at $316.22 in a $1.61m account: a 2.5%
 * target is 127.5 shares, the nearest lot is 100, and 100 shares come to 1.961% against a 2%
 * floor — outside the mandate by four hundredths of a point. Without a tolerance the lot is
 * refused and the raw 128 stands. The next lot that does fit the band is 200, which is $63,244
 * against a $40,321 target: a 57% overshoot bought purely to stay the right side of a line the
 * 100 misses by 0.04. Round lots are worth a hair; they are not worth that.
 *
 * 0.1 rather than 0.2: it clears this case with room to spare, and it is a number that can be
 * defended. Symmetric, because there is no argument for the floor that is not also an argument
 * for the ceiling.
 *
 * It is a property of the *band*, not of the lot rule, so everything that asks "is this weight
 * acceptable" reads it — `mandatoryStatus` included. Applied to the lot maths alone, the tool
 * would name 100 shares as the target and then flag the position the moment you held it.
 *
 * A miss wider than this is not a special case either: the answer becomes the nearest lot that
 * does fit, which is what the column promises. Only a band too narrow to contain any lot at all
 * falls back to a raw share count.
 */
export const LOT_BAND_TOLERANCE = 0.1;

/* ------------------------------------------------------------------ */
/* the denominator                                                     */
/* ------------------------------------------------------------------ */

/** Cash plus every model holding plus every off-model holding, all at current prices. */
export function totalValue(p: Portfolio): number {
  let v = p.cash;
  for (const s of p.stocks) v += s.shares * s.price;
  for (const h of p.offModel) v += h.shares * h.price;
  return v;
}

export function weight(p: Portfolio, s: Stock): number {
  const t = totalValue(p);
  return t > 0 ? ((s.shares * s.price) / t) * 100 : 0;
}

export function cashPct(p: Portfolio): number {
  const t = totalValue(p);
  return t > 0 ? (p.cash / t) * 100 : 0;
}

export function offModelValue(h: OffModelHolding): number {
  return h.shares * h.price;
}

/* ------------------------------------------------------------------ */
/* band limits                                                         */
/* ------------------------------------------------------------------ */

export interface BandShareLimits {
  /** Fewest whole shares that still sit at or above the band floor. */
  minShares: number;
  /** Most whole shares that still sit at or below the band ceiling. */
  maxShares: number;
  /** The same two numbers before rounding, which the lot math needs unrounded. */
  rawFloorShares: number;
  rawCeilingShares: number;
}

export function bandShareLimits(p: Portfolio, s: Stock): BandShareLimits {
  const t = totalValue(p);
  if (s.price <= 0) {
    return { minShares: 0, maxShares: 0, rawFloorShares: 0, rawCeilingShares: 0 };
  }
  const rawFloorShares = ((s.bandMin / 100) * t) / s.price;
  const rawCeilingShares = ((s.bandMax / 100) * t) / s.price;
  return {
    minShares: Math.ceil(rawFloorShares),
    maxShares: Math.floor(rawCeilingShares),
    rawFloorShares,
    rawCeilingShares,
  };
}

/**
 * The band's two edges in shares, widened by the lot tolerance.
 *
 * Only the lot questions read this. `bandShareLimits` above stays strict, because the Lower band
 * and Upper band columns state the mandate itself and must not quietly report a wider one.
 */
function tolerantShareLimits(p: Portfolio, s: Stock): { floor: number; ceiling: number } {
  const t = totalValue(p);
  if (s.price <= 0) return { floor: 0, ceiling: 0 };
  return {
    floor: (((s.bandMin - LOT_BAND_TOLERANCE) / 100) * t) / s.price,
    ceiling: (((s.bandMax + LOT_BAND_TOLERANCE) / 100) * t) / s.price,
  };
}

/* ------------------------------------------------------------------ */
/* the lot-aware target                                                */
/* ------------------------------------------------------------------ */

export interface LotAwareTarget {
  /** The exact, fractional share count the target weight implies. */
  raw: number;
  /** What to aim at: the nearest lot that fits the band, or the raw count when no lot fits. */
  goal: number;
  /** True when `goal` is a clean lot rather than the raw fallback. */
  isLot: boolean;
  /**
   * True when the nearest lot to the target did not fit and this is the nearest one that does.
   *
   * Worth saying out loud, because the gap can be large: on a $316 stock the lot grid moves in
   * steps of about a point of the account, so the lot that fits can be half as big again as the
   * target asked for. The row states where it lands rather than leaving that to be worked out.
   */
  pushed: boolean;
  lower: number;
  upper: number;
}

/**
 * The core check. Take the target weight, convert it to shares, and look at the nearest multiple
 * of 100. If its weight lands inside the band — or within `LOT_BAND_TOLERANCE` of it — that lot is
 * the answer.
 *
 * If it does not, the answer is the nearest lot that *does* fit, not an odd share count. The column
 * this feeds is called "Lot to target", and a lot is what it owes: answering 128 shares because no
 * lot was convenient was answering a different question from the one being asked. The raw count
 * survives for one case only, where it is the sole honest answer — a band so narrow that no
 * multiple of 100 sits inside it.
 *
 * The band is still the mandate. What changed is which side of it a near miss is resolved on.
 */
export function lotAwareTarget(p: Portfolio, s: Stock): LotAwareTarget {
  const t = totalValue(p);
  const raw = s.price > 0 ? ((s.target / 100) * t) / s.price : 0;

  // A holding the lot rule does not apply to aims at the raw count and nothing else.
  if (!lotRounds(s)) {
    return {
      raw,
      goal: Math.round(raw),
      isLot: false,
      pushed: false,
      lower: s.bandMin,
      upper: s.bandMax,
    };
  }

  const nearestLot = Math.round(raw / LOT) * LOT;

  /*
   * Strict bounds here, tolerant ones on the two band-edge columns. The asymmetry is the point.
   *
   * The tolerance exists so a column named after the floor can still answer with a lot when the
   * only lot near that floor misses it by a hair — AAPL's 100, at 1.961% against a 2% floor. That
   * is a reasonable thing for the *edge* column to say.
   *
   * It is not a reasonable thing for this one. This column answers "where does the model point",
   * and the model points inside the band. Given the tolerance it answered 100 as well, so the two
   * columns carried one number, the target column sat outside the mandate, and the row lost a rung
   * of its ladder. Strict, it answers 200 — the nearest lot the band actually admits.
   */
  const { rawFloorShares, rawCeilingShares } = bandShareLimits(p, s);
  const lowestLot = Math.ceil(rawFloorShares / LOT) * LOT;
  const highestLot = Math.floor(rawCeilingShares / LOT) * LOT;

  /* The band is narrower than the gap between two lots, so no multiple of 100 sits in it at all.
     Only here does the raw count stand — and it has to, because there is no lot to name. */
  if (lowestLot > highestLot) {
    return {
      raw,
      goal: Math.round(raw),
      isLot: false,
      pushed: false,
      lower: s.bandMin,
      upper: s.bandMax,
    };
  }

  /* The nearest lot to the target, pulled back to the nearest one that fits if it overshoots the
     band in either direction. This column is called "Lot to target" and a lot is what it owes: an
     odd share count was a different kind of answer to the question being asked. */
  /*
   * The higher lot, always — never the nearer one.
   *
   * The CFP's rule, and the whole of it: round the target *up* to the next hundred, and take that
   * lot if the band allows it. A target of 823 shares goes to 900, not back to 800, even though
   * 800 is the closer of the two. The account this tool is for holds 30% cash against an 8%
   * ceiling, so of the two lots straddling a target, the one that puts more money to work is the
   * one he wants; and rounding a position *down* to a lot leaves it under a target he is already
   * under.
   *
   * The ceiling is what stops it. Where the next lot up sits outside the band, the answer falls
   * back to the highest lot that fits — NVDA's 9-15% admits only 300, so a target of 305 rounds up
   * to 400 and is pulled straight back to 300. The mandate is never broken to round up.
   */
  const higherLot = Math.ceil(raw / LOT) * LOT;
  const goal = Math.min(Math.max(higherLot, lowestLot), highestLot);

  return {
    raw,
    goal,
    isLot: true,
    /* True where the lot taken is not the one nearest the target, which is most of the time now
       and is exactly when the row should say what weight it lands on. */
    pushed: goal !== nearestLot,
    lower: s.bandMin,
    upper: s.bandMax,
  };
}

/** Lot rounding is on unless a holding has been marked otherwise. */
export const lotRounds = (s: Stock) => s.lotRounding !== false;

/**
 * Whether a trade may be offered on this row. Fixed income and any asset class the tool does not
 * trade are shown in full and counted toward account value, but never bought or sold here.
 */
export const isTradeable = (s: Stock) => s.tradeable !== false;

/**
 * Rows the advisor works in percent of the account rather than in share counts.
 *
 * Bond funds, in practice: traded, but with no lot rule, because you buy $20,000 of one and take
 * whatever share count the NAV gives you. The three lot columns have no answer for them and the
 * row leads with dollars instead of shares.
 *
 * Derived rather than stored, so there is no fourth flag on `Stock` to keep in step with the other
 * two: tradeable, and outside the lot grid, is exactly what a fund is.
 */
export const tradesByWeight = (s: Stock) => isTradeable(s) && !lotRounds(s);

/**
 * Which block a position sits in when the table is put in order.
 *
 *   0  ordinary holdings, read in share counts on the 100-share grid
 *   1  traded by weight — bond funds, read in dollars with three empty lot columns
 *   2  not traded here at all, an asset class the tool does not recognise
 *
 * The blocks exist because a fund's row does not just hold different numbers, it is read in a
 * different unit. Sorted strictly by ticker, this account's four bond funds land at positions 7,
 * 16, 18 and 20, so the eye changes format five times going down the table. Kept together it
 * changes once.
 */
const displayRank = (s: Stock): number => (!isTradeable(s) ? 2 : tradesByWeight(s) ? 1 : 0);

/**
 * The order every table on the page lists positions in: by ticker, with the blocks above kept
 * whole. A model export arrives in whatever order it was written, which on this account means
 * finding MCK involves reading all twenty-three rows.
 *
 * Compared with plain `<` rather than `localeCompare`, because this runs on the server and again
 * in the browser and the two need not agree on a collation — the same reason every figure on the
 * page is formatted against a pinned locale. Tickers are ASCII, so the plain comparison is the
 * one that cannot drift.
 *
 * Two rows may legitimately share a symbol; `sort` is stable, so they keep the order the model
 * gave them.
 */
export function byTicker(a: Stock, b: Stock): number {
  const block = displayRank(a) - displayRank(b);
  if (block !== 0) return block;
  return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0;
}

/** The positions in display order, without disturbing the portfolio's own array. */
export const inDisplayOrder = (stocks: Stock[]): Stock[] => [...stocks].sort(byTicker);

/**
 * The multiples of 100 the band will actually admit, tolerance allowed.
 *
 * Internal, and deliberately unsubstituted: this is what the target clamps against. The two
 * exported functions below fall back to a band edge where no lot serves, and a band edge is not a
 * lot — clamping to one would hand back an odd share count under a LOT badge.
 *
 * `lowestLot > highestLot` is the signal that no multiple of 100 sits inside the band at all.
 * SNDK at $1,737.99 in a $1.61m account is the case: a 2–5% band is 19 to 46 shares, and the
 * nearest lots either side of that are 0 and 100.
 */
function lotBounds(p: Portfolio, s: Stock): { lowestLot: number; highestLot: number } {
  const { floor, ceiling } = tolerantShareLimits(p, s);
  return {
    lowestLot: Math.ceil(floor / LOT) * LOT,
    highestLot: Math.floor(ceiling / LOT) * LOT,
  };
}

/** The whole-share count the target weight comes to, which the two columns below are judged against. */
function rawTargetShares(p: Portfolio, s: Stock): number {
  const t = totalValue(p);
  return s.price > 0 ? Math.round(((s.target / 100) * t) / s.price) : 0;
}

/**
 * What the "Lot to upper band" column answers: the highest lot at or below the ceiling — or the
 * ceiling itself, where no lot on that side is any use.
 *
 * The rule is the CFP's, and it exists because the arithmetic answer was dangerous rather than
 * merely odd. SNDK's band is 19 to 46 shares and the highest multiple of 100 at or below 46 is
 * **zero**, so this column read "0 sh" and offered a button that sold a position the model asks
 * him to hold — and the universal "To highest lot" button would have done it to every row like it
 * in one press.
 *
 * The test is against the target rather than against emptiness, because a lot below the target is
 * the same failure in a milder form: a column named for the *top* of the range, pointing below
 * what the model asked for. NVDA in the worked example does this — 300 against a target of 305 —
 * and now answers 380, the ceiling.
 *
 * `isLot` is false whenever the edge has been substituted, so the row can badge the figure as the
 * raw count it is.
 */
export function highestLotWithinBand(p: Portfolio, s: Stock): {
  highestLot: number;
  rawCeilingShares: number;
  isLot: boolean;
} {
  const { maxShares } = bandShareLimits(p, s);
  const { highestLot } = lotBounds(p, s);
  const substitute = highestLot < rawTargetShares(p, s);

  return {
    highestLot: substitute ? maxShares : highestLot,
    rawCeilingShares: maxShares,
    isLot: !substitute,
  };
}

/**
 * The sell-side mirror: the lowest lot at or above the floor, or the floor itself where no lot on
 * that side serves.
 *
 * Same fault, same shape. SNDK's lowest multiple of 100 at or above its 19-share floor is 100 —
 * which is 10.8% of the account against a 5% ceiling, so the column offered a $126,873 buy that
 * broke the mandate it was named after. The answer is the floor, 19.
 */
export function lowestLotWithinBand(p: Portfolio, s: Stock): {
  lowestLot: number;
  rawFloorShares: number;
  isLot: boolean;
} {
  const { minShares, rawFloorShares } = bandShareLimits(p, s);
  const { lowestLot } = lotBounds(p, s);
  const substitute = lowestLot > rawTargetShares(p, s);

  return {
    lowestLot: substitute ? minShares : lowestLot,
    rawFloorShares,
    isLot: !substitute,
  };
}

/**
 * One band edge's answer, whichever side is asked for, in the one shape both callers want: the
 * share count to trade to, and whether it is a genuine lot or the band edge standing in for one.
 */
export function lotEdgeReach(
  p: Portfolio,
  s: Stock,
  edge: LotEdge,
): { shares: number; isLot: boolean } {
  if (edge === 'high') {
    const { highestLot, isLot } = highestLotWithinBand(p, s);
    return { shares: highestLot, isLot };
  }
  const { lowestLot, isLot } = lowestLotWithinBand(p, s);
  return { shares: lowestLot, isLot };
}

/* ------------------------------------------------------------------ */
/* status                                                              */
/* ------------------------------------------------------------------ */

export type MandatoryStatus = 'over' | 'under' | null;

/**
 * A stock is mandatory the moment it is outside its own band in either direction, by more than
 * the lot tolerance.
 *
 * The tolerance belongs here as much as it belongs to the lot maths, and for a plain reason: with
 * it in one place and not the other, the tool names 100 shares as the target for a row and then
 * paints that row red the instant the advisor holds 100 shares. A target you cannot reach without
 * tripping the alarm is not a target.
 *
 * The cost, stated plainly: a position that drifts to 1.96% against a 2% floor no longer reads as
 * a breach. At these account sizes that is well inside a day's price movement, and the exact
 * weight is printed on the row beside the band either way — nothing is hidden, it just stops
 * shouting about four hundredths of a point.
 */
export function mandatoryStatus(p: Portfolio, s: Stock): MandatoryStatus {
  const w = weight(p, s);
  if (w > s.bandMax + LOT_BAND_TOLERANCE) return 'over';
  if (w < s.bandMin - LOT_BAND_TOLERANCE) return 'under';
  return null;
}

/**
 * Whether the model is asking for anything on this row: it sits outside its band, it has not
 * reached the lot-aware target, or it has no price and so cannot be judged at all.
 *
 * This is the one definition of "there is work here". The table collapses on it and the panel
 * header counts on it, so the two can never disagree about what is settled.
 */
export function needsDecision(p: Portfolio, s: Stock): boolean {
  // A row nothing can be done to is never asking for a decision, whatever its drift.
  if (!isTradeable(s)) return false;
  if (s.price <= 0) return true;
  if (mandatoryStatus(p, s) !== null) return true;
  return lotAwareTarget(p, s).goal !== s.shares;
}

/**
 * Positions the tool cannot value, and therefore cannot honestly report on.
 *
 * Two distinct faults, both blocking, and worth keeping apart because only one of them moves
 * other people's numbers:
 *
 * A row **holding shares** with no price is missing from total account value, which is the
 * denominator under every weight and every band in dollars. The total comes out short and every
 * other position reads as a larger share of the account than it is. Only reachable by clearing a
 * price by hand — the parser skips any holdings row without a usable one — but the damage is
 * silent and large.
 *
 * A row **holding nothing** with no price distorts no total: zero shares are worth zero at any
 * price. What it cannot do is convert its target weight into a share count, so the model's
 * instruction for that position simply has no answer.
 *
 * Either way the trade log will not export, because a spreadsheet outlives the session that made
 * it — in the first case carrying percentages that are wrong, in the second a plan with a hole
 * in it, and neither says so on the page.
 */
export function unpricedPositions(p: Portfolio): Stock[] {
  return p.stocks.filter((s) => s.price <= 0);
}

export type CashStatus = 'above' | 'below' | 'ok';

export function cashStatus(p: Portfolio): CashStatus {
  const cp = cashPct(p);
  if (cp > p.cashCeiling) return 'above';
  if (cp < p.cashFloor) return 'below';
  return 'ok';
}

/**
 * Whole shares the idle cash can pay for at this price.
 *
 * Floored at zero, because the universal buttons can leave the cash negative and a balance in the
 * red buys nothing — it does not buy a negative number of shares. Without the floor the raw-room
 * strip reported "-186 sh" as what the cash affords, which is not a quantity anyone can act on.
 */
export function affordableShares(p: Portfolio, s: Stock): number {
  return s.price > 0 ? Math.max(0, Math.floor(p.cash / s.price)) : 0;
}

/* ------------------------------------------------------------------ */
/* raw room, no lot preference                                         */
/* ------------------------------------------------------------------ */

export interface RawMaxBuy {
  rawCeilingShares: number;
  roomToCeiling: number;
  cashAfford: number;
  maxBuy: number;
  /** Which of the two constraints actually bound the answer. */
  limiter: 'band' | 'cash';
}

/** The honest maximum: as many shares as fit before either the cash or the band ceiling stops it. */
export function rawMaxBuy(p: Portfolio, s: Stock): RawMaxBuy {
  const { maxShares } = bandShareLimits(p, s);
  const roomToCeiling = Math.max(maxShares - s.shares, 0);
  const cashAfford = affordableShares(p, s);
  return {
    rawCeilingShares: maxShares,
    roomToCeiling,
    cashAfford,
    maxBuy: Math.min(roomToCeiling, cashAfford),
    limiter: roomToCeiling <= cashAfford ? 'band' : 'cash',
  };
}

export interface RawMinSell {
  minShares: number;
  maxSell: number;
}

/** The mirror: the most that could be sold before the band floor stops it. Cash never binds a sell. */
export function rawMinSell(p: Portfolio, s: Stock): RawMinSell {
  const { minShares } = bandShareLimits(p, s);
  return { minShares, maxSell: Math.max(s.shares - minShares, 0) };
}

/* ------------------------------------------------------------------ */
/* planning a trade                                                    */
/* ------------------------------------------------------------------ */

const plan = (
  s: Stock,
  action: 'BUY' | 'SELL',
  shares: number,
  goalShares: number,
  partial: boolean,
  label: string,
): TradePlan => {
  const resultShares = action === 'BUY' ? s.shares + shares : s.shares - shares;
  return {
    stockId: s.id,
    sym: s.sym,
    action,
    shares,
    price: s.price,
    amount: shares * s.price,
    goalShares,
    resultShares,
    resultIsLot: resultShares % LOT === 0,
    partial,
    label,
  };
};

export interface PlanOptions {
  /**
   * Whether a buy is cut down to what the idle cash can pay for.
   *
   * On by default, which is how every per-row button behaves: one position at a time, where
   * "spend what is actually there" is the question being asked.
   *
   * The universal buttons turn it off. Deciding what to sell to fund a buy is the advisor's call
   * and nobody else's, so those buttons land every position on its column and let the cash go
   * wherever it goes — negative included. The advisor then raises what he wants, from whatever he
   * chooses, rather than the tool quietly picking for him.
   */
  clampToCash?: boolean;
}

/**
 * Trades to a share count the table is already showing, in whichever direction reaches it.
 *
 * Every column between the ticker and the box states a destination — "the lowest lot above the
 * floor is 300 sh" — and a destination can sit above the holding or below it. `planBuy` and
 * `planSell` each know one direction only, so a column wired to either of them was dead on half
 * its rows: a position over its ceiling showed a red SELL on the upper-lot column and did nothing
 * when pressed, because the handler underneath was a buy. Reachable in the worked example, where
 * NVDA holds 280 against a lowest lot of 300 and the green BUY there never fired.
 *
 * Cash clamps a buy unless the caller says otherwise, and a clamped fill is reported as partial.
 * A sell is never clamped in either direction.
 *
 * Exported for the ranked run, which names its own destinations stage by stage and has to check
 * each one against the cash limit before it is applied rather than after. Everything else reaches
 * it through the four named planners below.
 */
export function planToDestination(
  p: Portfolio,
  s: Stock,
  goal: number,
  side: string,
  { clampToCash = true }: PlanOptions = {},
): TradePlan | null {
  const delta = goal - s.shares;
  if (delta === 0) return null;

  if (delta > 0) {
    const buy = clampToCash ? Math.min(delta, affordableShares(p, s)) : delta;
    if (buy <= 0) return null;
    return plan(s, 'BUY', buy, goal, buy < delta, `buy up to ${side}`);
  }

  return plan(s, 'SELL', -delta, goal, false, `sell down to ${side}`);
}

/** The nearest round lot inside one of the band's edges. */
export function planToLot(
  p: Portfolio,
  s: Stock,
  edge: LotEdge,
  options: PlanOptions = {},
): TradePlan | null {
  if (!isTradeable(s) || !lotRounds(s) || s.price <= 0) return null;

  const reach = lotEdgeReach(p, s, edge);
  const goal = reach.shares;
  const bound = edge === 'high' ? s.bandMax : s.bandMin;
  const name = `this stock's own ${bound}% ${edge === 'high' ? 'ceiling' : 'floor'}`;

  /* Says which of the two it actually is. Where no lot serves this side the figure is the band
     edge itself, and calling that "the lot nearest the floor" on the trade log would be a plain
     falsehood about what was traded. */
  return planToDestination(
    p,
    s,
    goal,
    reach.isLot ? `the lot nearest ${name}` : `${name}, no lot being available`,
    options,
  );
}

/**
 * The band edge itself, with no lot preference: the last share count still inside the mandate.
 *
 * Takes options for the same reason `planToTarget` does. A per-row button asks "spend what is
 * actually there" and clamps; the ranked run's move to the floor is the mandate rather than a
 * preference, so it turns the clamp off and lets the shortfall be reported instead of silently
 * part-filling a position the model requires.
 */
export function planToBandEdge(
  p: Portfolio,
  s: Stock,
  edge: LotEdge,
  options: PlanOptions = {},
): TradePlan | null {
  if (!isTradeable(s) || s.price <= 0) return null;

  const { minShares, maxShares } = bandShareLimits(p, s);
  const goal = edge === 'high' ? maxShares : minShares;
  const bound = edge === 'high' ? s.bandMax : s.bandMin;

  return planToDestination(
    p,
    s,
    goal,
    `this stock's own ${bound}% ${edge === 'high' ? 'ceiling' : 'floor'}`,
    options,
  );
}

/**
 * The share count a named destination comes to on this row, or null where it does not exist:
 * a position the tool does not trade, one with no price to convert a weight into shares, or a
 * band-edge lot on a holding the 100-share rule does not apply to.
 *
 * Every one of these is fixed the moment the files load. A trade swaps cash for shares, so total
 * account value does not move, so no destination on any other row moves either — which is what
 * makes asking for all of them at once a sum of independent answers rather than a plan.
 */
export function destinationShares(p: Portfolio, s: Stock, d: Destination): number | null {
  if (!isTradeable(s) || s.price <= 0) return null;
  if (d === 'target') return lotAwareTarget(p, s).goal;
  if (!lotRounds(s)) return null;
  return d === 'lot-high'
    ? highestLotWithinBand(p, s).highestLot
    : lowestLotWithinBand(p, s).lowestLot;
}

/* ------------------------------------------------------------------ */
/* what-if                                                             */
/* ------------------------------------------------------------------ */

export interface WhatIf {
  /** The share count being tried. */
  targetShares: number;
  action: 'BUY' | 'SELL' | null;
  /** Whole shares that would move. Clamped by cash on a buy. */
  shares: number;
  amount: number;
  /** True when the cash cannot cover the whole buy. */
  partial: boolean;
  /** What the advisor asked for, before the cash clamp. */
  requested: number;
  cashBefore: number;
  cashAfter: number;
  weightBefore: number;
  weightAfter: number;
  withinBand: boolean;
  isLot: boolean;
}

/**
 * Where a position lands if you trade this many shares of it. Negative sells.
 *
 * The bridge between how the row reads and how the engine thinks. Every figure beside the input
 * is a movement — room to the ceiling, shares the cash affords, room to the floor — while
 * everything downstream of here works in destinations. Converting in one named place keeps the
 * lot rule, the band checks and the cash clamp untouched.
 *
 * A sell stops at the whole holding: there is nothing beyond it to sell, and a negative share
 * count would poison total account value and every weight drawn from it.
 */
export function afterTrading(s: Stock, delta: number): number {
  return Math.max(0, s.shares + Math.trunc(delta));
}

/**
 * The share count a given weight of the account comes to.
 *
 * The bridge for rows the advisor works in percent: he asks for 7% of the account and the engine
 * still needs a holding to aim at. Whole shares, because the rounding is worth at most one share's
 * price — about $8 on a bond fund — against a position of six figures, and because an ETF cannot
 * be traded in fractions at most custodians anyway.
 */
export function sharesForWeight(p: Portfolio, s: Stock, percent: number): number {
  const t = totalValue(p);
  if (s.price <= 0 || t <= 0) return 0;
  return Math.max(0, Math.round(((percent / 100) * t) / s.price));
}

/**
 * Prices a hypothetical share count without touching the portfolio.
 *
 * Deliberately permissive: an advisor exploring "what if I held 700 of these" is asking a
 * question, not proposing a mandate breach, so a count outside the band is priced and flagged
 * rather than refused. Cash is the one hard limit, because you cannot spend what is not there.
 */
export function whatIf(p: Portfolio, s: Stock, targetShares: number): WhatIf {
  const total = totalValue(p);
  const want = Math.max(0, Math.floor(targetShares));
  const delta = want - s.shares;

  const weightBefore = weight(p, s);
  const base = {
    targetShares: want,
    requested: Math.abs(delta),
    cashBefore: p.cash,
    weightBefore,
  };

  if (delta === 0 || s.price <= 0) {
    return {
      ...base,
      action: null,
      shares: 0,
      amount: 0,
      partial: false,
      cashAfter: p.cash,
      weightAfter: weightBefore,
      withinBand: weightBefore >= s.bandMin && weightBefore <= s.bandMax,
      isLot: want % LOT === 0,
    };
  }

  const action = delta > 0 ? 'BUY' : 'SELL';
  const shares = action === 'BUY' ? Math.min(delta, affordableShares(p, s)) : -delta;
  const amount = shares * s.price;
  const cashAfter = action === 'BUY' ? p.cash - amount : p.cash + amount;
  const landing = action === 'BUY' ? s.shares + shares : s.shares - shares;

  // Trades swap cash for shares, so the account total does not move.
  const weightAfter = total > 0 ? ((landing * s.price) / total) * 100 : 0;

  return {
    ...base,
    action,
    shares,
    amount,
    partial: action === 'BUY' && shares < delta,
    cashAfter,
    weightAfter,
    withinBand: weightAfter >= s.bandMin && weightAfter <= s.bandMax,
    isLot: landing % LOT === 0,
  };
}

/** Turns an accepted what-if into an executable trade. */
export function planToShares(p: Portfolio, s: Stock, targetShares: number): TradePlan | null {
  if (!isTradeable(s)) return null;
  const w = whatIf(p, s, targetShares);
  if (!w.action || w.shares <= 0) return null;

  return plan(
    s,
    w.action,
    w.shares,
    w.targetShares,
    w.partial,
    `${w.action === 'BUY' ? 'buy' : 'sell'} to a chosen holding of ${w.targetShares.toLocaleString(
      'en-US',
    )} shares`,
  );
}

/**
 * The model's own answer for this row: the nearest clean lot when its weight lands inside the
 * band, otherwise the raw share count.
 */
export function planToTarget(
  p: Portfolio,
  s: Stock,
  options: PlanOptions = {},
): TradePlan | null {
  if (!isTradeable(s) || s.price <= 0) return null;

  const lt = lotAwareTarget(p, s);
  return planToDestination(
    p,
    s,
    lt.goal,
    lt.isLot
      ? 'the lot-aware target, a clean lot'
      : 'the target, raw — no nearby lot fits inside the band',
    options,
  );
}
