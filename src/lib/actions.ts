/**
 * State transitions. Every function takes the whole state and returns a new one; nothing here
 * mutates its argument, so undo is just "keep the previous value" and the log is the only
 * history that has to be maintained by hand.
 */

import { cashPct, destinationShares, offModelValue, planToLot, planToTarget } from './engine';
import { baselineFrom, emptyState, sampleState } from './defaultState';
import { carryModel } from './import/carry';
import {
  Destination,
  ExplorerState,
  LogEntry,
  OffModelHolding,
  Portfolio,
  Stock,
  TradePlan,
} from './types';

const withPortfolio = (state: ExplorerState, portfolio: Portfolio): ExplorerState => ({
  ...state,
  portfolio,
});

const mapStock = (p: Portfolio, id: string, fn: (s: Stock) => Stock): Portfolio => ({
  ...p,
  stocks: p.stocks.map((s) => (s.id === id ? fn(s) : s)),
});

/* ------------------------------------------------------------------ */
/* trades                                                              */
/* ------------------------------------------------------------------ */

/**
 * Applies a planned trade and records it. The plan already carries every number it needs.
 *
 * `batch` marks trades that arrived together from one press of a universal button, so undo can
 * take the whole press back at once.
 */
export function applyTrade(
  state: ExplorerState,
  plan: TradePlan,
  batch?: string,
): ExplorerState {
  const before = state.portfolio;
  const cashBefore = before.cash;
  const pctBefore = cashPct(before);

  const portfolio = mapStock(
    {
      ...before,
      cash: plan.action === 'BUY' ? before.cash - plan.amount : before.cash + plan.amount,
    },
    plan.stockId,
    (s) => ({ ...s, shares: plan.resultShares }),
  );

  const entry: LogEntry = {
    id: `t${state.nextId}`,
    sym: plan.sym,
    action: plan.action,
    source: 'model',
    stockId: plan.stockId,
    shares: plan.shares,
    price: plan.price,
    amount: plan.amount,
    goalShares: plan.goalShares,
    resultShares: plan.resultShares,
    resultIsLot: plan.resultIsLot,
    partial: plan.partial,
    label: plan.label,
    cashBefore,
    cashAfter: portfolio.cash,
    pctBefore,
    pctAfter: cashPct(portfolio),
    ...(batch ? { batch } : {}),
  };

  return { ...state, portfolio, log: [...state.log, entry], nextId: state.nextId + 1 };
}

/**
 * Sells an off-model holding in full. The whole holding is kept on the log entry so undo can put
 * it back exactly as it was, rather than reconstructing its price by dividing proceeds by shares.
 */
export function sellOffModel(
  state: ExplorerState,
  id: string,
  /** Set when this sale is one of many from a single press, so undo takes them back together. */
  batch?: string,
): ExplorerState {
  const holding = state.portfolio.offModel.find((h) => h.id === id);
  // Fixed income is held and counted here, never traded, on either side of the model.
  if (!holding || holding.tradeable === false) return state;

  const before = state.portfolio;
  const cashBefore = before.cash;
  const pctBefore = cashPct(before);
  const proceeds = offModelValue(holding);

  const portfolio: Portfolio = {
    ...before,
    cash: before.cash + proceeds,
    offModel: before.offModel.filter((h) => h.id !== id),
  };

  const entry: LogEntry = {
    id: `t${state.nextId}`,
    sym: holding.sym,
    action: 'SELL',
    source: 'offModel',
    stockId: null,
    shares: holding.shares,
    price: holding.price,
    amount: proceeds,
    goalShares: null,
    resultShares: 0,
    resultIsLot: true,
    partial: false,
    label: 'not part of the model, sold entirely, proceeds added to cash',
    cashBefore,
    cashAfter: portfolio.cash,
    pctBefore,
    pctAfter: cashPct(portfolio),
    restore: holding,
    ...(batch ? { batch } : {}),
  };

  return { ...state, portfolio, log: [...state.log, entry], nextId: state.nextId + 1 };
}

/** What one press of "Sell all" on the off-model list did. */
export interface OffModelSale {
  /** Holdings sold. */
  sold: number;
  /** What they raised, added to cash. */
  proceeds: number;
  /** Fixed income and anything else held but never traded, which stays where it is. */
  heldNotTraded: number;
  batch: string;
}

/**
 * Sells every off-model holding that can be sold, in one press.
 *
 * A position the model has no row for is a position the advisor has decided not to hold: the
 * model is the mandate, and anything outside it is there by accident of history — a transfer in,
 * a legacy holding, something bought outside the sleeve. Selling it is the normal answer, and
 * making him do it one row at a time in a dialog buried under "Edit starting holdings" is what
 * kept the normal answer out of sight.
 *
 * Fixed income is passed over rather than sold. It is held and counted on either side of the
 * model, and this button does not become the one place that rule stops applying.
 *
 * Nothing here decides *whether* to sell. The press is the decision, and Undo takes the whole
 * press back at once.
 */
export function sellAllOffModel(
  state: ExplorerState,
): { state: ExplorerState; outcome: OffModelSale } {
  const batch = `b${state.nextId}`;
  const before = state.portfolio.cash;

  let next = state;
  let sold = 0;

  /* Read once off the list as it stands: `sellOffModel` removes the row it sells, so iterating
     the live array would skip every other holding. */
  for (const h of state.portfolio.offModel) {
    if (h.tradeable === false || offModelValue(h) === 0) continue;
    const after = sellOffModel(next, h.id, batch);
    if (after === next) continue;
    next = after;
    sold += 1;
  }

  return {
    state: next,
    outcome: {
      sold,
      proceeds: next.portfolio.cash - before,
      heldNotTraded: state.portfolio.offModel.filter((h) => h.tradeable === false).length,
      batch,
    },
  };
}

/* ------------------------------------------------------------------ */
/* one destination, every position                                     */
/* ------------------------------------------------------------------ */

/** What one press of a universal button did, in the terms the result line reports it. */
export interface BulkOutcome {
  destination: Destination;
  /** Positions that moved. */
  traded: number;
  /** Positions already sitting on the destination, so there was nothing to do. */
  settled: number;
  /** Positions this destination does not exist for: no lot rule, no price, or never traded here. */
  noDestination: number;
  /** Cash left afterwards. Negative is the amount the advisor still has to raise. */
  cashAfter: number;
  /** True when the buying took cash below its own floor, having started at or above it. */
  belowCashFloor: boolean;
  /** Ties the trades together, so the result line's Undo can tell it is still the last thing done. */
  batch: string;
}

/**
 * Takes every position to one named destination.
 *
 * Nothing here optimises, allocates, or funds. Each row is asked for the same column it already
 * shows and lands on it, in the order the table lists them.
 *
 * **The cash is allowed to go negative, and no buy is ever cut short to protect it.** An earlier
 * version ran the sells first so their proceeds could fund the buys, ordered the buys widest gap
 * first, and skipped any buy the remaining cash could not cover whole. That was the tool deciding
 * what to liquidate and in what order — which is the advisor's decision, not this program's. He
 * would rather see every position on its number and a cash line reading -$40,000, then choose for
 * himself what to sell and how much of it, than have the tool spend down to zero in an order it
 * invented and quietly leave three positions behind.
 *
 * With nothing competing for the cash, order stops mattering: a trade swaps cash for shares
 * without moving total account value, so no row's destination depends on what any other row did.
 * Table order is therefore the honest one, and every row that has somewhere to go, goes.
 *
 * Sells still happen — a position sitting above the destination comes down to it, because that is
 * where its own column points. What no longer happens is selling *because a different row needs
 * the money*.
 */
export function tradeAll(
  state: ExplorerState,
  destination: Destination,
): { state: ExplorerState; outcome: BulkOutcome } {
  const batch = `b${state.nextId}`;
  const startedInsideCashBand = cashPct(state.portfolio) >= state.portfolio.cashFloor;

  /* Never clamped to cash: that is the whole point of these buttons. */
  const plan = (p: Portfolio, s: Stock) =>
    destination === 'target'
      ? planToTarget(p, s, { clampToCash: false })
      : planToLot(p, s, destination === 'lot-high' ? 'high' : 'low', { clampToCash: false });

  /* Destinations are read once, off the portfolio as it stands. They do not move as trades land,
     so re-reading them mid-run would answer the same thing more slowly. */
  const rows = state.portfolio.stocks.map((s) => ({
    stock: s,
    goal: destinationShares(state.portfolio, s, destination),
  }));

  let next = state;
  let traded = 0;

  for (const row of rows) {
    if (row.goal === null || row.goal === row.stock.shares) continue;

    const live = next.portfolio.stocks.find((s) => s.id === row.stock.id);
    if (!live) continue;

    const trade = plan(next.portfolio, live);
    if (!trade) continue;

    next = applyTrade(next, trade, batch);
    traded += 1;
  }

  return {
    state: next,
    outcome: {
      destination,
      traded,
      settled: rows.filter((r) => r.goal !== null && r.goal === r.stock.shares).length,
      noDestination: rows.filter((r) => r.goal === null).length,
      cashAfter: next.portfolio.cash,
      belowCashFloor:
        startedInsideCashBand && cashPct(next.portfolio) < next.portfolio.cashFloor,
      batch,
    },
  };
}

/* ------------------------------------------------------------------ */
/* undo and reset                                                      */
/* ------------------------------------------------------------------ */

/**
 * Takes back the last thing that happened — where a press of a universal button counts as one
 * thing, however many positions it moved.
 *
 * A batch is always a contiguous run at the end of the log, because it is written in one go and
 * anything undone since has already come off the end.
 */
export function undoLast(state: ExplorerState): ExplorerState {
  const last = state.log[state.log.length - 1];
  if (!last) return state;
  if (!last.batch) return undoOne(state);

  let next = state;
  while (next.log[next.log.length - 1]?.batch === last.batch) next = undoOne(next);
  return next;
}

/** How many trades the next Undo would take back, so the button can say so. */
export function undoSize(state: ExplorerState): number {
  const last = state.log[state.log.length - 1];
  if (!last) return 0;
  if (!last.batch) return 1;
  return state.log.filter((e) => e.batch === last.batch).length;
}

function undoOne(state: ExplorerState): ExplorerState {
  if (state.log.length === 0) return state;

  const entry = state.log[state.log.length - 1];
  const log = state.log.slice(0, -1);
  const p = state.portfolio;

  if (entry.source === 'offModel') {
    return {
      ...state,
      portfolio: {
        ...p,
        cash: p.cash - entry.amount,
        offModel: entry.restore ? [...p.offModel, entry.restore] : p.offModel,
      },
      log,
    };
  }

  const portfolio = mapStock(
    {
      ...p,
      cash: entry.action === 'SELL' ? p.cash - entry.amount : p.cash + entry.amount,
    },
    entry.stockId!,
    (s) => ({
      ...s,
      shares: entry.action === 'SELL' ? s.shares + entry.shares : s.shares - entry.shares,
    }),
  );

  return { ...state, portfolio, log };
}

/**
 * Unwinds every model trade on one stock: its shares go back to the baseline, the cash those
 * trades moved is reversed, and their log entries are dropped. Off-model sales are never touched,
 * because they belong to no model row.
 */
export function resetStock(state: ExplorerState, stockId: string): ExplorerState {
  let cashAdjust = 0;
  const log: LogEntry[] = [];

  for (const e of state.log) {
    if (e.source === 'model' && e.stockId === stockId) {
      cashAdjust += e.action === 'SELL' ? -e.amount : e.amount;
    } else {
      log.push(e);
    }
  }

  const portfolio = mapStock(
    { ...state.portfolio, cash: state.portfolio.cash + cashAdjust },
    stockId,
    (s) => ({ ...s, shares: state.baseline.shares[stockId] ?? 0 }),
  );

  return { ...state, portfolio, log };
}

/**
 * Undoes every trade and returns each holding to its starting share count, keeping the model —
 * prices, targets, bands — exactly as the advisor has it. "Starting state" means the position
 * they set up, not a set of demo numbers they never chose.
 */
export function resetAll(state: ExplorerState): ExplorerState {
  return {
    ...state,
    portfolio: {
      ...state.portfolio,
      cash: state.baseline.cash,
      stocks: state.portfolio.stocks.map((s) => ({
        ...s,
        shares: state.baseline.shares[s.id] ?? 0,
      })),
      /* Sold off-model holdings come back too. Restoring the cash without them took the sale
         proceeds away and left nothing in their place, so the account lost that value outright
         with no trade behind it — a reset is meant to undo work, not destroy it.
         `?? current` covers a workspace saved before the baseline recorded them. */
      offModel: state.baseline.offModel
        ? state.baseline.offModel.map((h) => ({ ...h }))
        : state.portfolio.offModel,
    },
    log: [],
  };
}

/** Replaces everything with the worked example. */
export function loadSample(): ExplorerState {
  return sampleState();
}

/**
 * Closes the account and keeps its model for the next one.
 *
 * Every share count, price, trade and cash balance belonged to the account being closed and goes
 * with it. Only the mandate survives, because the same mandate routinely covers several accounts.
 */
export function closeAccount(state: ExplorerState): ExplorerState {
  return { ...emptyState(), carried: carryModel(state) };
}

/**
 * Throws everything away, the model included, and returns to the empty first screen.
 *
 * The deliberate start-over: what "Start over with both files" and "Clear the whole portfolio"
 * do. Distinct from `closeAccount`, which is the ordinary move from one account to the next.
 */
export function clearAll(): ExplorerState {
  return emptyState();
}

/* ------------------------------------------------------------------ */
/* edits                                                               */
/*                                                                     */
/* Editing a share count or the cash balance is editing the starting    */
/* position, so it moves the baseline too. Editing a price, target or   */
/* band does not: those describe the model, not the position.           */
/* ------------------------------------------------------------------ */

export function setStockField(
  state: ExplorerState,
  id: string,
  field: 'sym' | 'type' | 'price' | 'target' | 'bandMin' | 'bandMax',
  value: string | number,
): ExplorerState {
  return withPortfolio(
    state,
    mapStock(state.portfolio, id, (s) =>
      field === 'sym'
        ? { ...s, sym: String(value).toUpperCase() }
        : // A sleeve name is prose, so it keeps the casing the export gave it.
          field === 'type'
          ? { ...s, type: String(value) }
          : { ...s, [field]: Number(value) || 0 },
    ),
  );
}

export function setStockShares(state: ExplorerState, id: string, value: number): ExplorerState {
  const shares = Number(value) || 0;
  return {
    ...state,
    portfolio: mapStock(state.portfolio, id, (s) => ({ ...s, shares })),
    baseline: { ...state.baseline, shares: { ...state.baseline.shares, [id]: shares } },
  };
}

export function setCash(state: ExplorerState, value: number): ExplorerState {
  const cash = Number(value) || 0;
  return {
    ...state,
    portfolio: { ...state.portfolio, cash },
    baseline: { ...state.baseline, cash },
  };
}

export function setCashBand(
  state: ExplorerState,
  field: 'cashFloor' | 'cashTarget' | 'cashCeiling',
  value: number,
): ExplorerState {
  return withPortfolio(state, { ...state.portfolio, [field]: Number(value) || 0 });
}

export function addStock(state: ExplorerState): ExplorerState {
  const id = `s${state.nextId}`;
  const stock: Stock = { id, sym: 'NEW', price: 100, target: 5, bandMin: 3, bandMax: 7, shares: 0 };
  return {
    ...state,
    portfolio: { ...state.portfolio, stocks: [...state.portfolio.stocks, stock] },
    baseline: { ...state.baseline, shares: { ...state.baseline.shares, [id]: 0 } },
    nextId: state.nextId + 1,
  };
}

/** Removing a stock also drops its trades from the log, since there is no row left to reset. */
export function removeStock(state: ExplorerState, id: string): ExplorerState {
  const { [id]: _removed, ...shares } = state.baseline.shares;
  void _removed;
  return {
    ...state,
    portfolio: { ...state.portfolio, stocks: state.portfolio.stocks.filter((s) => s.id !== id) },
    baseline: { ...state.baseline, shares },
    log: state.log.filter((e) => e.stockId !== id),
  };
}

/**
 * Adding or editing an off-model holding describes the starting position, exactly as editing a
 * share count does, so it moves the baseline with it.
 *
 * Without this the baseline says the account never held the thing, and selling a holding entered
 * by hand produces no order at all — the cash moves and nothing explains why.
 */
const withBaselineOffModel = (state: ExplorerState, offModel: OffModelHolding[]): ExplorerState => ({
  ...state,
  portfolio: { ...state.portfolio, offModel },
  baseline: { ...state.baseline, offModel: offModel.map((h) => ({ ...h })) },
});

export function addOffModel(state: ExplorerState): ExplorerState {
  const holding: OffModelHolding = {
    id: `o${state.nextId}`,
    sym: 'OTHER',
    shares: 0,
    price: 100,
  };
  return {
    ...withBaselineOffModel(state, [...state.portfolio.offModel, holding]),
    nextId: state.nextId + 1,
  };
}

export function setOffModelField(
  state: ExplorerState,
  id: string,
  field: 'sym' | 'shares' | 'price',
  value: string | number,
): ExplorerState {
  return withBaselineOffModel(
    state,
    state.portfolio.offModel.map((h) =>
      h.id !== id
        ? h
        : field === 'sym'
          ? { ...h, sym: String(value).toUpperCase() }
          : { ...h, [field]: Number(value) || 0 },
    ),
  );
}

/**
 * Drops an off-model row outright, but only one that is worth nothing — a blank row added by
 * mistake, or one already at zero shares.
 *
 * Deleting a holding that carries value would take that value out of the account with no sale
 * behind it, which moves total account value and therefore every band in dollars, with nothing on
 * the log to say why. Holdings worth something leave through `sellOffModel` instead, which turns
 * them into the same number of dollars and leaves the total where it was.
 */
export function removeOffModel(state: ExplorerState, id: string): ExplorerState {
  const holding = state.portfolio.offModel.find((h) => h.id === id);
  if (!holding || offModelValue(holding) !== 0) return state;

  // Worth nothing, so it leaves the starting position too rather than lingering there as a row a
  // reset would resurrect.
  return withBaselineOffModel(
    state,
    state.portfolio.offModel.filter((h) => h.id !== id),
  );
}

/** Re-snapshots the baseline from the live portfolio. Used after a bulk edit of starting holdings. */
export function rebaseline(state: ExplorerState): ExplorerState {
  return { ...state, baseline: baselineFrom(state.portfolio) };
}
