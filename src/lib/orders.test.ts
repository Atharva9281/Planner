import { describe, expect, it } from 'vitest';
import { applyTrade, resetAll, sellOffModel } from './actions';
import { baselineFrom, sampleState } from './defaultState';
import { planBuy, planSell, planToShares, totalValue } from './engine';
import { netOrders, orderSummary } from './orders';
import { ExplorerState, Portfolio } from './types';

const stock = (s: ExplorerState, sym: string) => s.portfolio.stocks.find((x) => x.sym === sym)!;

const buy = (s: ExplorerState, sym: string, mode: 'target' | 'highlot' | 'rawmax') => {
  const plan = planBuy(s.portfolio, stock(s, sym), mode);
  return plan ? applyTrade(s, plan) : s;
};
const sell = (s: ExplorerState, sym: string, mode: 'target' | 'lowlot' | 'rawmax') => {
  const plan = planSell(s.portfolio, stock(s, sym), mode);
  return plan ? applyTrade(s, plan) : s;
};
const to = (s: ExplorerState, sym: string, shares: number) => {
  const plan = planToShares(s.portfolio, stock(s, sym), shares);
  return plan ? applyTrade(s, plan) : s;
};

describe('what actually has to be traded', () => {
  it('has nothing to report before anything is clicked', () => {
    expect(netOrders(sampleState())).toEqual([]);
  });

  it('states one order per position, however many clicks reached it', () => {
    // Two separate buys of the same position are one instruction to a trading desk.
    let s = sampleState();
    s = buy(s, 'MU', 'target');
    s = buy(s, 'MU', 'rawmax');

    expect(s.log.length).toBe(2);

    const orders = netOrders(s);
    expect(orders).toHaveLength(1);
    expect(orders[0].sym).toBe('MU');
    expect(orders[0].action).toBe('BUY');
    // The two clicks summed, priced once.
    expect(orders[0].shares).toBe(
      s.portfolio.stocks.find((x) => x.sym === 'MU')!.shares - sampleState().portfolio.stocks.find((x) => x.sym === 'MU')!.shares,
    );
    expect(orders[0].amount).toBeCloseTo(orders[0].shares * orders[0].price, 6);
  });

  /** The case the whole change exists for. */
  it('drops a position that was explored and put back', () => {
    let s = sampleState();
    const start = stock(s, 'NVDA').shares;

    s = buy(s, 'NVDA', 'highlot');
    expect(stock(s, 'NVDA').shares).toBeGreaterThan(start);

    s = to(s, 'NVDA', start);

    // Two clicks happened and are still on the log, driving undo.
    expect(s.log.length).toBe(2);
    // But there is no trade to place, so nothing is reported.
    expect(netOrders(s).find((o) => o.sym === 'NVDA')).toBeUndefined();
  });

  it('nets a buy and a partial sell into the direction that remains', () => {
    let s = sampleState();
    const start = stock(s, 'MU').shares;

    s = to(s, 'MU', start + 300);
    s = to(s, 'MU', start + 100);

    const order = netOrders(s).find((o) => o.sym === 'MU')!;
    expect(order.action).toBe('BUY');
    expect(order.shares).toBe(100);
  });

  it('reports a sale as a sell, priced at the position it left', () => {
    let s = sampleState();
    s = sell(s, 'MSFT', 'target');

    const order = netOrders(s).find((o) => o.sym === 'MSFT')!;
    expect(order.action).toBe('SELL');
    expect(order.price).toBe(stock(s, 'MSFT').price);
  });

  it('carries the cash the orders move it between', () => {
    let s = sampleState();
    const opening = s.portfolio.cash;
    s = sell(s, 'MSFT', 'target');

    const summary = orderSummary(s);
    expect(summary.cashBefore).toBe(opening);
    expect(summary.cashAfter).toBe(s.portfolio.cash);
    expect(summary.steps).toBe(1);
  });
});

describe('off-model holdings in the order list', () => {
  const withHolding = (): ExplorerState => {
    const portfolio: Portfolio = {
      stocks: [],
      cash: 10_000,
      cashFloor: 3,
      cashTarget: 5,
      cashCeiling: 8,
      offModel: [{ id: 'o1', sym: 'FLUD', shares: 1000, price: 25 }],
    };
    return { portfolio, baseline: baselineFrom(portfolio), log: [], nextId: 2 };
  };

  it('reports one sold out of the account, though it is no longer in the list', () => {
    const sold = sellOffModel(withHolding(), 'o1');
    const orders = netOrders(sold);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ sym: 'FLUD', action: 'SELL', shares: 1000, amount: 25_000 });
    expect(orders[0].source).toBe('offModel');
  });

  /**
   * Reset used to put the cash back and leave the holding sold, so an account worth $35,000
   * came back as $10,000 with no trade behind the missing $25,000.
   */
  it('is restored by a reset, rather than leaving its value destroyed', () => {
    const start = withHolding();
    const before = totalValue(start.portfolio);

    const back = resetAll(sellOffModel(start, 'o1'));

    expect(totalValue(back.portfolio)).toBe(before);
    expect(back.portfolio.offModel).toHaveLength(1);
    expect(back.portfolio.cash).toBe(10_000);
    expect(netOrders(back)).toEqual([]);
  });
});
