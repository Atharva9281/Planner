import { cashPct, totalValue } from '../engine';
import { Order } from '../orders';
import { Portfolio } from '../types';
import { Cell, SheetSpec } from './write';

/**
 * The orders as a spreadsheet: one row per position that has to move, which is what a trading
 * desk acts on.
 *
 * Not the click history. An advisor arrives at a decision by trying things, and a file that
 * listed every attempt would read as a list of instructions — including the ones that were
 * reversed. The steps stay on screen behind a toggle for retracing a session; they are not the
 * document that leaves the building.
 *
 * There is deliberately no running "cash after each row" column. Net orders have no sequence to
 * execute in, so a running balance would be asserting an order of execution this tool never
 * decided. The cash position is stated once, underneath, where it belongs.
 *
 * Every figure is written as a number with a format, never as pre-formatted text, so the columns
 * sort and sum in Excel. That is the whole reason for exporting a workbook rather than a picture
 * of one.
 */

export const ORDER_HEADERS = ['Symbol', 'Action', 'Shares', 'Price', 'Amount', 'Note'] as const;

const COLUMN_WIDTHS = [12, 9, 11, 13, 15, 48];

const text = (value: string): Cell => ({ value, format: 'text' });
const num = (value: number): Cell => ({ value, format: 'number' });
const money = (value: number): Cell => ({ value, format: 'money' });
const percent = (value: number): Cell => ({ value, format: 'percent' });
const blank = (): Cell => text('');

function noteFor(o: Order): string {
  if (o.source === 'offModel') return 'Not in the model. Sold entire, proceeds to cash.';
  return o.shares % 100 === 0 ? 'A clean lot.' : 'Not a round lot.';
}

export function ordersSheet(
  orders: Order[],
  portfolio: Portfolio,
  cashBefore: number,
): SheetSpec {
  const rows: Cell[][] = [ORDER_HEADERS.map((h) => ({ value: h, format: 'header' as const }))];

  for (const o of orders) {
    rows.push([
      text(o.sym),
      text(o.action),
      num(o.shares),
      money(o.price),
      money(o.amount),
      text(noteFor(o)),
    ]);
  }

  /* The cash these orders move between, and the account they move inside. Kept on this sheet
     rather than only on the Account sheet, because the person reading the orders is the person
     who needs to know whether the cash covers them. */
  rows.push([blank(), blank(), blank(), blank(), blank(), blank()]);
  rows.push([text('Cash before'), blank(), blank(), blank(), money(cashBefore), blank()]);
  rows.push([text('Cash after'), blank(), blank(), blank(), money(portfolio.cash), blank()]);
  rows.push([
    text('Total account'),
    blank(),
    blank(),
    blank(),
    money(totalValue(portfolio)),
    text(`Cash is ${cashPct(portfolio).toFixed(3)}% of it.`),
  ]);

  return { name: 'Orders', columns: COLUMN_WIDTHS, rows };
}

/**
 * Everything the account was measured against while the orders were arrived at. Kept on its own
 * sheet so the orders stay a clean table that can be sorted and filtered without a preamble in
 * the way.
 */
export function contextSheet(
  portfolio: Portfolio,
  label: string,
  exportedAt: Date,
  steps: number,
): SheetSpec {
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
      // How much exploring produced these orders. Not an instruction, but it explains why the
      // sheet is short when the session was long.
      [text('Steps taken'), num(steps)],
    ],
  };
}

/** `orders-john-and-jane-doe-2026-08-31.xlsx` */
export function tradeLogFilename(label: string, at: Date): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'portfolio';
  return `orders-${slug}-${at.toISOString().slice(0, 10)}.xlsx`;
}
