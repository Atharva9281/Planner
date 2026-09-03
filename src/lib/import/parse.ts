import { readWorkbook } from './workbook';
import {
  HoldingRow,
  ModelRow,
  ParsedHoldings,
  ParsedImport,
  ParsedModel,
  SheetGrid,
} from './types';

/**
 * Turns a custodian export into the shapes this tool understands.
 *
 * Headers are matched loosely, because no two exports agree on wording, but nothing is guessed:
 * where the file is genuinely ambiguous — which cash figure is spendable, what a fund's price is
 * — the ambiguity is carried out to the preview for the advisor to settle.
 */

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** Accepts "1,234.50", "$1,234.50", "12%", "(500)" and bare numbers. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = text(v);
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw);
  const bare = raw.replace(/[()$\s%,]/g, '');
  if (!bare || !/^-?\d*\.?\d+$/.test(bare)) return null;

  const n = Number(bare);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const norm = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds the header row and maps each known field to its column index. */
function findHeaders(
  rows: SheetGrid['rows'],
  fields: Record<string, string[]>,
  minMatches: number,
): { headerIndex: number; columns: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const columns: Record<string, number> = {};

    rows[i]?.forEach((cell, idx) => {
      const n = norm(cell);
      if (!n) return;
      for (const [field, names] of Object.entries(fields)) {
        if (field in columns) continue;
        if (names.some((name) => n === name || n.startsWith(name))) columns[field] = idx;
      }
    });

    if (Object.keys(columns).length >= minMatches) return { headerIndex: i, columns };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* model export                                                        */
/* ------------------------------------------------------------------ */

const MODEL_FIELDS = {
  modelName: ['modelname'],
  sym: ['symbol', 'ticker', 'security'],
  cusip: ['cusip'],
  type: ['type', 'assetclass', 'sleeve'],
  target: ['allocation', 'target', 'weight'],
  bandMin: ['mindrift', 'minband', 'floor', 'lowerband', 'min'],
  bandMax: ['maxdrift', 'maxband', 'ceiling', 'upperband', 'max'],
};

const isCashRow = (sym: string, type: string) =>
  /^(usd\s*cash|cash)$/i.test(sym.trim()) || /^cash( and equiv)?/i.test(type.trim());

function readModelSheet(sheet: SheetGrid, warnings: string[]): ParsedModel[] {
  const found = findHeaders(sheet.rows, MODEL_FIELDS, 3);
  if (!found || !('target' in found.columns) || !('sym' in found.columns)) return [];

  const { headerIndex, columns } = found;
  const at = (row: SheetGrid['rows'][number], field: string) =>
    field in columns ? row[columns[field]] : undefined;

  // One export may carry several models, so rows are grouped by name.
  const byModel = new Map<string, ParsedModel>();

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    if (!row) continue;

    const sym = text(at(row, 'sym')).toUpperCase();
    const target = num(at(row, 'target'));
    if (!sym || target === null) continue;

    const name = text(at(row, 'modelName')) || sheet.name;
    let model = byModel.get(name);
    if (!model) {
      model = { name, rows: [] };
      byModel.set(name, model);
    }

    const type = text(at(row, 'type'));
    const bandMin = num(at(row, 'bandMin'));
    const bandMax = num(at(row, 'bandMax'));

    if (isCashRow(sym, type)) {
      model.cashBand = {
        target,
        floor: bandMin ?? target,
        ceiling: bandMax ?? target,
      };
      continue;
    }

    if (bandMin === null || bandMax === null) {
      warnings.push(`${sym} has no drift band in the model, so its target is used for both edges.`);
    }

    model.rows.push({
      sym,
      type: type || undefined,
      cusip: text(at(row, 'cusip')) || undefined,
      target,
      bandMin: bandMin ?? target,
      bandMax: bandMax ?? target,
    });
  }

  return [...byModel.values()].filter((m) => m.rows.length > 0);
}

/* ------------------------------------------------------------------ */
/* holdings export                                                     */
/* ------------------------------------------------------------------ */

const HOLDING_FIELDS = {
  sym: ['symbolcusipid', 'symbol', 'ticker', 'security'],
  description: ['descriptionfund', 'description', 'name'],
  assetClass: ['assetclass', 'class', 'securitytype'],
  shares: ['quantity', 'shares', 'qty', 'units'],
  price: ['pricenav', 'price', 'nav', 'lastprice', 'marketprice'],
};

/**
 * What the Asset Class column says a row is. Everything downstream follows from this one call:
 * the cash balance, which rows become positions, and which of those may be traded.
 *
 *   cash      the account's spendable balance, taken from its Quantity
 *   tradeable stocks, ETFs and index funds — the only rows a trade is ever offered on
 *   holdOnly  fixed income, and anything unrecognised: counted and shown, never traded
 *   option    dropped entirely; not a position, not a holding, not part of account value
 *
 * An unfamiliar asset class lands in `holdOnly` on purpose. Showing an unknown row without trade
 * buttons is recoverable; offering to trade something the model never classified is not.
 */
export type RowKind = 'cash' | 'tradeable' | 'holdOnly' | 'option';

export function classify(assetClass: string): RowKind {
  const a = assetClass.trim().toLowerCase();
  if (/option/.test(a)) return 'option';
  if (/^cash/.test(a)) return 'cash';
  if (/stock|etf/.test(a)) return 'tradeable';
  if (/^index/.test(a)) return 'tradeable';
  return 'holdOnly';
}

/** Account identity is the only thing read above the table; the cash figures there are ignored. */
const ACCOUNT_NAME = /^account\s*name$/i;
const ACCOUNT_NUMBER = /^(account\s*(number|no\.?|#)|number)$/i;

function readHoldingsSheet(sheet: SheetGrid, warnings: string[]): ParsedHoldings | null {
  const found = findHeaders(sheet.rows, HOLDING_FIELDS, 3);
  if (!found || !('shares' in found.columns)) return null;

  const { headerIndex, columns } = found;
  const at = (row: SheetGrid['rows'][number], field: string) =>
    field in columns ? row[columns[field]] : undefined;

  /* --- the preamble, for identity only ---

     The five cash figures above the table disagree with each other and with the table itself, and
     one of them is negative in two of the three real exports. The Cash and Equiv row below is the
     balance this tool deploys, so nothing up here is read as money. */

  let accountName: string | undefined;
  let accountNumber: string | undefined;

  for (let i = 0; i < headerIndex; i++) {
    const label = text(sheet.rows[i]?.[0]);
    if (!label) continue;
    const value = text(sheet.rows[i]?.[1]);
    if (ACCOUNT_NAME.test(label)) accountName = value;
    else if (ACCOUNT_NUMBER.test(label)) accountNumber = value;
  }

  /* --- the table --- */

  const positions: HoldingRow[] = [];
  let cash = 0;
  let cashFound = false;
  let optionsDropped = 0;
  const unknownClasses = new Set<string>();

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    if (!row) continue;

    const sym = text(at(row, 'sym')).toUpperCase();
    if (!sym || /^(total|totals|subtotal|grand total)$/i.test(sym)) continue;

    const assetClass = text(at(row, 'assetClass'));
    const kind = classify(assetClass);

    if (kind === 'option') {
      optionsDropped++;
      continue;
    }

    const shares = num(at(row, 'shares'));

    if (kind === 'cash') {
      // The balance is the Quantity, not a market value: a cash row is priced at 1 by definition.
      if (shares !== null) {
        cash += shares;
        cashFound = true;
      }
      continue;
    }

    const price = num(at(row, 'price'));
    if (shares === null || price === null) {
      warnings.push(`Skipped ${sym}: it has no usable share count or price.`);
      continue;
    }
    if (shares === 0) continue;

    if (kind === 'holdOnly' && !/fixed income/i.test(assetClass)) unknownClasses.add(assetClass);

    positions.push({
      sym,
      description: text(at(row, 'description')) || undefined,
      assetClass: assetClass || undefined,
      shares,
      price,
      tradeable: kind === 'tradeable',
    });
  }

  if (!cashFound) {
    warnings.push(
      'No "Cash and Equiv" row was found in the holdings file, so cash starts at $0. Set it under Edit starting holdings.',
    );
  }
  if (optionsDropped > 0) {
    warnings.push(
      `${optionsDropped} option row${optionsDropped === 1 ? '' : 's'} ignored. Options are not traded here and do not count toward account value.`,
    );
  }
  for (const cls of unknownClasses) {
    warnings.push(`"${cls}" is not a class this tool trades, so those rows are held and shown only.`);
  }

  return { accountName, accountNumber, positions, cash, cashFound };
}

/* ------------------------------------------------------------------ */

/**
 * The whole parse, over grids that have already been read off disk. Split from `parseFiles` so
 * the recognition rules can be tested without a browser to unzip a workbook.
 */
export function parseSheets(sheets: SheetGrid[], into?: ParsedImport): ParsedImport {
  const result: ParsedImport = into ?? { models: [], sheets: [], warnings: [] };

  {
    for (const sheet of sheets) {
      // Holdings are tried first: that sheet has a Quantity column, which a model never does.
      const holdings = readHoldingsSheet(sheet, result.warnings);
      /*
       * A cash balance is enough to make this a holdings sheet.
       *
       * A new account that has been funded but not yet invested has a Cash and Equiv row and no
       * positions at all. Requiring a position here dropped that sheet — and the balance on it —
       * and did so silently, because the parse above had already succeeded and set `cashFound`.
       * Opening an account is ordinary work, so an empty one has to survive the read.
       */
      if (holdings && (holdings.positions.length > 0 || holdings.cashFound)) {
        if (result.holdings) {
          result.warnings.push(
            `More than one holdings sheet was found. "${sheet.name}" was used; this tool covers one account at a time.`,
          );
        } else {
          result.holdings = holdings;
        }
        result.sheets.push({ name: sheet.name, read: 'holdings', rows: holdings.positions.length });
        continue;
      }

      const models = readModelSheet(sheet, result.warnings);
      if (models.length > 0) {
        result.models.push(...models);
        result.sheets.push({
          name: sheet.name,
          read: 'model',
          rows: models.reduce((n, m) => n + m.rows.length, 0),
        });
        continue;
      }

      result.sheets.push({ name: sheet.name, read: 'skipped', rows: 0 });
    }
  }

  return result;
}

export async function parseFiles(files: File[]): Promise<ParsedImport> {
  const result: ParsedImport = { models: [], sheets: [], warnings: [] };

  for (const file of files) {
    try {
      parseSheets(await readWorkbook(file), result);
    } catch (err) {
      result.warnings.push(
        `${file.name} could not be read. ${err instanceof Error ? err.message : ''}`.trim(),
      );
    }
  }

  if (result.models.length === 0 && !result.holdings) {
    result.warnings.push(
      'Nothing recognisable was found. A model needs a Symbol and Allocation % column; holdings need a Symbol and Quantity column.',
    );
  }

  return result;
}

/** Model positions the account does not hold, and so which carry no price anywhere. */
export function unpricedSymbols(model: ParsedModel, holdings?: ParsedHoldings): string[] {
  const held = new Set((holdings?.positions ?? []).map((p) => p.sym));
  return model.rows.filter((r) => !held.has(r.sym)).map((r) => r.sym);
}

/** Held positions with no row in the model. */
export function offModelSymbols(model: ParsedModel, holdings?: ParsedHoldings): HoldingRow[] {
  const inModel = new Set(model.rows.map((r) => r.sym));
  return (holdings?.positions ?? []).filter((p) => !inModel.has(p.sym));
}

/**
 * Rows a lot rule cannot sensibly apply to. Mutual funds trade in dollars with fractional
 * shares, so rounding them to 100 is meaningless — flagged rather than assumed.
 */
export function likelyFunds(model: ParsedModel): ModelRow[] {
  return model.rows.filter(
    (r) => /^[A-Z]{5}X$/.test(r.sym) || /fixed income|bond|fund/i.test(r.type ?? ''),
  );
}
