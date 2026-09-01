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
}

export interface ParsedModel {
  name: string;
  rows: ModelRow[];
  /** Taken from the model's own cash row, when it has one. */
  cashBand?: { target: number; floor: number; ceiling: number };
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
 * There is only one left. Cash comes from the Cash and Equiv row, options are dropped outright,
 * prices come from the holdings file, and the lot rule follows the asset class — none of which
 * the advisor has to arbitrate any more.
 */
export interface Resolution {
  modelName?: string;
  /** Held symbols outside the model: keep as an off-model holding, or drop. */
  keepOffModel: boolean;
}
