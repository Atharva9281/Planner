/**
 * State transitions. Every function takes the whole state and returns a new one; nothing here
 * mutates its argument, so undo is just "keep the previous value" and the log is the only
 * history that has to be maintained by hand.
 */

import { cashPct, offModelValue } from './engine';
import { baselineFrom, emptyState, sampleState } from './defaultState';
import { ExplorerState, LogEntry, OffModelHolding, Portfolio, Stock, TradePlan } from './types';

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

/** Applies a planned trade and records it. The plan already carries every number it needs. */
export function applyTrade(state: ExplorerState, plan: TradePlan): ExplorerState {
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
  };

  return { ...state, portfolio, log: [...state.log, entry], nextId: state.nextId + 1 };
}

/**
 * Sells an off-model holding in full. The whole holding is kept on the log entry so undo can put
 * it back exactly as it was, rather than reconstructing its price by dividing proceeds by shares.
 */
export function sellOffModel(state: ExplorerState, id: string): ExplorerState {
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
  };

  return { ...state, portfolio, log: [...state.log, entry], nextId: state.nextId + 1 };
}

/* ------------------------------------------------------------------ */
/* undo and reset                                                      */
/* ------------------------------------------------------------------ */

export function undoLast(state: ExplorerState): ExplorerState {
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

/** Throws the whole portfolio away and returns to the empty first screen. */
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
