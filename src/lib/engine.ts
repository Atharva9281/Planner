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

import { BuyMode, OffModelHolding, Portfolio, SellMode, Stock, TradePlan } from './types';

export const LOT = 100;

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

/* ------------------------------------------------------------------ */
/* the lot-aware target                                                */
/* ------------------------------------------------------------------ */

export interface LotAwareTarget {
  /** The exact, fractional share count the target weight implies. */
  raw: number;
  /** What to actually aim at: the nearest lot when it fits the band, else the rounded raw count. */
  goal: number;
  /** True when `goal` is that clean lot rather than a fallback. */
  isLot: boolean;
  lower: number;
  upper: number;
}

/**
 * The core check. Take the target weight, convert it to shares, and look at the nearest
 * multiple of 100. If that lot's resulting weight still lands inside the stock's own band, the
 * lot is the answer. If it does not, the raw count wins: the band is a mandate and a tidy share
 * count never justifies breaking it.
 */
export function lotAwareTarget(p: Portfolio, s: Stock): LotAwareTarget {
  const t = totalValue(p);
  const raw = s.price > 0 ? ((s.target / 100) * t) / s.price : 0;

  // A holding the lot rule does not apply to aims at the raw count and nothing else.
  if (!lotRounds(s)) {
    return { raw, goal: Math.round(raw), isLot: false, lower: s.bandMin, upper: s.bandMax };
  }

  const nearestLot = Math.round(raw / LOT) * LOT;
  const nearestLotPct = t > 0 ? ((nearestLot * s.price) / t) * 100 : 0;
  const isLot = nearestLotPct >= s.bandMin && nearestLotPct <= s.bandMax;

  return {
    raw,
    goal: isLot ? nearestLot : Math.round(raw),
    isLot,
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

/** The highest multiple of 100 that still sits at or below the band ceiling. */
export function highestLotWithinBand(p: Portfolio, s: Stock): {
  highestLot: number;
  rawCeilingShares: number;
} {
  const { maxShares } = bandShareLimits(p, s);
  return { highestLot: Math.floor(maxShares / LOT) * LOT, rawCeilingShares: maxShares };
}

/** The sell-side mirror: the lowest multiple of 100 that still sits at or above the band floor. */
export function lowestLotWithinBand(p: Portfolio, s: Stock): {
  lowestLot: number;
  rawFloorShares: number;
} {
  const { rawFloorShares } = bandShareLimits(p, s);
  return { lowestLot: Math.ceil(rawFloorShares / LOT) * LOT, rawFloorShares };
}

/* ------------------------------------------------------------------ */
/* status                                                              */
/* ------------------------------------------------------------------ */

export type MandatoryStatus = 'over' | 'under' | null;

/** A stock is mandatory the moment it is outside its own band in either direction. */
export function mandatoryStatus(p: Portfolio, s: Stock): MandatoryStatus {
  const w = weight(p, s);
  if (w > s.bandMax) return 'over';
  if (w < s.bandMin) return 'under';
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
 * This is worse than a missing figure on one row. Total account value is the denominator of every
 * weight and every band in dollars, and an unpriced holding contributes nothing to it — so the
 * total is understated and *every other position's* weight is overstated to match. One row
 * without a price quietly moves every number on the page, in a direction nothing on screen
 * explains.
 *
 * That is why the trade log will not export while this is non-empty: a spreadsheet leaves the
 * building and outlives the session that produced it, and it would carry percentages that are
 * wrong without saying so.
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

/** Whole shares the idle cash can pay for at this price. */
export function affordableShares(p: Portfolio, s: Stock): number {
  return s.price > 0 ? Math.floor(p.cash / s.price) : 0;
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

/**
 * Returns null when there is nothing to do: already at or above the goal, or not enough cash
 * for even one share. A buy is clamped by cash and reported as a partial fill.
 */
export function planBuy(p: Portfolio, s: Stock, mode: BuyMode): TradePlan | null {
  if (!isTradeable(s)) return null;
  let goal: number;
  let label: string;

  if (mode === 'target') {
    const lt = lotAwareTarget(p, s);
    goal = lt.goal;
    label = lt.isLot
      ? 'buy to lot-aware target (a clean lot)'
      : 'buy to target (raw, no nearby lot fit inside the band)';
  } else if (mode === 'highlot') {
    if (!lotRounds(s)) return null;
    goal = highestLotWithinBand(p, s).highestLot;
    label = "buy to the highest reachable lot before this stock's own ceiling";
  } else {
    const r = rawMaxBuy(p, s);
    if (r.maxBuy <= 0) return null;
    goal = s.shares + r.maxBuy;
    label = `buy the raw maximum, no lot preference, limited by ${
      r.limiter === 'band' ? 'its own band' : 'cash'
    }`;
  }

  const need = Math.max(goal - s.shares, 0);
  if (need <= 0) return null;

  const buy = Math.min(need, affordableShares(p, s));
  if (buy <= 0) return null;

  return plan(s, 'BUY', buy, goal, buy < need, label);
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

/** Returns null when the stock is already at or below the goal. */
export function planSell(p: Portfolio, s: Stock, mode: SellMode): TradePlan | null {
  if (!isTradeable(s)) return null;
  let goal: number;
  let label: string;

  if (mode === 'target') {
    const lt = lotAwareTarget(p, s);
    goal = lt.goal;
    label = lt.isLot
      ? 'sell to lot-aware target (a clean lot)'
      : 'sell to target (raw, no nearby lot fit inside the band)';
  } else if (mode === 'lowlot') {
    if (!lotRounds(s)) return null;
    goal = lowestLotWithinBand(p, s).lowestLot;
    label = "sell to the lowest reachable lot before this stock's own floor";
  } else {
    goal = rawMinSell(p, s).minShares;
    label =
      'sell down to the raw minimum, no lot preference, the fewest shares that stay inside the band';
  }

  const sell = Math.max(s.shares - goal, 0);
  if (sell <= 0) return null;

  return plan(s, 'SELL', sell, goal, false, label);
}
