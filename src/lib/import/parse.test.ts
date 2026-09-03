import { describe, expect, it } from 'vitest';
import { likelyFunds, num, offModelSymbols, parseSheets, unpricedSymbols } from './parse';
import { applyImport, importIssues } from './apply';
import { Resolution, SheetGrid } from './types';
import { lotAwareTarget, mandatoryStatus, needsDecision, planBuy, totalValue } from '../engine';

/* ------------------------------------------------------------------ */
/* fixtures, transcribed from the real exports                         */
/* ------------------------------------------------------------------ */

const MODEL_NAME = 'A004NR - SLEEVE - Growth+Income - CSS+M7+HiVol+FI';

/** SecurityModelAllocationsExport_08072026.xlsx, abridged to the interesting rows. */
const modelSheet = (): SheetGrid => ({
  name: 'Upload_Security Model',
  rows: [
    [
      'Model Name',
      'Model Platform',
      'Model Description',
      'Model Owner (RepID)',
      'Investment Objective',
      'Symbol',
      'Cusip',
      'Type',
      'Allocation %',
      'Min Drift %',
      'Max Drift %',
    ],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'USD CASH', '', 'Cash and Equiv', 7, 5, 9],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'AAPL', '037833100', 'Stocks / ETFs Sleeve', 3, 2, 6],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'AMAT', '038222105', 'Stocks / ETFs Sleeve', 3, 2, 6],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'HWM', '443201108', 'Stocks / ETFs Sleeve', 3, 2, 6],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'QQQ', '46090E103', 'Stocks / ETFs Sleeve', 12, 10, 14],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'SNDK', '80004C200', 'Stocks / ETFs Sleeve', 1, 1, 2],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'MGSMX', '25158T830', 'Fixed Income Sleeve', 10, 8, 10],
    [MODEL_NAME, 'SAM', 'Sleeve', '18CD', 'Growth w/ Income', 'PDSZX', '744336819', 'Fixed Income Sleeve', 10, 8, 12],
  ],
});

/** Investments-Summary-5-22-2026, abridged. Note the preamble above the table. */
const holdingsSheet = (): SheetGrid => ({
  name: 'Sheet1',
  rows: [
    ['Account Name', 'John and Jane Doe'],
    ['Account Number', 'ABCDEFGH'],
    ['Intraday Cash Balance', 633.98],
    ['Previous Day Cash Balance', 6293.73],
    ['Intraday Cash and Equivalents', 147283.93],
    ['Previous Day Cash and Equivalents', 146649.95],
    ['Margin Balance', 0],
    [
      'Location',
      'Symbol / CUSIP / ID',
      'Description / Fund',
      'Asset Class',
      'Quantity',
      'Price / NAV',
      'Market Value',
      'Percent of Account Holdings',
    ],
    ['LPL', '9999136', 'Deposit Cash Account', 'Cash and Equiv', 140328.86, 1, 140328.86, 0.207],
    ['LPL', 'AA', 'Alcoa Corp', 'Stocks / ETFs Sleeve', 200, 71.38, 14276, 0.0196],
    ['LPL', 'AMAT', 'Applied Materials Inc', 'Stocks / ETFs Sleeve', 200, 432.16, 86432, 0.126],
    ['LPL', 'AMAT 260529 C 460.00', 'Call Applied Materials', 'Listed Option', -2, 3, -600, -0.0009],
    ['LPL', 'HWM', 'Howmet Aerospace Inc', 'Stocks / ETFs Sleeve', 300, 256.55, 76965, 0.115],
    ['LPL', 'HWM 260529 C 267.50', 'Call Howmet Aerospace', 'Listed Option', -3, 1.2, -360, -0.001],
    ['LPL', 'QQQ', 'Invesco Qqq Etf', 'Index', 51, 717.54, 36594.54, 0.0538],
    ['LPL', 'FLUD', 'Franklin Ultra Short Bond Etf', 'Fixed Income Sleeve', 7373, 25, 184325, 0.272],
  ],
});

const baseResolution = (over: Partial<Resolution> = {}): Resolution => ({
  keepOffModel: true,
  ...over,
});

/* ------------------------------------------------------------------ */

describe('number parsing', () => {
  it('reads the shapes custodian exports actually use', () => {
    expect(num(1234.5)).toBe(1234.5);
    expect(num('1,234.50')).toBe(1234.5);
    expect(num('$1,234.50')).toBe(1234.5);
    expect(num('12%')).toBe(12);
    expect(num('(500)')).toBe(-500);
    expect(num('')).toBeNull();
    expect(num('n/a')).toBeNull();
    expect(num(null)).toBeNull();
  });
});

describe('the model export', () => {
  it('reads symbols, targets and absolute bands', () => {
    const parsed = parseSheets([modelSheet()]);
    const model = parsed.models[0];

    expect(parsed.sheets[0]).toMatchObject({ read: 'model' });
    expect(model.name).toBe(MODEL_NAME);
    expect(model.rows).toHaveLength(7); // 8 rows less the cash row

    expect(model.rows.find((r) => r.sym === 'AAPL')).toMatchObject({
      target: 3,
      bandMin: 2,
      bandMax: 6,
    });
  });

  it('takes the cash band off the USD CASH row rather than a stock row', () => {
    const model = parseSheets([modelSheet()]).models[0];
    // Allocation % is the target, the drift columns the two edges: all three, not just the band.
    expect(model.cashBand).toEqual({ target: 7, floor: 5, ceiling: 9 });
    expect(model.rows.some((r) => r.sym === 'USD CASH')).toBe(false);
  });

  it('carries all three cash figures into the portfolio', () => {
    const p = applyImport(parseSheets([modelSheet(), holdingsSheet()]), baseResolution()).portfolio;
    expect(p.cashFloor).toBe(5);
    expect(p.cashTarget).toBe(7);
    expect(p.cashCeiling).toBe(9);
  });

  it('keeps a band whose ceiling equals its target', () => {
    // MGSMX is 10% with an 8–10% band: read as a tolerance this would be 0–20%, which is wrong.
    const model = parseSheets([modelSheet()]).models[0];
    expect(model.rows.find((r) => r.sym === 'MGSMX')).toMatchObject({
      target: 10,
      bandMin: 8,
      bandMax: 10,
    });
  });

  it('flags the mutual funds instead of assuming a lot rule for them', () => {
    const model = parseSheets([modelSheet()]).models[0];
    expect(likelyFunds(model).map((r) => r.sym).sort()).toEqual(['MGSMX', 'PDSZX']);
  });

  /* The five fields the model export is read for. Everything else in that file — platform,
     description, owner, objective, cusip — is carried past or ignored. */
  it('reads all five model fields off every row', () => {
    const model = parseSheets([modelSheet()]).models[0];

    expect(
      model.rows.map((r) => [r.sym, r.type, r.target, r.bandMin, r.bandMax]),
    ).toEqual([
      ['AAPL', 'Stocks / ETFs Sleeve', 3, 2, 6],
      ['AMAT', 'Stocks / ETFs Sleeve', 3, 2, 6],
      ['HWM', 'Stocks / ETFs Sleeve', 3, 2, 6],
      ['QQQ', 'Stocks / ETFs Sleeve', 12, 10, 14],
      ['SNDK', 'Stocks / ETFs Sleeve', 1, 1, 2],
      ['MGSMX', 'Fixed Income Sleeve', 10, 8, 10],
      ['PDSZX', 'Fixed Income Sleeve', 10, 8, 12],
    ]);
  });

  it('reads the figures whether the export stores them as numbers or as text', () => {
    // The real export writes "7"/"5"/"9" as strings, and a percent sign is not unheard of.
    const sheet = modelSheet();
    sheet.rows.push([
      MODEL_NAME, 'SAM', '', '', '', 'TXT', '', 'Stocks / ETFs Sleeve', '4', '2.5', '6%',
    ]);

    expect(parseSheets([sheet]).models[0].rows.find((r) => r.sym === 'TXT')).toMatchObject({
      target: 4,
      bandMin: 2.5,
      bandMax: 6,
    });
  });

  it('groups a multi-model export by model name', () => {
    const sheet = modelSheet();
    sheet.rows.push([
      'SECOND MODEL', 'SAM', '', '', '', 'MSFT', '594918104', 'Stocks / ETFs Sleeve', 50, 45, 55,
    ]);

    const parsed = parseSheets([sheet]);
    expect(parsed.models.map((m) => m.name)).toEqual([MODEL_NAME, 'SECOND MODEL']);
    expect(parsed.models[1].rows).toHaveLength(1);
  });
});

describe('the holdings export', () => {
  it('reads the account identity out of the preamble', () => {
    const holdings = parseSheets([holdingsSheet()]).holdings!;
    expect(holdings.accountName).toBe('John and Jane Doe');
    expect(holdings.accountNumber).toBe('ABCDEFGH');
  });

  it('drops every option row outright', () => {
    const parsed = parseSheets([holdingsSheet()]);
    const holdings = parsed.holdings!;

    // They would otherwise become tickers like "AMAT 260529 C 460.00", and their value would
    // move every weight in the account.
    expect(holdings.positions.map((p) => p.sym).sort()).toEqual(['AA', 'AMAT', 'FLUD', 'HWM', 'QQQ']);
    expect(holdings.positions.some((p) => /\s/.test(p.sym))).toBe(false);
    expect(parsed.warnings.some((w) => w.includes('2 option rows ignored'))).toBe(true);
  });

  it('marks fixed income as held rather than tradeable', () => {
    const holdings = parseSheets([holdingsSheet()]).holdings!;
    const bySym = Object.fromEntries(holdings.positions.map((p) => [p.sym, p]));

    expect(bySym.AMAT.tradeable).toBe(true); // Stocks / ETFs Sleeve
    expect(bySym.QQQ.tradeable).toBe(true); // Index
    expect(bySym.FLUD.tradeable).toBe(false); // Fixed Income Sleeve
  });

  it('treats the deposit account as cash, not as a position', () => {
    const holdings = parseSheets([holdingsSheet()]).holdings!;
    expect(holdings.positions.some((p) => p.sym === '9999136')).toBe(false);
  });

  it('takes cash from the Cash and Equiv row quantity, ignoring the preamble figures', () => {
    const holdings = parseSheets([holdingsSheet()]).holdings!;

    expect(holdings.cash).toBe(140328.86);
    expect(holdings.cashFound).toBe(true);
  });

  it('warns and starts at zero when the file has no cash row', () => {
    // John Doe's real export has no Cash and Equiv row anywhere in it.
    const sheet = holdingsSheet();
    sheet.rows = sheet.rows.filter((r) => r[3] !== 'Cash and Equiv');

    const parsed = parseSheets([sheet]);
    expect(parsed.holdings!.cash).toBe(0);
    expect(parsed.holdings!.cashFound).toBe(false);
    expect(parsed.warnings.some((w) => w.includes('No "Cash and Equiv" row'))).toBe(true);
  });

  it('reads the account number whichever label the export used for it', () => {
    for (const label of ['Account Number', 'Account #', 'Number']) {
      const sheet = holdingsSheet();
      sheet.rows[1] = [label, 'ABCDEFGH'];
      expect(parseSheets([sheet]).holdings!.accountNumber).toBe('ABCDEFGH');
    }
  });
});

describe('joining the two files', () => {
  const parsed = () => parseSheets([modelSheet(), holdingsSheet()]);

  it('reads both files in one pass', () => {
    const p = parsed();
    expect(p.models).toHaveLength(1);
    expect(p.holdings).toBeDefined();
    // The only thing worth saying about these two files is that the options were dropped.
    expect(p.warnings).toEqual([expect.stringContaining('option rows ignored')]);
  });

  it('names the model positions the account does not hold', () => {
    const p = parsed();
    expect(unpricedSymbols(p.models[0], p.holdings).sort()).toEqual([
      'AAPL',
      'MGSMX',
      'PDSZX',
      'SNDK',
    ]);
  });

  it('names the held positions the model has no row for', () => {
    const p = parsed();
    expect(offModelSymbols(p.models[0], p.holdings).map((h) => h.sym).sort()).toEqual(['AA', 'FLUD']);
  });
});

describe('applying the import', () => {
  const parsed = () => parseSheets([modelSheet(), holdingsSheet()]);

  it('builds a portfolio with shares and prices from the holdings file', () => {
    const state = applyImport(parsed(), baseResolution());
    const amat = state.portfolio.stocks.find((s) => s.sym === 'AMAT')!;

    expect(amat).toMatchObject({ shares: 200, price: 432.16, target: 3, bandMin: 2, bandMax: 6 });
  });

  it('takes the cash band from the model, not a default', () => {
    const state = applyImport(parsed(), baseResolution());
    expect(state.portfolio.cashFloor).toBe(5);
    expect(state.portfolio.cashCeiling).toBe(9);
  });

  it('uses the Cash and Equiv quantity as the balance', () => {
    expect(applyImport(parsed(), baseResolution()).portfolio.cash).toBe(140328.86);
  });

  it('carries the sleeve through to the portfolio instead of dropping it at import', () => {
    const state = applyImport(parsed(), baseResolution());
    expect(state.portfolio.stocks.find((s) => s.sym === 'MGSMX')!.type).toBe(
      'Fixed Income Sleeve',
    );
    expect(state.portfolio.stocks.find((s) => s.sym === 'AAPL')!.type).toBe(
      'Stocks / ETFs Sleeve',
    );
  });

  it('brings unheld model positions in at zero shares rather than dropping them', () => {
    const state = applyImport(parsed(), baseResolution());
    const aapl = state.portfolio.stocks.find((s) => s.sym === 'AAPL')!;

    expect(aapl.shares).toBe(0);
    // No price exists anywhere for it, which the table then surfaces.
    expect(aapl.price).toBe(0);
    expect(state.portfolio.stocks).toHaveLength(7);
  });

  it('takes every price from the holdings file and none from the model', () => {
    const state = applyImport(parsed(), baseResolution());

    // Held: the holdings file is the only thing that ever supplies a price.
    expect(state.portfolio.stocks.find((s) => s.sym === 'AMAT')!.price).toBe(432.16);
    expect(state.portfolio.stocks.find((s) => s.sym === 'HWM')!.price).toBe(256.55);

    // Not held: the model export carries targets and bands, never prices, so there is none.
    for (const sym of ['AAPL', 'MGSMX', 'PDSZX', 'SNDK']) {
      expect(state.portfolio.stocks.find((s) => s.sym === sym)!.price).toBe(0);
    }

    expect(importIssues(parsed(), baseResolution()).unpriced.sort()).toEqual([
      'AAPL',
      'MGSMX',
      'PDSZX',
      'SNDK',
    ]);
  });

  it('keeps off-model holdings so they still count toward account value', () => {
    const kept = applyImport(parsed(), baseResolution());
    expect(kept.portfolio.offModel.map((h) => h.sym)).toContain('FLUD');

    const dropped = applyImport(parsed(), baseResolution({ keepOffModel: false }));
    expect(dropped.portfolio.offModel.map((h) => h.sym)).not.toContain('FLUD');
    expect(totalValue(dropped.portfolio)).toBeLessThan(totalValue(kept.portfolio));
  });

  it('leaves options out of account value entirely', () => {
    const p = applyImport(parsed(), baseResolution()).portfolio;

    // Cash, the five model rows the account holds, and FLUD off-model. No -$960 of short calls.
    const expected =
      140328.86 + 200 * 432.16 + 300 * 256.55 + 51 * 717.54 + 7373 * 25 + 200 * 71.38;
    expect(totalValue(p)).toBeCloseTo(expected, 2);
    expect(p.offModel.some((h) => h.sym === 'OPTIONS')).toBe(false);
  });

  it('marks fixed income untradeable on both sides of the model', () => {
    const p = applyImport(parsed(), baseResolution()).portfolio;

    expect(p.stocks.find((s) => s.sym === 'MGSMX')!.tradeable).toBe(false);
    expect(p.stocks.find((s) => s.sym === 'AAPL')!.tradeable).toBe(true);
    // FLUD is Fixed Income Sleeve in the holdings but has no model row.
    expect(p.offModel.find((h) => h.sym === 'FLUD')!.tradeable).toBe(false);
  });

  it('turns the lot rule off for a fund, so it aims at the raw share count', () => {
    const state = applyImport(parsed(), baseResolution());

    const fund = state.portfolio.stocks.find((s) => s.sym === 'MGSMX')!;
    expect(fund.lotRounding).toBe(false);

    // The account does not hold it, so the import gives it no price. Price it here to exercise
    // the lot rule itself, which is what this test is about.
    fund.price = 10;

    // A 10% target on this account is far from a multiple of 100, and stays that way.
    const target = lotAwareTarget(state.portfolio, fund);
    expect(target.isLot).toBe(false);
    expect(target.goal).toBe(Math.round(target.raw));
    expect(target.goal % 100).not.toBe(0);

    // While a stock alongside it still rounds to a lot.
    expect(state.portfolio.stocks.find((s) => s.sym === 'AMAT')!.lotRounding).toBe(true);
  });
});

describe('an account being opened, with a balance and nothing held', () => {
  /** The same custodian layout, funded but not yet invested: a cash row and no positions. */
  const cashOnlySheet = (): SheetGrid => ({
    name: 'Sheet1',
    rows: [
      ['Account Name', 'New Client'],
      ['Account Number', 'ZZ999999'],
      [
        'Location',
        'Symbol / CUSIP / ID',
        'Description / Fund',
        'Asset Class',
        'Quantity',
        'Price / NAV',
        'Market Value',
        'Percent of Account Holdings',
      ],
      ['LPL', '9999136', 'Deposit Cash Account', 'Cash and Equiv', 500000, 1, 500000, 1],
    ],
  });

  it('reads the sheet as holdings and keeps the balance, though it lists no positions', () => {
    const p = parseSheets([modelSheet(), cashOnlySheet()]);

    // The gate here used to be "has at least one position", which dropped the sheet and the
    // half-million on it without a word.
    expect(p.sheets.find((s) => s.name === 'Sheet1')?.read).toBe('holdings');
    expect(p.holdings?.cash).toBe(500000);
    expect(p.holdings?.cashFound).toBe(true);
    expect(p.holdings?.positions).toHaveLength(0);
    expect(p.holdings?.accountName).toBe('New Client');
  });

  it('imports every model row at zero shares, waiting to be bought', () => {
    const state = applyImport(parseSheets([modelSheet(), cashOnlySheet()]), baseResolution());

    expect(state.portfolio.cash).toBe(500000);
    expect(state.portfolio.stocks).toHaveLength(7);
    expect(state.portfolio.stocks.every((s) => s.shares === 0)).toBe(true);
    // The model's own cash row still sets the band, exactly as on a funded account.
    expect(state.portfolio.cashTarget).toBe(7);
  });

  it('prices those rows from the preview, since no file can price them', () => {
    const parsed = parseSheets([modelSheet(), cashOnlySheet()]);

    // Nothing is held, so every model row needs a price and the preview asks for all of them.
    expect(importIssues(parsed, baseResolution()).unpriced).toHaveLength(7);

    const typed = baseResolution({ prices: { AAPL: 298.6, QQQ: 717.54 } });
    const state = applyImport(parsed, typed);

    expect(state.portfolio.stocks.find((s) => s.sym === 'AAPL')!.price).toBe(298.6);
    expect(state.portfolio.stocks.find((s) => s.sym === 'QQQ')!.price).toBe(717.54);
    // Untouched rows still arrive without one rather than with a guess.
    expect(state.portfolio.stocks.find((s) => s.sym === 'AMAT')!.price).toBe(0);
    expect(importIssues(parsed, typed).unpriced).toHaveLength(5);
  });

  it('never lets a typed price override the holdings file', () => {
    // AMAT is held at 432.16. A stale figure typed in the preview must not displace it.
    const state = applyImport(
      parseSheets([modelSheet(), holdingsSheet()]),
      baseResolution({ prices: { AMAT: 1 } }),
    );

    expect(state.portfolio.stocks.find((s) => s.sym === 'AMAT')!.price).toBe(432.16);
  });

  it('takes the opening balance from the advisor when no file carries one', () => {
    // The model alone: no holdings export at all, the way a new account usually arrives.
    const parsed = parseSheets([modelSheet()]);
    expect(importIssues(parsed, baseResolution()).needsCash).toBe(true);

    const state = applyImport(parsed, baseResolution({ cash: 250000 }));
    expect(state.portfolio.cash).toBe(250000);
    expect(state.portfolio.stocks).toHaveLength(7);
  });

  it('does not let a typed balance override a Cash and Equiv row', () => {
    const state = applyImport(
      parseSheets([modelSheet(), holdingsSheet()]),
      baseResolution({ cash: 999 }),
    );

    expect(state.portfolio.cash).toBe(140328.86);
    expect(importIssues(parseSheets([modelSheet(), holdingsSheet()]), baseResolution()).needsCash).toBe(
      false,
    );
  });

  it('offers a real trade on every row once it is priced', () => {
    const parsed = parseSheets([modelSheet(), cashOnlySheet()]);
    const prices = { AAPL: 298.6, AMAT: 432.16, HWM: 256.55, QQQ: 717.54, SNDK: 40, MGSMX: 10, PDSZX: 10 };
    const state = applyImport(parsed, baseResolution({ prices }));

    const qqq = state.portfolio.stocks.find((s) => s.sym === 'QQQ')!;

    // Holding nothing against a 12% target is below the 10% floor, so the row is mandatory,
    // and the lot-aware target is a buy the table can actually offer.
    expect(mandatoryStatus(state.portfolio, qqq)).toBe('under');
    expect(needsDecision(state.portfolio, qqq)).toBe(true);

    const plan = planBuy(state.portfolio, qqq, 'target')!;
    expect(plan).not.toBeNull();
    expect(plan.action).toBe('BUY');
    expect(plan.shares).toBeGreaterThan(0);
    expect(plan.resultShares).toBe(lotAwareTarget(state.portfolio, qqq).goal);
  });
});

describe('sheets that are not recognised', () => {
  it('is reported rather than failing silently', () => {
    const junk: SheetGrid = { name: 'Notes', rows: [['just', 'some', 'text'], ['and', 'more']] };
    const parsed = parseSheets([junk]);

    expect(parsed.sheets).toEqual([{ name: 'Notes', read: 'skipped', rows: 0 }]);
    expect(parsed.models).toHaveLength(0);
    expect(parsed.holdings).toBeUndefined();
  });
});
