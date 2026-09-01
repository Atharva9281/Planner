import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyTrade, sellOffModel, addOffModel, setOffModelField } from '../actions';
import { sampleState } from '../defaultState';
import { planBuy, planSell } from '../engine';
import { ExplorerState } from '../types';
import { contextSheet, tradeLogFilename, tradeLogSheet, TRADE_LOG_HEADERS } from './tradeLog';
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
    const files = parts(buildXlsx([tradeLogSheet(traded().log, traded().portfolio)]));

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

describe('the trade log sheet', () => {
  it('writes the headers, then the opening balance, then a row per trade', () => {
    const state = traded();
    const xml = parts(buildXlsx([tradeLogSheet(state.log, state.portfolio)]))[
      'xl/worksheets/sheet1.xml'
    ];

    expect(rowValues(xml, 1)).toEqual([...TRADE_LOG_HEADERS]);
    expect(rowValues(xml, 2).at(-1)).toBe('Opening balance');
    expect(rowValues(xml, 2).at(-3)).toBe(String(state.log[0].cashBefore));

    // One row per trade, oldest first, numbered from 1.
    expect(rowValues(xml, 3)[0]).toBe('1');
    expect(rowValues(xml, 3)[2]).toBe(state.log[0].sym);
    expect(rowValues(xml, 3 + state.log.length - 1)[0]).toBe(String(state.log.length));
  });

  it('writes figures as numbers, not as pre-formatted text, so Excel can sum them', () => {
    const state = traded();
    const xml = parts(buildXlsx([tradeLogSheet(state.log, state.portfolio)]))[
      'xl/worksheets/sheet1.xml'
    ];
    const first = state.log[0];

    const row = rowValues(xml, 3);
    expect(row[4]).toBe(String(first.price));
    expect(row[5]).toBe(String(first.amount));
    expect(row[8]).toBe(String(first.cashAfter));
    // No currency symbols or thousands separators anywhere in the numeric cells.
    for (const i of [3, 4, 5, 6, 8, 9]) expect(row[i]).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('carries the note, and marks a step that crosses a cash band edge', () => {
    const state = traded();
    const xml = parts(buildXlsx([tradeLogSheet(state.log, state.portfolio)]))[
      'xl/worksheets/sheet1.xml'
    ];

    expect(rowValues(xml, 3).at(-1)).toContain(state.log[0].label);

    // The off-model sale is the last row, and says so.
    expect(rowValues(xml, 2 + state.log.length).at(-1)).toContain('not part of the model');
  });

  it('writes only headers when nothing has been traded', () => {
    const state = sampleState();
    const sheet = tradeLogSheet(state.log, state.portfolio);
    expect(sheet.rows).toHaveLength(1);
  });
});

describe('the account sheet', () => {
  it('records what every figure was measured against', () => {
    const state = traded();
    const xml = parts(
      buildXlsx([contextSheet(state.portfolio, 'Worked example', new Date('2026-08-31T12:00:00Z'))]),
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
      'trade-log-john-and-jane-doe-2026-08-31.xlsx',
    );
    expect(tradeLogFilename('A004NR - SLEEVE - Growth+Income', at)).toBe(
      'trade-log-a004nr-sleeve-growth-income-2026-08-31.xlsx',
    );
    expect(tradeLogFilename('', at)).toBe('trade-log-portfolio-2026-08-31.xlsx');
  });
});
