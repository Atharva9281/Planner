/** A sheet reduced to a grid of raw cell values. Rows are ragged; missing cells are undefined. */
export interface SheetGrid {
  name: string;
  rows: (string | number | null | undefined)[][];
}

/** One line of a model: what to hold and the band it must stay inside. */
export interface ModelRow {
  sym: string;
  /** Present in the export but only used to spot the cash row and the fund sleeves. */
  type?: string;
  cusip?: string;
  target: number;
  bandMin: number;
  bandMax: number;
  /**
   * Set only on a model carried over from an account that was already loaded, where both flags
   * were settled at that import and may since have been edited by hand.
   *
   * A file-read model leaves them undefined and the asset class decides, as it always has.
   * Re-deriving them here would read a Type string the advisor is free to change, and silently
   * turn a hold-only sleeve back into something the tool will trade.
   */
  tradeable?: boolean;
  lotRounding?: boolean;
}

export interface ParsedModel {
  name: string;
  rows: ModelRow[];
  /** Taken from the model's own cash row, when it has one. */
  cashBand?: { target: number; floor: number; ceiling: number };
}

/**
 * A model kept aside when an account was closed, so the next account can be opened against it.
 *
 * The same model routinely covers several accounts, and re-uploading the same export for each of
 * them is work the advisor should not have to repeat. What is kept is the model *as it stood on
 * screen*, hand edits included — the mandate he is actually working to, not the file it started
 * as.
 */
export interface CarriedModel {
  model: ParsedModel;
  /**
   * What each symbol was priced at in the account just closed, by symbol.
   *
   * Prices are still market data, never invented: this is the same security at the price a real
   * custodian export gave it. It seeds the preview's price fields so a model row the next account
   * does not hold arrives with a figure the advisor can accept or overwrite, rather than as one
   * more empty box in a column of twenty.
   */
  prices: Record<string, number>;
  /** The account it was carried from, named so the advisor can see what he is reusing. */
  from: string;
}

/** A position read from a holdings export. Option rows never become one. */
export interface HoldingRow {
  sym: string;
  description?: string;
  assetClass?: string;
  shares: number;
  price: number;
  /** False for fixed income and any class this tool does not trade: shown and counted, never sold. */
  tradeable: boolean;
}

export interface ParsedHoldings {
  accountName?: string;
  accountNumber?: string;
  positions: HoldingRow[];
  /** The Cash and Equiv row's Quantity. Zero when the file has no such row. */
  cash: number;
  /** False when no cash row was found, which is a warning rather than a zero balance. */
  cashFound: boolean;
}

export interface ParsedImport {
  models: ParsedModel[];
  holdings?: ParsedHoldings;
  /** Per-sheet account of what was recognised, shown in the preview so nothing is silent. */
  sheets: { name: string; read: 'model' | 'holdings' | 'skipped'; rows: number }[];
  warnings: string[];
}

/**
 * The decisions the files themselves cannot settle.
 *
 * Options are dropped outright and the lot rule follows the asset class, so neither is asked
 * about. What remains is everything the two exports genuinely cannot supply: a price for a
 * position the account does not hold, and a balance for an account whose file carries none.
 * Both are unavoidable when the advisor is opening a new account, where the model describes
 * what to buy and the holdings file has nothing to price it with.
 */
export interface Resolution {
  modelName?: string;
  /**
   * Prices typed in the preview, by symbol, for model rows the holdings file cannot price.
   * Never consulted for a held position: market data in the file always wins over a typed figure.
   */
  prices?: Record<string, number>;
  /** Opening cash typed in the preview, used only when the files carry no Cash and Equiv row. */
  cash?: number;
}
