import { describe, expect, it } from 'vitest';
import {
  addOffModel,
  addStock,
  applyTrade,
  clearAll,
  loadSample,
  removeOffModel,
  removeStock,
  resetAll,
  resetStock,
  sellOffModel,
  setCash,
  setOffModelField,
  setStockField,
  setStockShares,
  undoLast,
} from './actions';
import { sampleState } from './defaultState';
import { planBuy, planSell, totalValue } from './engine';
import { ExplorerState } from './types';

const stockOf = (state: ExplorerState, sym: string) =>
  state.portfolio.stocks.find((s) => s.sym === sym)!;

const buy = (state: ExplorerState, sym: string, mode: 'target' | 'highlot' | 'rawmax' = 'target') =>
  applyTrade(state, planBuy(state.portfolio, stockOf(state, sym), mode)!);

const sell = (state: ExplorerState, sym: string, mode: 'target' | 'lowlot' | 'rawmax' = 'target') =>
  applyTrade(state, planSell(state.portfolio, stockOf(state, sym), mode)!);

describe('applying a trade', () => {
  it('moves shares and cash and records the arithmetic', () => {
    const before = sampleState();
    const after = buy(before, 'MU');

    expect(stockOf(after, 'MU').shares).toBe(1000);
    expect(after.portfolio.cash).toBeCloseTo(38000 - 60 * 118.4, 6);

    const entry = after.log[0];
    expect(entry).toMatchObject({ sym: 'MU', action: 'BUY', shares: 60, resultShares: 1000 });
    expect(entry.cashBefore).toBe(38000);
    expect(entry.cashAfter).toBeCloseTo(30896, 6);
    expect(entry.pctBefore).toBeCloseTo(6.751, 3);
  });

  it('leaves total account value unchanged, since a trade only swaps cash for shares', () => {
    const before = sampleState();
    const after = sell(buy(before, 'MU'), 'MSFT');
    expect(totalValue(after.portfolio)).toBeCloseTo(totalValue(before.portfolio), 6);
  });

  it('does not mutate the state it was given', () => {
    const before = sampleState();
    buy(before, 'MU');
    expect(stockOf(before, 'MU').shares).toBe(940);
    expect(before.log).toHaveLength(0);
  });
});

describe('undo', () => {
  it('reverses a buy exactly', () => {
    const before = sampleState();
    const after = undoLast(buy(before, 'MU'));

    expect(stockOf(after, 'MU').shares).toBe(940);
    expect(after.portfolio.cash).toBeCloseTo(38000, 6);
    expect(after.log).toHaveLength(0);
  });

  it('reverses a sell exactly', () => {
    const before = sampleState();
    const after = undoLast(sell(before, 'MSFT'));

    expect(stockOf(after, 'MSFT').shares).toBe(600);
    expect(after.portfolio.cash).toBeCloseTo(38000, 6);
  });

  it('unwinds a stack of trades one at a time', () => {
    const before = sampleState();
    let state = buy(before, 'MU');
    state = sell(state, 'MSFT');
    state = buy(state, 'NVDA');
    expect(state.log).toHaveLength(3);

    state = undoLast(undoLast(undoLast(state)));
    expect(state.portfolio.cash).toBeCloseTo(38000, 6);
    expect(stockOf(state, 'MU').shares).toBe(940);
    expect(stockOf(state, 'MSFT').shares).toBe(600);
    expect(stockOf(state, 'NVDA').shares).toBe(280);
  });

  it('does nothing on an empty log', () => {
    const state = sampleState();
    expect(undoLast(state)).toBe(state);
  });
});

describe('off-model holdings', () => {
  const withOther = (shares: number, price: number): ExplorerState => {
    const state = addOffModel(sampleState());
    const id = state.portfolio.offModel[0].id;
    return setOffModelField(setOffModelField(state, id, 'shares', shares), id, 'price', price);
  };

  it('counts toward total account value until it is sold', () => {
    const state = withOther(100, 50);
    expect(totalValue(state.portfolio)).toBeCloseTo(562871.5 + 5000, 6);
  });

  it('sells entirely and adds the proceeds to cash', () => {
    const state = withOther(100, 50);
    const after = sellOffModel(state, state.portfolio.offModel[0].id);

    expect(after.portfolio.offModel).toHaveLength(0);
    expect(after.portfolio.cash).toBeCloseTo(43000, 6);
    expect(after.log[0]).toMatchObject({ source: 'offModel', sym: 'OTHER', shares: 100 });
    // Total is unchanged: the holding turned into the same number of dollars.
    expect(totalValue(after.portfolio)).toBeCloseTo(562871.5 + 5000, 6);
  });

  it('restores the holding at its original price on undo', () => {
    const state = withOther(100, 50);
    const after = undoLast(sellOffModel(state, state.portfolio.offModel[0].id));

    expect(after.portfolio.offModel).toEqual([{ id: expect.any(String), sym: 'OTHER', shares: 100, price: 50 }]);
    expect(after.portfolio.cash).toBeCloseTo(38000, 6);
  });

  it('refuses to remove a holding that carries value, so no band moves without a trade', () => {
    const state = withOther(100, 50);
    const before = totalValue(state.portfolio);
    const after = removeOffModel(state, state.portfolio.offModel[0].id);

    expect(after).toBe(state);
    expect(after.portfolio.offModel).toHaveLength(1);
    expect(totalValue(after.portfolio)).toBe(before);
  });

  it('removes a row worth nothing, which no other number depends on', () => {
    const state = withOther(0, 100);
    const before = totalValue(state.portfolio);
    const after = removeOffModel(state, state.portfolio.offModel[0].id);

    expect(after.portfolio.offModel).toHaveLength(0);
    expect(totalValue(after.portfolio)).toBe(before);
    expect(after.log).toHaveLength(0);
  });

  it('restores a zero-share holding without corrupting its price', () => {
    // The price used to be recovered by dividing proceeds by shares, which is 0/0 here.
    const state = withOther(0, 250);
    const after = undoLast(sellOffModel(state, state.portfolio.offModel[0].id));

    expect(after.portfolio.offModel[0].price).toBe(250);
    expect(after.portfolio.offModel[0].shares).toBe(0);
    expect(Number.isNaN(after.portfolio.cash)).toBe(false);
    expect(after.portfolio.cash).toBe(38000);
  });
});

describe('reset this stock', () => {
  it('returns the shares to the baseline and gives back the cash its trades moved', () => {
    let state = buy(sampleState(), 'MU');
    state = buy(state, 'NVDA');
    state = resetStock(state, stockOf(state, 'MU').id);

    expect(stockOf(state, 'MU').shares).toBe(940);
    // NVDA's buy survives, so cash is back to 38,000 less that trade only.
    expect(state.portfolio.cash).toBeCloseTo(38000 - 20 * 221.75, 6);
    expect(state.log.map((e) => e.sym)).toEqual(['NVDA']);
  });

  it('returns to the edited starting holdings, not the demo defaults', () => {
    // The starting position is whatever the advisor typed in, so that is what a reset owes them.
    let state = setStockShares(sampleState(), 's2', 800); // MU 940 → 800
    const cashAtStart = state.portfolio.cash;

    state = buy(state, 'MU');
    expect(stockOf(state, 'MU').shares).toBeGreaterThan(800);

    state = resetStock(state, 's2');
    expect(stockOf(state, 'MU').shares).toBe(800);
    expect(state.portfolio.cash).toBeCloseTo(cashAtStart, 6);
  });

  it('leaves off-model sales alone, since they belong to no model row', () => {
    let state = addOffModel(sampleState());
    const offId = state.portfolio.offModel[0].id;
    state = setOffModelField(setOffModelField(state, offId, 'shares', 10), offId, 'price', 100);
    state = sellOffModel(state, offId);
    state = buy(state, 'MU');

    state = resetStock(state, 's2');
    expect(state.log.map((e) => e.source)).toEqual(['offModel']);
    expect(state.portfolio.cash).toBeCloseTo(39000, 6);
  });
});

describe('editing', () => {
  it('treats a share edit as redefining the starting position', () => {
    const state = setStockShares(sampleState(), 's1', 700);
    expect(stockOf(state, 'MSFT').shares).toBe(700);
    expect(state.baseline.shares.s1).toBe(700);
  });

  it('treats a cash edit the same way', () => {
    const state = setCash(sampleState(), 50000);
    expect(state.portfolio.cash).toBe(50000);
    expect(state.baseline.cash).toBe(50000);
  });

  it('does not move the baseline for a price or band edit', () => {
    const state = setStockField(sampleState(), 's1', 'price', 500);
    expect(stockOf(state, 'MSFT').price).toBe(500);
    expect(state.baseline.shares.s1).toBe(600);
  });

  it('keeps two rows with the same symbol independent', () => {
    // Holdings key off the row's identity, so a duplicated symbol is two positions, not one.
    let state = addStock(sampleState());
    const newId = state.portfolio.stocks[state.portfolio.stocks.length - 1].id;
    state = setStockField(state, newId, 'sym', 'msft');
    state = setStockShares(state, newId, 25);

    const rows = state.portfolio.stocks.filter((s) => s.sym === 'MSFT');
    expect(rows).toHaveLength(2);
    expect(rows.map((s) => s.shares)).toEqual([600, 25]);

    state = removeStock(state, newId);
    expect(state.portfolio.stocks.filter((s) => s.sym === 'MSFT')).toHaveLength(1);
    expect(stockOf(state, 'MSFT').shares).toBe(600);
  });

  it('drops a removed stock from the baseline and the log', () => {
    let state = buy(sampleState(), 'MU');
    state = removeStock(state, 's2');

    expect(state.baseline.shares.s2).toBeUndefined();
    expect(state.log).toHaveLength(0);
  });

  it('uppercases a symbol as it is typed', () => {
    const state = setStockField(sampleState(), 's1', 'sym', 'nvda');
    expect(state.portfolio.stocks[0].sym).toBe('NVDA');
  });
});

describe('reset everything', () => {
  it('undoes every trade and returns holdings to the baseline', () => {
    let state = buy(sampleState(), 'MU');
    state = sell(state, 'MSFT');
    expect(state.log).toHaveLength(2);

    state = resetAll(state);
    expect(state.log).toHaveLength(0);
    expect(state.portfolio.cash).toBeCloseTo(38000, 6);
    expect(stockOf(state, 'MU').shares).toBe(940);
    expect(stockOf(state, 'MSFT').shares).toBe(600);
  });

  it('keeps the model the advisor set up, and their edited starting position', () => {
    // "Starting state" is the position they entered, never a set of demo numbers.
    let state = setStockShares(sampleState(), 's2', 800);
    state = setStockField(state, 's1', 'price', 500);
    state = buy(state, 'MU');

    state = resetAll(state);
    expect(stockOf(state, 'MSFT').price).toBe(500);
    expect(stockOf(state, 'MU').shares).toBe(800);
  });

  it('clears back to an empty portfolio only when asked', () => {
    const cleared = clearAll();
    expect(cleared.portfolio.stocks).toHaveLength(0);
    expect(cleared.portfolio.cash).toBe(0);
    expect(loadSample().portfolio.stocks).toHaveLength(5);
  });
});
