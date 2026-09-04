import { ExplorerState, OffModelHolding, TradeAction } from './types';

/**
 * What actually has to be traded, as opposed to what was clicked to arrive at it.
 *
 * The table is an exploration surface: an advisor tries a lot, tries the raw maximum, changes
 * their mind, tries something else. Every one of those clicks used to become a row in a log that
 * was then exported as if it were an instruction — so a position bought and sold back to where it
 * started appeared as two trades that must not be placed, and a position bought in two steps
 * appeared as two orders when the desk needs one.
 *
 * So the report is a diff, not a history: where each position ended up against where it began.
 * Five clicks become two orders, and the one that was put back disappears entirely, because
 * there is nothing to trade about it. The clicks still exist behind the panel's toggle and still
 * drive undo; they are simply no longer what the app reports.
 */

export interface Order {
  /** The model row this order belongs to; null for an off-model holding sold out entirely. */
  stockId: string | null;
  sym: string;
  action: TradeAction;
  /** Always positive. The direction lives in `action`. */
  shares: number;
  /** Where the position stood when the files were loaded. */
  openingShares: number;
  /** Where it ends up: the opening count plus or minus the shares traded. */
  resultingShares: number;
  price: number;
  /** Price times shares. Always positive — this is the size of the trade, not its direction. */
  amount: number;
  /**
   * The same figure signed by what it does to the balance: negative when cash is spent on a buy,
   * positive when a sell raises it. Kept beside `amount` rather than replacing it because the two
   * answer different questions — how big is this trade, and which way does the money go.
   */
  cash: number;
  source: 'model' | 'offModel';
}

export interface OrderSummary {
  orders: Order[];
  cashBefore: number;
  cashAfter: number;
  /** How many clicks produced them, which is what the toggle is offering to show. */
  steps: number;
}

/**
 * Model rows first, in the order they appear in the table, then any off-model holding that was
 * sold out. Deliberately not sorted into sells-before-buys: the tool does not decide an order of
 * execution anywhere else, and a list that implies one would be claiming knowledge it lacks.
 */
export function netOrders(state: ExplorerState): Order[] {
  const orders: Order[] = [];

  for (const stock of state.portfolio.stocks) {
    const opening = state.baseline.shares[stock.id] ?? 0;
    const delta = stock.shares - opening;
    if (delta === 0) continue;

    const shares = Math.abs(delta);
    const amount = shares * stock.price;
    orders.push({
      stockId: stock.id,
      sym: stock.sym,
      action: delta > 0 ? 'BUY' : 'SELL',
      shares,
      openingShares: opening,
      resultingShares: stock.shares,
      price: stock.price,
      amount,
      cash: delta > 0 ? -amount : amount,
      source: 'model',
    });
  }

  /* An off-model holding leaves by being sold whole, so it is absent from the live list rather
     than changed. Comparing against the baseline finds it; the log cannot be used for this,
     because a reset empties the log while these have to keep being reported. */
  const held = new Set(state.portfolio.offModel.map((h) => h.id));
  for (const gone of state.baseline.offModel ?? []) {
    if (held.has(gone.id)) continue;
    orders.push(orderFromSoldHolding(gone));
  }

  return orders;
}

/** Sold whole, so it opens at whatever was held and ends at nothing. */
const orderFromSoldHolding = (h: OffModelHolding): Order => ({
  stockId: null,
  sym: h.sym,
  action: 'SELL',
  shares: h.shares,
  openingShares: h.shares,
  resultingShares: 0,
  price: h.price,
  amount: h.shares * h.price,
  cash: h.shares * h.price,
  source: 'offModel',
});

export function orderSummary(state: ExplorerState): OrderSummary {
  return {
    orders: netOrders(state),
    cashBefore: state.baseline.cash,
    cashAfter: state.portfolio.cash,
    steps: state.log.length,
  };
}
