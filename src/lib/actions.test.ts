import { describe, expect, it } from 'vitest';
import {
  addOffModel,
  canRemoveOffModel,
  addStock,
  applyTrade,
  clearAll,
  closeAccount,
  loadSample,
  removeOffModel,
  removeStock,
  resetAll,
  resetStock,
  sellAllOffModel,
  sellOffModel,
  setCash,
  setOffModelField,
  tradeOffModel,
  setStockField,
  setStockShares,
  tradeAll,
  undoLast,
  undoSize,
} from './actions';
import { samplePortfolio, sampleState } from './defaultState';
import {
  inDisplayOrder,
  destinationShares,
  planToBandEdge,
  planToLot,
  planToTarget,
  totalValue,
} from './engine';
import { ExplorerState } from './types';

const stockOf = (state: ExplorerState, sym: string) =>
  state.portfolio.stocks.find((s) => s.sym === sym)!;

const buy = (state: ExplorerState, sym: string, mode: 'target' | 'highlot' | 'rawmax' = 'target') => {
  const k = stockOf(state, sym);
  return applyTrade(
    state,
    (mode === 'target'
      ? planToTarget(state.portfolio, k)
      : mode === 'highlot'
        ? planToLot(state.portfolio, k, 'high')
        : planToBandEdge(state.portfolio, k, 'high'))!,
  );
};

const sell = (state: ExplorerState, sym: string, mode: 'target' | 'lowlot' | 'rawmax' = 'target') => {
  const k = stockOf(state, sym);
  return applyTrade(
    state,
    (mode === 'target'
      ? planToTarget(state.portfolio, k)
      : mode === 'lowlot'
        ? planToLot(state.portfolio, k, 'low')
        : planToBandEdge(state.portfolio, k, 'low'))!,
  );
};

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
    const after = sell(buy(before, 'MU'), 'MSFT', 'lowlot');
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
    const after = undoLast(sell(before, 'MSFT', 'lowlot'));

    expect(stockOf(after, 'MSFT').shares).toBe(600);
    expect(after.portfolio.cash).toBeCloseTo(38000, 6);
  });

  it('unwinds a stack of trades one at a time', () => {
    const before = sampleState();
    let state = buy(before, 'MU');
    state = sell(state, 'MSFT', 'lowlot');
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

  it('adds a holding entered on the page with its ticker, shares and price', () => {
    const state = addOffModel(sampleState(), { sym: ' nvda ', shares: 250, price: 182.4 });

    expect(state.portfolio.offModel).toEqual([
      { id: expect.any(String), sym: 'NVDA', shares: 250, price: 182.4 },
    ]);
    // The holding was already owned, so it moves the starting position rather than trading.
    expect(state.baseline.offModel).toEqual(state.portfolio.offModel);
    expect(state.log).toHaveLength(0);
    expect(totalValue(state.portfolio)).toBeCloseTo(562871.5 + 45600, 6);
  });

  it('takes a priced ticker at no shares, for buying into afterwards', () => {
    const state = addOffModel(sampleState(), { sym: 'TSLA', shares: 0, price: 410 });

    expect(state.portfolio.offModel[0]).toMatchObject({ sym: 'TSLA', shares: 0, price: 410 });
    expect(totalValue(state.portfolio)).toBeCloseTo(562871.5, 6);

    // Part-filled, like every other per-row buy: 100 sh at $410 is more than the $38,000 of cash.
    const bought = tradeOffModel(state, state.portfolio.offModel[0].id, 100);
    expect(bought.portfolio.offModel[0].shares).toBe(92);
    expect(bought.portfolio.cash).toBeCloseTo(38000 - 92 * 410, 6);
    expect(bought.log[0]).toMatchObject({
      source: 'offModel',
      sym: 'TSLA',
      action: 'BUY',
      partial: true,
    });
  });

  it('sells entirely and adds the proceeds to cash, keeping the row at nothing held', () => {
    const state = withOther(100, 50);
    const after = sellOffModel(state, state.portfolio.offModel[0].id);

    expect(after.portfolio.offModel).toEqual([
      { id: expect.any(String), sym: 'OTHER', shares: 0, price: 50 },
    ]);
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

  it('sells every one of them in a single press, fixed income included', () => {
    /* The model is the mandate, so a holding it has no row for is sold — whatever asset class it
       is. Being held rather than traded is a rule about positions the model asks for. */
    let state = withOther(100, 50);
    state = addOffModel(state);
    const second = state.portfolio.offModel[1].id;
    state = setOffModelField(setOffModelField(state, second, 'shares', 10), second, 'price', 100);

    state = addOffModel(state);
    const bond = state.portfolio.offModel[2].id;
    state = setOffModelField(setOffModelField(state, bond, 'shares', 40), bond, 'price', 25);

    const before = totalValue(state.portfolio);
    const { state: after, outcome } = sellAllOffModel(state);

    expect(outcome).toMatchObject({ sold: 3, proceeds: 7000 });
    expect(after.portfolio.offModel.map((h) => h.shares)).toEqual([0, 0, 0]);
    expect(after.portfolio.cash).toBeCloseTo(38000 + 7000, 6);
    // A sale swaps holdings for dollars, so the account total does not move.
    expect(totalValue(after.portfolio)).toBeCloseTo(before, 6);
  });

  it('takes a whole press back in one undo', () => {
    let state = withOther(100, 50);
    state = addOffModel(state);
    const second = state.portfolio.offModel[1].id;
    state = setOffModelField(setOffModelField(state, second, 'shares', 10), second, 'price', 100);

    const { state: sold } = sellAllOffModel(state);
    expect(sold.log).toHaveLength(2);
    expect(undoSize(sold)).toBe(2);

    const back = undoLast(sold);
    expect(back.log).toHaveLength(0);
    expect(back.portfolio.offModel.map((h) => h.shares)).toEqual([100, 10]);
    expect(back.portfolio.cash).toBeCloseTo(38000, 6);
  });

  it('reports nothing sold when every row is worth nothing', () => {
    // A blank row added by mistake has nothing to sell; it leaves through "Remove row" instead.
    const state = withOther(0, 0);
    const { state: after, outcome } = sellAllOffModel(state);
    expect(outcome).toMatchObject({ sold: 0, proceeds: 0 });
    expect(after).toBe(state);
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

  it('sells part of a holding down to a chosen count', () => {
    const state = withOther(100, 50);
    const id = state.portfolio.offModel[0].id;
    const after = tradeOffModel(state, id, 40);

    expect(after.portfolio.offModel[0].shares).toBe(40);
    expect(after.portfolio.cash).toBeCloseTo(38000 + 60 * 50, 6);
    expect(after.log[0]).toMatchObject({
      source: 'offModel',
      offModelId: id,
      action: 'SELL',
      shares: 60,
      resultShares: 40,
    });
  });

  it('buys more, clamped to the cash like a model row', () => {
    // $38,000 of cash at $50 a share affords 760, so asking to hold 1,000 buys 760 of the 900.
    const state = withOther(100, 50);
    const id = state.portfolio.offModel[0].id;
    const after = tradeOffModel(state, id, 1000);

    expect(after.portfolio.offModel[0].shares).toBe(860);
    expect(after.portfolio.cash).toBeCloseTo(0, 6);
    expect(after.log[0]).toMatchObject({ action: 'BUY', shares: 760, partial: true });
    expect(totalValue(after.portfolio)).toBeCloseTo(totalValue(state.portfolio), 6);
  });

  it('buys back into a holding already sold out, and undoes either way', () => {
    const state = withOther(100, 50);
    const id = state.portfolio.offModel[0].id;
    const sold = sellOffModel(state, id);
    const bought = tradeOffModel(sold, id, 30);

    expect(bought.portfolio.offModel[0].shares).toBe(30);
    expect(undoLast(bought).portfolio.offModel[0].shares).toBe(0);
    expect(undoLast(undoLast(bought)).portfolio.offModel[0].shares).toBe(100);
    expect(undoLast(undoLast(bought)).portfolio.cash).toBeCloseTo(38000, 6);
  });

  it('will not remove a row sold down to nothing, which would lose its order', () => {
    const state = withOther(100, 50);
    const id = state.portfolio.offModel[0].id;
    const sold = sellOffModel(state, id);

    expect(canRemoveOffModel(sold, id)).toBe(false);
    expect(removeOffModel(sold, id)).toBe(sold);
  });

  it('keeps one holding\'s sale when another holding is edited', () => {
    let state = withOther(100, 50);
    state = addOffModel(state);
    const [first, second] = state.portfolio.offModel.map((h) => h.id);
    state = sellOffModel(state, first);
    state = setOffModelField(state, second, 'price', 75);

    expect(state.baseline.offModel?.find((h) => h.id === first)?.shares).toBe(100);
  });

  it('undoes a sale saved before sold rows kept their place', () => {
    // The migrated shape: the row back at nothing held, the old entry carrying the whole holding.
    const base = sampleState();
    const holding = { id: 'o1', sym: 'RBRK', shares: 600, price: 86.65 };
    const state: ExplorerState = {
      ...base,
      portfolio: { ...base.portfolio, cash: 38000 + 51990, offModel: [{ ...holding, shares: 0 }] },
      baseline: { ...base.baseline, offModel: [holding] },
      log: [
        {
          id: 't1', sym: 'RBRK', action: 'SELL', source: 'offModel', stockId: null, shares: 600,
          price: 86.65, amount: 51990, goalShares: null, resultShares: 0, resultIsLot: true,
          partial: false, label: 'sold', cashBefore: 38000, cashAfter: 89990, pctBefore: 0,
          pctAfter: 0, restore: holding,
        },
      ],
    };

    const back = undoLast(state);
    expect(back.portfolio.offModel).toEqual([holding]);
    expect(back.portfolio.cash).toBeCloseTo(38000, 6);
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
    let state = addStock(sampleState(), 'msft');
    const newId = state.portfolio.stocks[state.portfolio.stocks.length - 1].id;
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

  it('uppercases and trims the ticker a stock is added with', () => {
    const state = addStock(sampleState(), ' nvda ');
    expect(state.portfolio.stocks[state.portfolio.stocks.length - 1].sym).toBe('NVDA');
  });
});

describe('reset everything', () => {
  it('undoes every trade and returns holdings to the baseline', () => {
    let state = buy(sampleState(), 'MU');
    state = sell(state, 'MSFT', 'lowlot');
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

  it('keeps the model on the way out, so the next account can reuse it', () => {
    const before = sampleState();
    const carried = closeAccount(before).carried!;

    expect(carried.model.rows.map((r) => r.sym)).toEqual(
      before.portfolio.stocks.map((s) => s.sym),
    );
    expect(carried.model.cashBand).toEqual({
      target: before.portfolio.cashTarget,
      floor: before.portfolio.cashFloor,
      ceiling: before.portfolio.cashCeiling,
    });
    // Prices come too, to seed the preview for positions the next account does not hold.
    for (const s of before.portfolio.stocks) expect(carried.prices[s.sym]).toBe(s.price);
  });

  it('carries the model as edited, not as the file first read it', () => {
    let state = sampleState();
    const id = state.portfolio.stocks[0].id;
    state = setStockField(state, id, 'bandMax', 77);

    const carried = closeAccount(state).carried!;
    expect(carried.model.rows[0].bandMax).toBe(77);
  });

  it('has nothing to carry from a workspace that was already empty', () => {
    expect(closeAccount(closeAccount(sampleState())).carried).toBeUndefined();
    // And a deliberate start-over keeps nothing at all.
    expect(clearAll().carried).toBeUndefined();
  });
});

describe('taking every position to one destination', () => {
  it('lands each row on the same share count its own column shows', () => {
    const before = sampleState();
    const { state, outcome } = tradeAll(before, 'target');

    for (const s of state.portfolio.stocks) {
      const goal = destinationShares(before.portfolio, s, 'target')!;
      expect(s.shares).toBe(goal);
    }
    /* Four, not five: MSFT holds 600 and its target lot is 600, so the press finds nothing to
       do on that row. */
    expect(outcome.traded).toBe(4);
    expect(outcome.noDestination).toBe(0);
  });

  it('leaves total account value where it was, as any trade does', () => {
    const before = sampleState();
    const { state } = tradeAll(before, 'lot-high');
    expect(totalValue(state.portfolio)).toBeCloseTo(totalValue(before.portfolio), 6);
  });

  it('reports rows that were already sitting on the destination', () => {
    const first = tradeAll(sampleState(), 'target');
    // Everything is on target now, so a second press has nothing left to do.
    const second = tradeAll(first.state, 'target');
    expect(second.outcome.traded).toBe(0);
    expect(second.outcome.settled).toBe(5);
    expect(second.state.log).toHaveLength(first.state.log.length);
  });

  it('buys the whole way and lets the cash go negative when it will not cover the move', () => {
    /* X wants ten more shares at $500 and the cash covers three. Y is fixed income — held and
       counted, never traded — so nothing can sell to fund the buy even in principle.

       The advisor gets all ten shares and a cash line of -$3,500 to answer, rather than a row
       left short of its destination on a number nobody asked for. */
    const state: ExplorerState = {
      ...sampleState(),
      portfolio: {
        stocks: [
          { id: 'a', sym: 'X', price: 500, target: 60, bandMin: 50, bandMax: 70, shares: 10 },
          {
            id: 'b',
            sym: 'Y',
            price: 100,
            target: 35,
            bandMin: 30,
            bandMax: 40,
            shares: 100,
            tradeable: false,
          },
        ],
        cash: 1500,
        cashFloor: 3,
        cashTarget: 5,
        cashCeiling: 8,
        offModel: [],
      },
      log: [],
    };

    const { state: after, outcome } = tradeAll(state, 'target');
    const x = after.portfolio.stocks.find((s) => s.sym === 'X')!;

    expect(x.shares).toBe(destinationShares(state.portfolio, state.portfolio.stocks[0], 'target'));
    // Nothing was cut short, so nothing is a partial fill.
    expect(after.log.every((e) => !e.partial)).toBe(true);
    expect(outcome.cashAfter).toBeLessThan(0);
    expect(after.portfolio.cash).toBe(outcome.cashAfter);
  });

  it('never sells one position to fund another', () => {
    /* MSFT is over its target and NVDA is under it, with no cash to bridge them. The old rule
       ran MSFT's sale first precisely so NVDA could spend the proceeds. Now each row answers only
       its own column, and any raising is left to the advisor. */
    const start: ExplorerState = {
      ...sampleState(),
      portfolio: { ...samplePortfolio(), cash: 0 },
      log: [],
    };
    const { state, outcome } = tradeAll(start, 'target');

    for (const s of state.portfolio.stocks) {
      expect(s.shares).toBe(destinationShares(start.portfolio, s, 'target'));
    }
    /* Trades come in table order, not sells-first — and the table is sorted by ticker now, so the
       log reads down the page the way the table does. Built from the same sort rather than a
       written-out list, so it stays true if the model's own order changes. */
    expect(state.log.map((e) => e.sym)).toEqual(
      inDisplayOrder(start.portfolio.stocks)
        .filter((s) => destinationShares(start.portfolio, s, 'target') !== s.shares)
        .map((s) => s.sym),
    );
    expect(state.log.map((e) => e.sym)).toEqual(['AAPL', 'AMZN', 'MSFT', 'MU', 'NVDA']);
    expect(outcome.traded).toBe(state.log.length);
  });

  it('has no destination for a holding the lot rule does not apply to', () => {
    const state: ExplorerState = {
      ...sampleState(),
      portfolio: {
        ...samplePortfolio(),
        stocks: [
          {
            id: 'f',
            sym: 'FUND',
            price: 50,
            target: 10,
            bandMin: 8,
            bandMax: 12,
            shares: 100,
            lotRounding: false,
          },
        ],
      },
      log: [],
    };

    expect(tradeAll(state, 'lot-high').outcome).toMatchObject({ noDestination: 1, traded: 0 });
    // The lot-aware target falls back to the raw count for it, so that destination does exist.
    expect(tradeAll(state, 'target').outcome.noDestination).toBe(0);
  });

  it('says when the buying took cash below its own floor', () => {
    const { outcome } = tradeAll(sampleState(), 'lot-high');
    expect(outcome.belowCashFloor).toBe(true);
  });

  it('still sells a position that sits above the destination, since that is where its column points', () => {
    const before = sampleState();
    const { state } = tradeAll(before, 'lot-low');

    const sold = state.log.filter((e) => e.action === 'SELL');
    expect(sold.length).toBeGreaterThan(0);
    for (const e of sold) {
      // Each sale lands on that row's own lot-low column, never one share beyond it to raise cash.
      expect(e.resultShares).toBe(
        destinationShares(before.portfolio, before.portfolio.stocks.find((s) => s.id === e.stockId)!, 'lot-low'),
      );
    }
  });
});

describe('undoing a whole press', () => {
  it('takes back every trade one universal button made, in one go', () => {
    const before = sampleState();
    const { state } = tradeAll(before, 'target');
    expect(state.log.length).toBe(4);

    const back = undoLast(state);
    expect(back.log).toHaveLength(0);
    expect(back.portfolio.cash).toBeCloseTo(before.portfolio.cash, 6);
    for (const s of back.portfolio.stocks) {
      expect(s.shares).toBe(before.portfolio.stocks.find((x) => x.id === s.id)!.shares);
    }
  });

  it('leaves earlier single trades alone', () => {
    const one = buy(sampleState(), 'MU');
    const { state } = tradeAll(one, 'lot-high');

    const back = undoLast(state);
    expect(back.log).toHaveLength(1);
    expect(back.log[0].batch).toBeUndefined();
    expect(stockOf(back, 'MU').shares).toBe(1000);
  });

  it('counts what the next undo would take back', () => {
    expect(undoSize(sampleState())).toBe(0);
    expect(undoSize(buy(sampleState(), 'MU'))).toBe(1);
    expect(undoSize(tradeAll(sampleState(), 'target').state)).toBe(4);
  });
});
