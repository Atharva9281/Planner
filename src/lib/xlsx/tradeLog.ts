import { cashPct, lotRounds, totalValue } from '../engine';
import { Order } from '../orders';
import { Portfolio, Stock } from '../types';
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
 * of one. `Band` is the single exception: a range is a label to read, not a quantity to sum, and
 * splitting it into two columns costs a column to say something one cell says better.
 *
 * **Amount is signed** — negative where money leaves the account. The sheet used to carry both an
 * unsigned `Amount` and a signed `Cash`, which on a page of buys printed the same figure twice with
 * a minus sign on one of them; `Action` already states the direction, so the second column was
 * carrying no information the row did not have. One signed column sums to what the orders do to
 * the balance, which is the only thing the pair was ever for.
 *
 * `Weight` and `Band` replace what was a `Cash %` column repeating one account-level figure down
 * every row. A landing weight is the figure the mandate is actually written in, and it means
 * nothing without the band beside it: 2.5% is comfortable inside 2–5 and a breach of 3–4. The two
 * columns are read together or not at all.
 */

export const ORDER_HEADERS = [
  'Symbol',
  'Action',
  'Shares',
  'Opening shares',
  'Total shares',
  'Price',
  'Amount',
  'Weight',
  'Band',
  'Note',
] as const;

const COLUMN_WIDTHS = [12, 9, 11, 15, 13, 12, 14, 10, 15, 44];

/** Where the money column sits, which is also where the cash block below lines up. */
const AMOUNT = ORDER_HEADERS.indexOf('Amount');

const text = (value: string): Cell => ({ value, format: 'text' });
const num = (value: number): Cell => ({ value, format: 'number' });
const money = (value: number): Cell => ({ value, format: 'money' });
const percent = (value: number): Cell => ({ value, format: 'percent' });
const blank = (): Cell => text('');

/**
 * Where the position lands, not how many shares move to get it there.
 *
 * These read `resultingShares` rather than `shares`, which is the fix for a note that was
 * answering a different question from the one this tool exists to ask. Buying 73 shares of AAPL
 * to reach 200 was reported as "Not a round lot" — 73 is not a multiple of 100 — while the Total
 * column beside it read 200. The whole premise is landing the *holding* on a lot; the size of the
 * order that gets there is incidental.
 */
function noteFor(o: Order, stock?: Stock): string {
  if (o.source === 'offModel') return 'Not in the model. Sold entire, proceeds to cash.';
  /* A bond fund is bought in dollars at whatever the NAV is, so it sits on no 100-share grid and
     "Lands off-lot" is not a finding about it — it is the unit of the row being reported as a
     fault. Every one of them would carry that note, on a sheet where the note column exists to
     flag the exceptions. */
  if (stock && !lotRounds(stock)) return 'Bought by weight; no lot applies.';
  return o.resultingShares % 100 === 0 ? 'Lands on a round lot.' : 'Lands off-lot.';
}

/**
 * A band as one cell: `2.0 – 5.0%`.
 *
 * One decimal because that is the precision the model export carries, and a band written to three
 * would imply the mandate is stated more finely than it is.
 */
const bandLabel = (min: number, max: number) => `${min.toFixed(1)} – ${max.toFixed(1)}%`;

export function ordersSheet(
  orders: Order[],
  portfolio: Portfolio,
  cashBefore: number,
): SheetSpec {
  const rows: Cell[][] = [ORDER_HEADERS.map((h) => ({ value: h, format: 'header' as const }))];

  /* One denominator for every weight on the sheet. A trade swaps cash for shares without moving
     total account value, so the weight a position lands on is measured against the same total it
     started against — and against the same total as every other row. */
  const total = totalValue(portfolio);
  const bands = new Map(portfolio.stocks.map((s) => [s.id, s]));

  /* Safe for the opening balance as well as the closing one: a trade swaps cash for shares and an
     off-model sale swaps shares for cash, so the account total these are measured against never
     moved over the course of the session. */
  const pctOfAccount = (dollars: number) => (total > 0 ? (dollars / total) * 100 : 0);

  for (const o of orders) {
    /* Where the position ends up, in the unit the mandate is written in. An off-model holding is
       sold whole, so it lands at nothing — 0.000% against a blank band, because the model never
       gave it one. */
    const landing = total > 0 ? ((o.resultingShares * o.price) / total) * 100 : 0;
    const stock = o.stockId ? bands.get(o.stockId) : undefined;

    rows.push([
      text(o.sym),
      text(o.action),
      num(o.shares),
      num(o.openingShares),
      num(o.resultingShares),
      money(o.price),
      // Signed, so the column sums to what the orders do to the balance.
      money(o.cash),
      percent(landing),
      stock ? text(bandLabel(stock.bandMin, stock.bandMax)) : blank(),
      text(noteFor(o, stock)),
    ]);
  }

  /* The cash these orders move between, and the account they move inside. Kept on this sheet
     rather than only on the Account sheet, because the person reading the orders is the person
     who needs to know whether the cash covers them.
     Under the money column, with the percentage under the weights and the band under the bands —
     so the cash block reads as one more position rather than as a footnote in another shape. */
  const span = (label: string, value: Cell, ...tail: Cell[]) => {
    const row = ORDER_HEADERS.map(() => blank());
    row[0] = text(label);
    row[AMOUNT] = value;
    tail.forEach((cell, i) => (row[AMOUNT + 1 + i] = cell));
    return row;
  };

  rows.push(ORDER_HEADERS.map(() => blank()));
  rows.push(span('Cash before', money(cashBefore), percent(pctOfAccount(cashBefore))));
  /* The band beside it, because this is the line the run is aimed at: cash below its floor is the
     first thing to look for and the sheet should not need the Account tab to show it. */
  rows.push(
    span(
      'Cash after',
      money(portfolio.cash),
      percent(pctOfAccount(portfolio.cash)),
      text(bandLabel(portfolio.cashFloor, portfolio.cashCeiling)),
    ),
  );
  rows.push(span('Total account', money(total)));

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
