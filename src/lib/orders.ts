import { inDisplayOrder } from './engine';
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

  /* The same order the table upstairs lists them in. Two tables on one page disagreeing about
     where a position sits is a small thing that costs a real search every time. */
  for (const stock of inDisplayOrder(state.portfolio.stocks)) {
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

  /* Off-model holdings net the same way, against the starting position rather than the log,
     because a reset empties the log while these have to keep being reported. A holding missing
     from the live list is one an older version removed when it sold it whole. */
  const now = new Map(state.portfolio.offModel.map((h) => [h.id, h]));
  for (const opening of state.baseline.offModel ?? []) {
    const current = now.get(opening.id);
    const resulting = current?.shares ?? 0;
    const delta = resulting - opening.shares;
    if (delta === 0) continue;
    orders.push(offModelOrder(current ?? opening, opening.shares, resulting));
  }

  return orders;
}

const offModelOrder = (h: OffModelHolding, opening: number, resulting: number): Order => {
  const shares = Math.abs(resulting - opening);
  const amount = shares * h.price;
  const buy = resulting > opening;
  return {
    stockId: null,
    sym: h.sym,
    action: buy ? 'BUY' : 'SELL',
    shares,
    openingShares: opening,
    resultingShares: resulting,
    price: h.price,
    amount,
    cash: buy ? -amount : amount,
    source: 'offModel',
  };
};

export function orderSummary(state: ExplorerState): OrderSummary {
  return {
    orders: netOrders(state),
    cashBefore: state.baseline.cash,
    cashAfter: state.portfolio.cash,
    steps: state.log.length,
  };
}
