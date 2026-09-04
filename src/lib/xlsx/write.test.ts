import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyTrade, sellOffModel, addOffModel, setOffModelField } from '../actions';
import { sampleState } from '../defaultState';
import { planBuy, planSell } from '../engine';
import { orderSummary } from '../orders';
import { ExplorerState } from '../types';
import { contextSheet, ordersSheet, tradeLogFilename, ORDER_HEADERS } from './tradeLog';
import { buildXlsx, columnName, safeSheetName } from './write';

/** Unzips a built workbook so the parts can be asserted on directly. */
const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
};

/** Pulls one row's cell values back out of a sheet's XML, in column order. */
function rowValues(xml: string, rowNumber: number): string[] {
  const row = new RegExp(`<row r="${rowNumber}">([\\s\\S]*?)</row>`).exec(xml)?.[1] ?? '';
  return [...row.matchAll(/<c [^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
    const body = m[1] ?? '';
    return (
      /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? ''
    );
  });
}

/** A worked example with three trades on it: two model, one off-model. */
function traded(): ExplorerState {
  let s: ExplorerState = sampleState();
  const step = (id: string, plan: typeof planBuy | typeof planSell, mode: 'target') => {
    const stock = s.portfolio.stocks.find((x) => x.id === id)!;
    const p = plan(s.portfolio, stock, mode);
    if (p) s = applyTrade(s, p);
  };
  step('s1', planSell, 'target');
  step('s2', planBuy, 'target');

  s = addOffModel(s);
  const offId = s.portfolio.offModel[0].id;
  s = setOffModelField(setOffModelField(s, offId, 'shares', 100), offId, 'price', 50);
  return sellOffModel(s, offId);
}

/**
 * One cell, by its spreadsheet reference. Needed wherever a row has gaps: an empty unstyled cell
 * is left out of the XML altogether, which is valid — every cell carries its own `r` — but it
 * means positional reads slide left past the hole.
 */
function cellAt(xml: string, ref: string): string | undefined {
  const c = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);
  if (!c) return undefined;
  const body = c[1] ?? '';
  return /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '';
}

/** The orders sheet for a state, built exactly the way the download builds it. */
const sheetFor = (s: ExplorerState) => {
  const { orders, cashBefore } = orderSummary(s);
  return ordersSheet(orders, s.portfolio, cashBefore);
};

const sheetXml = (s: ExplorerState) =>
  parts(buildXlsx([sheetFor(s)]))['xl/worksheets/sheet1.xml'];

describe('spreadsheet plumbing', () => {
  it('names columns past the alphabet', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(10)).toBe('K');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
  });

  it('strips the characters Excel refuses in a sheet name', () => {
    expect(safeSheetName('Trade log')).toBe('Trade log');
    expect(safeSheetName('A/B:C*D?E[F]')).toBe('A B C D E F');
    expect(safeSheetName('')).toBe('Sheet1');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('builds a workbook with every part Excel requires', () => {
    const files = parts(buildXlsx([sheetFor(traded())]));

    for (const required of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(Object.keys(files)).toContain(required);
    }

    // Every relationship the workbook declares has to point at a part that is in the zip.
    for (const [, target] of files['xl/_rels/workbook.xml.rels'].matchAll(/Target="([^"]+)"/g)) {
      expect(Object.keys(files)).toContain(`xl/${target}`);
    }
  });

  it('escapes text that would otherwise break the XML', () => {
    const files = parts(
      buildXlsx([{ name: 'S', rows: [[{ value: 'A & B <c> "d"' }, { value: 'ok' }]] }]),
    );
    const xml = files['xl/worksheets/sheet1.xml'];

    expect(xml).toContain('A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(rowValues(xml, 1)[0]).toBe('A &amp; B &lt;c&gt; &quot;d&quot;');
  });
});

describe('the orders sheet', () => {
  it('writes the headers, then one row per position that has to move', () => {
    const state = traded();
    const xml = sheetXml(state);
    const { orders } = orderSummary(state);

    expect(rowValues(xml, 1)).toEqual([...ORDER_HEADERS]);
    expect(rowValues(xml, 2)[0]).toBe(orders[0].sym);
    expect(rowValues(xml, 2)[1]).toBe(orders[0].action);
    expect(rowValues(xml, 1 + orders.length)[0]).toBe(orders.at(-1)!.sym);
  });

  /** The whole point of the sheet: it reports decisions, not the clicking that found them. */
  it('states one row for a position bought in two steps', () => {
    let s = sampleState();
    const mu = () => s.portfolio.stocks.find((x) => x.sym === 'MU')!;
    for (const mode of ['target', 'rawmax'] as const) {
      const plan = planBuy(s.portfolio, mu(), mode);
      if (plan) s = applyTrade(s, plan);
    }
    expect(s.log.length).toBe(2);

    // Header, one MU row, then straight into the spacer and the cash block — no second MU.
    const rows = sheetFor(s).rows;
    expect(rows[1][0].value).toBe('MU');
    expect(rows[2].every((c) => c.value === '')).toBe(true);
    expect(rows.filter((r) => r[0].value === 'MU')).toHaveLength(1);
  });

  it('writes figures as numbers, not as pre-formatted text, so Excel can sum them', () => {
    const state = traded();
    const xml = sheetXml(state);
    const first = orderSummary(state).orders[0];

    const row = rowValues(xml, 2);
    expect(row[2]).toBe(String(first.shares));
    expect(row[3]).toBe(String(first.openingShares));
    expect(row[4]).toBe(String(first.resultingShares));
    expect(row[5]).toBe(String(first.price));
    expect(row[6]).toBe(String(first.amount));
    // Signed by direction, so the column sums to what the orders do to the balance.
    expect(row[7]).toBe(String(first.cash));
    // No currency symbols or thousands separators anywhere in the numeric cells.
    for (const i of [2, 3, 4, 5, 6, 7, 8]) expect(row[i]).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('carries the opening count, the traded count and the total that follows from them', () => {
    const state = traded();
    const { orders } = orderSummary(state);

    for (const o of orders) {
      const step = o.action === 'BUY' ? o.shares : -o.shares;
      expect(o.openingShares + step).toBe(o.resultingShares);
      expect(o.cash).toBeCloseTo(o.action === 'BUY' ? -o.amount : o.amount, 6);
    }
  });

  it('states the cash the orders move between, once, at the foot', () => {
    const state = traded();
    const xml = sheetXml(state);
    const { orders, cashBefore } = orderSummary(state);

    // Blank spacer, then the three summary lines. Read by reference: the middle columns are
    // empty, so a positional read would slide the money cell left.
    const foot = 1 + orders.length + 2;
    expect(cellAt(xml, `A${foot}`)).toBe('Cash before');
    expect(cellAt(xml, `H${foot}`)).toBe(String(cashBefore));
    expect(cellAt(xml, `A${foot + 1}`)).toBe('Cash after');
    expect(cellAt(xml, `H${foot + 1}`)).toBe(String(state.portfolio.cash));
    expect(cellAt(xml, `A${foot + 2}`)).toBe('Total account');
  });

  it('names an off-model sale as one, since it leaves no position behind', () => {
    const state = traded();
    const xml = sheetXml(state);
    const { orders } = orderSummary(state);
    const row = orders.findIndex((o) => o.source === 'offModel');

    expect(row).toBeGreaterThanOrEqual(0);
    expect(rowValues(xml, 2 + row).at(-1)).toContain('Not in the model');
  });

  it('writes only headers and the cash block when nothing has to be traded', () => {
    const sheet = sheetFor(sampleState());
    // Header, blank spacer, cash before, cash after, total. No order rows.
    expect(sheet.rows).toHaveLength(5);
  });
});

describe('the account sheet', () => {
  it('records what every figure was measured against', () => {
    const state = traded();
    const xml = parts(
      buildXlsx([
        contextSheet(
          state.portfolio,
          'Worked example',
          new Date('2026-08-31T12:00:00Z'),
          state.log.length,
        ),
      ]),
    )['xl/worksheets/sheet1.xml'];

    expect(rowValues(xml, 2)).toEqual(['Portfolio', 'Worked example']);
    expect(rowValues(xml, 3)[1]).toBe('2026-08-31 12:00 UTC');
    expect(rowValues(xml, 7)).toEqual(['Cash floor %', '3']);
    expect(rowValues(xml, 8)).toEqual(['Cash target %', '5']);
    expect(rowValues(xml, 9)).toEqual(['Cash ceiling %', '8']);
  });
});

describe('the filename', () => {
  it('slugs the portfolio label and dates the file', () => {
    const at = new Date('2026-08-31T18:20:00Z');
    expect(tradeLogFilename('John and Jane Doe', at)).toBe(
      'orders-john-and-jane-doe-2026-08-31.xlsx',
    );
    expect(tradeLogFilename('A004NR - SLEEVE - Growth+Income', at)).toBe(
      'orders-a004nr-sleeve-growth-income-2026-08-31.xlsx',
    );
    expect(tradeLogFilename('', at)).toBe('orders-portfolio-2026-08-31.xlsx');
  });
});
