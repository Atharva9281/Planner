/**
 * The ranked deployment run, in its pure parts: which positions the run touches, where each stage
 * points them, and how far the cash is allowed to fall.
 *
 * The sequencing itself lives in `actions.ts`, because it applies trades and the cash moves as it
 * goes. Everything here is a question that can be answered about a portfolio standing still.
 *
 * The run exists because the account it was built for holds 30% cash against a 6-10% band, and
 * "put this to work" is not one decision — it is one mandatory decision followed by a series of
 * discretionary ones taken in an order only the advisor can supply. So the run does the first part
 * exactly and then spends what is left strictly down his order of conviction.
 */

import {
  bandShareLimits,
  cashPct,
  highestLotWithinBand,
  isTradeable,
  lotAwareTarget,
  lotRounds,
  lowestLotWithinBand,
  totalValue,
} from './engine';
import { Portfolio, Stock } from './types';

/**
 * How far below its own floor the cash may be taken, in percentage points of the account.
 *
 * The CFP's number, and the only slack in the run: the last buy that fits is usually the one that
 * lands cash a fraction under the floor, and refusing it leaves a whole position short to protect
 * a line by four hundredths. Deliberately not `LOT_BAND_TOLERANCE` — that one is about a lot
 * missing a band edge, this one is about how much of a cash mandate he is willing to spend
 * through, and the two have no reason to move together.
 */
export const CASH_FLEX = 0.5;

/**
 * The four places a position can be sent, in the order the run sends them.
 *
 *   floor     the band floor. Every position, ranked or not. The mandate, not a preference.
 *   lot-low   the lowest round lot the band admits. Ranked positions only.
 *   target    the lot-aware target — the model's own answer for the row.
 *   lot-high  the highest round lot the band admits. Where the cash stretches that far.
 *
 * `floor` is the only stage that is not discretionary, which is why it is the only one the cash
 * limit does not govern.
 */
export type Stage = 'floor' | 'lot-low' | 'target' | 'lot-high';

export const STAGES: readonly Stage[] = ['floor', 'lot-low', 'target', 'lot-high'];

/** The discretionary stages, in the order the run works through them. */
export const RANKED_STAGES: readonly Stage[] = ['lot-low', 'target', 'lot-high'];

/**
 * Where one stage points this position, or null where the stage has nothing to say about it.
 *
 * The two lot stages fall back to the band edge itself on a row the 100-share rule does not apply
 * to. That is the same substitution `highestLotWithinBand` already makes when no lot fits inside a
 * band, and it is made here for the same reason: a stage named for the top of the range must not
 * quietly point below it. Without the fallback a bond fund ranked first could never be taken past
 * its target, because the stage that exists to do it would have no answer for the row.
 */
export function stageShares(p: Portfolio, s: Stock, stage: Stage): number | null {
  if (!isTradeable(s) || s.price <= 0) return null;

  const { minShares, maxShares } = bandShareLimits(p, s);

  if (stage === 'floor') return minShares;
  if (stage === 'target') return lotAwareTarget(p, s).goal;
  if (stage === 'lot-low') return lotRounds(s) ? lowestLotWithinBand(p, s).lowestLot : minShares;
  return lotRounds(s) ? highestLotWithinBand(p, s).highestLot : maxShares;
}

/* ------------------------------------------------------------------ */
/* the order                                                           */
/* ------------------------------------------------------------------ */

/** Unranked is 0, whether the field is absent, zero, or something that is not a positive number. */
export const rankOf = (s: Stock): number =>
  Number.isFinite(s.rank) && (s.rank as number) > 0 ? (s.rank as number) : 0;

export const isRanked = (s: Stock): boolean => rankOf(s) > 0;

/**
 * The ranked positions, best first.
 *
 * Stable, so two rows given the same rank keep the order the model listed them in rather than
 * swapping places between runs — the advisor is comparing one ordering against another, and a
 * comparison that moves on its own is worth nothing.
 */
export function inRankOrder(stocks: Stock[]): Stock[] {
  return stocks.filter(isRanked).sort((a, b) => rankOf(a) - rankOf(b));
}

/* ------------------------------------------------------------------ */
/* how far the cash may fall                                           */
/* ------------------------------------------------------------------ */

/**
 * Where the run stops spending.
 *
 *   floor    down to the cash floor less `CASH_FLEX`. Every dollar the mandate allows is deployed.
 *   ceiling  down to the cash ceiling, which is the least that brings cash inside its band.
 *
 * Two stopping points rather than a free number, because this is the one decision in the run that
 * is not about a stock: either the cash is brought inside its band and left there, or it is spent
 * through to the far edge of it. Which of those he wants is his to say; that it is one of the two
 * is what the band means.
 */
export type StopAt = 'floor' | 'ceiling';

/** The balance, in dollars, the run may not take cash below. */
export function cashLimit(p: Portfolio, stopAt: StopAt): number {
  const pct = stopAt === 'ceiling' ? p.cashCeiling : p.cashFloor - CASH_FLEX;
  return (Math.max(pct, 0) / 100) * totalValue(p);
}

/**
 * Whether a buy of this size still leaves the cash where the run is allowed to leave it.
 *
 * A sell is always allowed: it raises cash, and no stopping point is a floor on how much of it
 * there may be.
 *
 * The boundary is inclusive, and inclusive by a millionth of a dollar rather than exactly. The
 * buy that spends the account down to precisely the limit is the one the run most wants to make —
 * it is what "deploy the cash" means — and both sides of the comparison are six-figure sums
 * reached by multiplying a share price by a share count. Compared exactly, that buy is refused
 * whenever the last bit of the mantissa falls the wrong way, which is not a rule anyone could
 * predict from the numbers on screen.
 */
export function withinCashLimit(p: Portfolio, spend: number, stopAt: StopAt): boolean {
  if (spend <= 0) return true;
  return p.cash - spend >= cashLimit(p, stopAt) - 1e-6;
}

/* ------------------------------------------------------------------ */
/* whether the run can start at all                                    */
/* ------------------------------------------------------------------ */

/**
 * Why the run cannot be made, in the words it is refused with. Empty means it can.
 *
 * Prices are the whole of it. Every stage converts a percentage of the account into a share count,
 * so one unpriced row is two separate failures at once: that row has no destination, and total
 * account value is short by whatever it holds — which moves the floor, the target and the ceiling
 * of every *other* position, and therefore every trade the run makes. A run that skipped the row
 * quietly would produce a plausible-looking sheet of orders that are all slightly wrong.
 *
 * It is every model row and not only the ranked ones, because the second stage takes every
 * position to its floor. The same five rows already block the Excel export for the same reason, so
 * this asks for nothing that was not needed anyway.
 */
export function runBlockers(p: Portfolio): string[] {
  const unpriced = p.stocks.filter((s) => isTradeable(s) && s.price <= 0);
  if (unpriced.length === 0) return [];

  return [
    `${unpriced.length} position${unpriced.length === 1 ? '' : 's'} without a price (${unpriced
      .map((s) => s.sym)
      .join(', ')}). Every stage turns a percentage of the account into a share count, and an ` +
      'unpriced holding is missing from the account total, so every other position would be ' +
      'traded against a total that is short.',
  ];
}

/** True when the cash is already at or below where this run would stop. */
export const alreadyDeployed = (p: Portfolio, stopAt: StopAt): boolean =>
  p.cash <= cashLimit(p, stopAt);

/**
 * What the unranked positions could still absorb, in dollars, if they were ranked.
 *
 * The run parks them on their band floor and never returns, so this is the room the advisor has
 * chosen not to use — and on this account it dwarfs the cash left over. Stating it turns "rank
 * more of them" from advice into an arithmetic fact: here is the money, and here is where it could
 * go inside the mandate.
 *
 * Measured to each position's highest lot, which is as far as the run would ever take it.
 */
export function unrankedHeadroom(p: Portfolio): number {
  let room = 0;
  for (const s of p.stocks) {
    if (isRanked(s)) continue;
    const goal = stageShares(p, s, 'lot-high');
    if (goal === null) continue;
    room += Math.max(goal - s.shares, 0) * s.price;
  }
  return room;
}

/** The cash percentage the run is aiming at, for reporting what it did against what it wanted. */
export const cashTargetPct = (p: Portfolio, stopAt: StopAt): number =>
  stopAt === 'ceiling' ? p.cashCeiling : Math.max(p.cashFloor - CASH_FLEX, 0);

/** Where cash actually ended up, as a percentage. Named so the outcome reads the same as the sheet. */
export const cashReachedPct = cashPct;
