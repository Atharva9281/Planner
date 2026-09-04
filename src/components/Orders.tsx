'use client';

import { useState } from 'react';
import { orderSummary } from '@/lib/orders';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { ExplorerState, LogEntry, Portfolio } from '@/lib/types';

/**
 * What has to be traded, with the clicking that produced it folded away behind a toggle.
 *
 * The table upstairs is for exploring — try a lot, try the raw maximum, change your mind. Those
 * clicks are not decisions and reporting them as decisions was actively misleading: a position
 * bought and sold back appeared as two trades nobody should place. So the headline is the diff
 * between where the account started and where it now stands, which is the thing a trading desk
 * can act on.
 *
 * The steps remain available rather than deleted. They are how the app answers "how did this
 * number happen", and they are the only record if anyone ever has to retrace a session.
 */
export default function Orders({ state }: { state: ExplorerState }) {
  const [showSteps, setShowSteps] = useState(false);
  const { orders, cashBefore, cashAfter, steps } = orderSummary(state);

  /* Where cash sits once every one of these orders has been placed. The same figure on every
     row, deliberately: these are net orders with no sequence to run in, so a per-row balance
     would be inventing an order of execution the tool never decided. */
  const cashPercent = cashPctOf(cashAfter, state.portfolio);

  if (orders.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[14px] text-ink-soft">
        {steps === 0
          ? 'Nothing to trade yet. Use the buttons above.'
          : /* Every click has been undone, or cancelled out by a later one. Worth saying
               plainly: an empty list after a busy session reads like a fault otherwise. */
            `Nothing to trade. The ${steps} step${steps === 1 ? '' : 's'} so far cancel out — every position is back where it started.`}
      </p>
    );
  }

  return (
    <>
      <div className="table-stick">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th th-lead rounded-tl-lg">Symbol</th>
              <th className="th">Action</th>
              <th className="th text-right">Shares</th>
              <th className="th text-right">Opening</th>
              <th className="th th-lead text-right">Total</th>
              <th className="th text-right">Price</th>
              <th className="th text-right">Amount</th>
              <th className="th th-lead text-right">Cash</th>
              <th className="th text-right">Cash %</th>
              <th className="th rounded-tr-lg">Note</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={`${o.sym}-${i}`} className={i % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                <td className="td font-sans text-[14px] font-bold">{o.sym}</td>
                <td className="td">
                  <span
                    className={`font-sans text-[13.5px] font-bold ${
                      o.action === 'BUY' ? 'text-buy' : 'text-sell'
                    }`}
                  >
                    {o.action}
                  </span>
                </td>
                <td className="td text-right font-semibold">{fmtShares(o.shares)}</td>
                <td className="td text-right text-ink-soft">{fmtShares(o.openingShares)}</td>
                <td className="td text-right font-semibold">{fmtShares(o.resultingShares)}</td>
                <td className="td text-right">{money(o.price)}</td>
                <td className="td text-right font-semibold">{money(o.amount)}</td>
                {/* Signed by what it does to the balance, and coloured to match: money out on a
                    buy, money in on a sell. */}
                <td
                  className={`td text-right font-semibold ${
                    o.cash < 0 ? 'text-sell' : 'text-buy'
                  }`}
                >
                  {o.cash < 0 ? '−' : '+'}
                  {money(Math.abs(o.cash))}
                </td>
                <td className="td text-right text-ink-soft">{pct(cashPercent)}</td>
                <td className="td text-[13px] whitespace-normal text-ink-soft">
                  {o.source === 'offModel'
                    ? 'Not in the model. Sold entire, proceeds to cash.'
                    : o.shares % 100 === 0
                      ? 'A clean lot.'
                      : 'Not a round lot.'}
                </td>
              </tr>
            ))}

            {/* Where the cash lands. On the same table so it prints and copies with the orders,
                rather than being a caption that gets left behind. */}
            <tr className="bg-paper">
              <td className="td font-sans text-[13px] font-semibold text-ink-soft" colSpan={7}>
                Cash after these orders
              </td>
              <td className="td text-right font-mono text-[13.5px] font-semibold tabular-nums">
                {money(cashAfter)}
              </td>
              <td className="td text-right font-mono text-[13px] tabular-nums text-ink-soft">
                {pct(cashPercent)}
              </td>
              <td className="td text-[13px] text-ink-soft">from {money(cashBefore)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-[13px] text-ink-soft">
          {orders.length} order{orders.length === 1 ? '' : 's'} from {steps} step
          {steps === 1 ? '' : 's'}. Only where each position ended up is reported, so exploring
          costs nothing.
        </p>
        {steps > 0 && (
          <button className="btn-ghost" onClick={() => setShowSteps((v) => !v)}>
            {showSteps ? 'Hide the steps' : `Show the ${steps} steps behind these`}
          </button>
        )}
      </div>

      {showSteps && <Steps log={state.log} portfolio={state.portfolio} />}
    </>
  );
}

/** Cash as a percent of the account it sits in, without recomputing the whole engine for a caption. */
function cashPctOf(cash: number, p: Portfolio): number {
  const total =
    p.cash +
    p.stocks.reduce((v, s) => v + s.shares * s.price, 0) +
    p.offModel.reduce((v, h) => v + h.shares * h.price, 0);
  return total > 0 ? (cash / total) * 100 : 0;
}

/**
 * The session as it actually happened, oldest first. Secondary by design: this answers "how did
 * we get here", never "what should be traded".
 */
function Steps({ log, portfolio }: { log: LogEntry[]; portfolio: Portfolio }) {
  return (
    <div className="border-t border-line">
      <div className="px-4 pt-4 pb-2">
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-soft">
          Every step, in the order it was taken
        </h3>
        <p className="mt-1 max-w-[64rem] text-[13px] leading-relaxed text-ink-soft">
          Exploration, not instruction. Steps that cancel out are still here, and are deliberately
          absent from the orders above.
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th">#</th>
            <th className="th th-lead">Action</th>
            <th className="th th-lead">Symbol</th>
            <th className="th text-right">Shares</th>
            <th className="th text-right">Amount</th>
            <th className="th text-right">Ends at</th>
            <th className="th text-right">Cash after</th>
            <th className="th">What it was</th>
          </tr>
        </thead>
        <tbody>
          {log.map((e, i) => (
            <tr key={e.id} className={i % 2 ? 'bg-panel-alt' : 'bg-panel'}>
              <td className="td text-ink-faint">{i + 1}</td>
              <td className="td">
                <span
                  className={`font-sans text-[13.5px] font-bold ${
                    e.action === 'BUY' ? 'text-buy' : 'text-sell'
                  }`}
                >
                  {e.action}
                </span>
              </td>
              <td className="td font-sans text-[14px] font-bold">{e.sym}</td>
              <td className="td text-right">{fmtShares(e.shares)}</td>
              <td className="td text-right">{money(e.amount)}</td>
              <td className="td text-right">
                {e.source === 'model' ? `${fmtShares(e.resultShares)} sh` : '0 sh'}
              </td>
              <td className="td text-right text-ink-soft">{money(e.cashAfter)}</td>
              <td className="td text-[13px] whitespace-normal text-ink-soft">
                {e.label}
                {e.partial && (
                  <span className="sub font-semibold text-warn">
                    Partial fill: cash ran out before the full amount could be bought.
                  </span>
                )}
                {e.pctAfter > portfolio.cashCeiling && (
                  <span className="sub text-warn">
                    Left cash above the {portfolio.cashCeiling}% ceiling.
                  </span>
                )}
                {e.pctAfter < portfolio.cashFloor && (
                  <span className="sub text-warn">
                    Left cash below the {portfolio.cashFloor}% floor.
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
