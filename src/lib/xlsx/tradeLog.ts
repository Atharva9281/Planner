import { cashPct, totalValue } from '../engine';
import { LogEntry, Portfolio } from '../types';
import { Cell, SheetSpec } from './write';

/**
 * The trade log as a spreadsheet, in the same order and with the same columns as the panel on
 * screen: oldest first, opening balance on top, cash carried down the column.
 *
 * Every figure is written as a number with a format, never as pre-formatted text, so the columns
 * sort and sum in Excel. That is the whole reason for exporting a workbook rather than a picture
 * of one.
 */

export const TRADE_LOG_HEADERS = [
  '#',
  'Action',
  'Symbol',
  'Shares',
  'Price',
  'Amount',
  'Ends at',
  'Clean lot',
  'Cash after',
  'Cash %',
  'Note',
] as const;

const COLUMN_WIDTHS = [5, 9, 10, 11, 12, 14, 10, 10, 14, 9, 62];

const text = (value: string): Cell => ({ value, format: 'text' });
const num = (value: number): Cell => ({ value, format: 'number' });
const money = (value: number): Cell => ({ value, format: 'money' });
const percent = (value: number): Cell => ({ value, format: 'percent' });

/** The band crossings a row should be annotated with, judged against the current band. */
function noteFor(e: LogEntry, p: Portfolio): string {
  const parts = [e.label];

  if (e.partial) parts.push('Partial fill: cash ran out before the full amount could be bought.');

  if (e.source === 'model') {
    if (e.pctBefore > p.cashFloor && e.pctAfter <= p.cashFloor) {
      parts.push(`Crosses below the ${p.cashFloor}% cash floor in this step.`);
    }
    if (e.action === 'SELL' && e.pctBefore <= p.cashCeiling && e.pctAfter > p.cashCeiling) {
      parts.push(`Crosses above the ${p.cashCeiling}% cash ceiling in this step.`);
    }
  }

  return parts.join(' ');
}

export function tradeLogSheet(log: LogEntry[], portfolio: Portfolio): SheetSpec {
  const rows: Cell[][] = [TRADE_LOG_HEADERS.map((h) => ({ value: h, format: 'header' as const }))];

  // Where cash stood before any of this, so the running column has somewhere to start.
  if (log.length > 0) {
    rows.push([
      text(''),
      text(''),
      text(''),
      text(''),
      text(''),
      text(''),
      text(''),
      text(''),
      money(log[0].cashBefore),
      percent(log[0].pctBefore),
      text('Opening balance'),
    ]);
  }

  log.forEach((e, i) => {
    rows.push([
      num(i + 1),
      text(e.action),
      text(e.sym),
      num(e.shares),
      money(e.price),
      money(e.amount),
      // An off-model holding is sold entire and leaves no position behind, so there is no lot.
      num(e.source === 'model' ? e.resultShares : 0),
      text(e.source === 'model' ? (e.resultIsLot ? 'yes' : 'no') : ''),
      money(e.cashAfter),
      percent(e.pctAfter),
      text(noteFor(e, portfolio)),
    ]);
  });

  return { name: 'Trade log', columns: COLUMN_WIDTHS, rows };
}

/**
 * Everything the account was measured against while the trades were made. Kept on its own sheet
 * so the log stays a clean table that can be sorted and filtered without a preamble in the way.
 */
export function contextSheet(portfolio: Portfolio, label: string, exportedAt: Date): SheetSpec {
  return {
    name: 'Account',
    columns: [26, 20],
    rows: [
      [{ value: 'Field', format: 'header' }, { value: 'Value', format: 'header' }],
      [text('Portfolio'), text(label)],
      [text('Exported'), text(exportedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC')],
      [text('Total account value'), money(totalValue(portfolio))],
      [text('Cash'), money(portfolio.cash)],
      [text('Cash %'), percent(cashPct(portfolio))],
      [text('Cash floor %'), percent(portfolio.cashFloor)],
      [text('Cash target %'), percent(portfolio.cashTarget)],
      [text('Cash ceiling %'), percent(portfolio.cashCeiling)],
      [text('Model positions'), num(portfolio.stocks.length)],
      [text('Off-model holdings'), num(portfolio.offModel.length)],
    ],
  };
}

/** `trade-log-john-and-jane-doe-2026-08-31.xlsx` */
export function tradeLogFilename(label: string, at: Date): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'portfolio';
  return `trade-log-${slug}-${at.toISOString().slice(0, 10)}.xlsx`;
}
