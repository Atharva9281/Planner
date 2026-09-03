/** A stock in the model. `shares` is the live position, which trades move. */
export interface Stock {
  /** Stable identity. Holdings key off this, never off `sym`, so two rows can share a symbol
   *  without silently merging into one position. */
  id: string;
  sym: string;
  /**
   * The sleeve this row belongs to in the model export — "Stocks / ETFs Sleeve", "Fixed Income
   * Sleeve", "Cash and Equiv". Descriptive: it explains why a row is grouped as it is and why the
   * lot rule may be off, but no arithmetic reads it.
   */
  type?: string;
  price: number;
  /** Model weight, in percent of total account value. */
  target: number;
  /** Absolute band floor and ceiling, in percent. Not a ± around target: bands may be asymmetric. */
  bandMin: number;
  bandMax: number;
  shares: number;
  /**
   * Whether a trade may be offered on this row at all. False for fixed income and any asset class
   * the tool does not trade: the position is shown in full and counts toward account value, but
   * carries no buttons. Defaults to true.
   */
  tradeable?: boolean;
  /**
   * Whether the 100-share lot rule applies. False for mutual funds and anything else bought in
   * dollars with fractional shares, where a round lot has no meaning. Defaults to true.
   */
  lotRounding?: boolean;
}

/** Something held in the account but outside the model. Counts toward total account value,
 *  and therefore toward every band dollar figure, until it is sold. */
export interface OffModelHolding {
  id: string;
  sym: string;
  shares: number;
  price: number;
  /** False for fixed income and anything else the tool does not trade: counted, never sold here. */
  tradeable?: boolean;
}

export interface Portfolio {
  stocks: Stock[];
  cash: number;
  /**
   * Cash band, in percent of total account value. The model export gives all three: the USD CASH
   * row's Allocation % is the target and its drift columns the floor and ceiling. The target is
   * advisory like the band itself — it is shown, never traded against.
   */
  cashFloor: number;
  cashTarget: number;
  cashCeiling: number;
  offModel: OffModelHolding[];
}

export type TradeAction = 'BUY' | 'SELL';

/**
 * target  - the lot-aware model target: the nearest 100-share lot if its weight lands inside
 *           the band, otherwise the raw share count rounded to a whole share.
 * highlot - the highest multiple of 100 that still sits at or below the band ceiling.
 * lowlot  - the lowest multiple of 100 that still sits at or above the band floor.
 * rawmax  - no lot preference at all: as far as the band or the cash allows, odd numbers included.
 */
export type BuyMode = 'target' | 'highlot' | 'rawmax';
export type SellMode = 'target' | 'lowlot' | 'rawmax';

/** One executable trade, fully priced, before it is applied to the portfolio. */
export interface TradePlan {
  stockId: string;
  sym: string;
  action: TradeAction;
  shares: number;
  price: number;
  amount: number;
  /** The share count this trade was aiming at. */
  goalShares: number;
  resultShares: number;
  resultIsLot: boolean;
  /** True when cash ran out before the full amount could be bought. Sells are never partial. */
  partial: boolean;
  label: string;
}

export interface LogEntry {
  id: string;
  sym: string;
  action: TradeAction;
  source: 'model' | 'offModel';
  /** Null for off-model sales, which have no model row to reset. */
  stockId: string | null;
  shares: number;
  price: number;
  amount: number;
  goalShares: number | null;
  resultShares: number;
  resultIsLot: boolean;
  partial: boolean;
  label: string;
  cashBefore: number;
  cashAfter: number;
  /** Cash as a percent of total account value, before and after. The floor and ceiling
   *  crossings are derived from these at render time, against the current band. */
  pctBefore: number;
  pctAfter: number;
  /** The off-model holding this sale removed, kept whole so undo can restore it exactly. */
  restore?: OffModelHolding;
}

/** The starting position, held separately so "Reset this stock" has something honest to return to. */
export interface Baseline {
  /** Keyed by stock id. */
  shares: Record<string, number>;
  cash: number;
}

export interface ExplorerState {
  portfolio: Portfolio;
  baseline: Baseline;
  /**
   * What is loaded — an account name from an import, or the worked example. Shown in the header
   * so sample numbers are never mistaken for an account.
   *
   * `loadedAt` is when the files were read, as an ISO string so it survives being written to
   * storage and parsed back. It exists because the workspace now outlives the window: every
   * figure in the app derives from a price, those prices are frozen at the moment of export, and
   * without a date on screen a portfolio restored on Friday is indistinguishable from one loaded
   * this morning. Absent on the worked example, whose prices were never real.
   */
  source?: { kind: 'sample' | 'import' | 'manual'; label: string; loadedAt?: string };
  log: LogEntry[];
  /** Monotonic counter behind every generated id, so ids are deterministic and SSR-safe. */
  nextId: number;
}
