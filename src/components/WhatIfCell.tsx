import { useState } from 'react';
import { sharesForWeight, tradesByWeight, whatIf } from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { Portfolio, Stock } from '@/lib/types';
import { dropFocusOnWheel } from './Inputs';

/**
 * "I want to hold this many."
 *
 * The advisor types the holding he wants and gets the whole consequence: whether that is a buy or
 * a sell, how many shares it moves, what it costs, where cash lands, and what weight the position
 * ends at. Nothing moves until the trade button is pressed, so this is a question you can ask as
 * often as you like.
 *
 * It takes a destination because every holding figure beside it is one — target holdings, the lot
 * to target, the lots to each band edge. The direction is worked out from which side of the
 * current holding the typed number sits, so there is no minus sign to remember.
 *
 * An amount that would leave the band is priced and flagged rather than refused — exploring is not
 * the same as proposing, and refusing to answer would just send the advisor to a calculator.
 */
export default function WhatIfCell({
  portfolio,
  stock,
  onTrade,
}: {
  portfolio: Portfolio;
  stock: Stock;
  onTrade: (stockId: string, targetShares: number) => void;
}) {
  /**
   * A bond fund is worked in percent of the account, so the box takes one.
   *
   * A destination, the same as the share box: its 5.5% floor, 7.5% target and 9.5% ceiling are
   * destinations too, and typing 7 asks for the fourth of those. 7 on a position sitting at 9 is a
   * sale.
   */
  const byWeight = tradesByWeight(stock);

  const [draft, setDraft] = useState('');
  /** The number typed. A share count or a weight to end at. Null until asked. */
  const [asked, setAsked] = useState<number | null>(null);

  // Zero is a real answer on both kinds of row: sell the whole position.
  const calculate = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) return setAsked(null);
    setAsked(byWeight ? n : Math.trunc(n));
  };

  const clear = () => {
    setDraft('');
    setAsked(null);
  };

  const destination =
    asked === null ? null : byWeight ? sharesForWeight(portfolio, stock, asked) : asked;

  const result = destination === null ? null : whatIf(portfolio, stock, destination);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {/* `min` on both: a holding cannot be negative, and the direction comes from which side
            of the current holding the number sits. */}
        <input
          type="number"
          step={byWeight ? '0.1' : '1'}
          min={0}
          className="field w-24 text-right"
          placeholder={byWeight ? '% of acct' : 'shares'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onWheel={dropFocusOnWheel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') calculate();
            if (e.key === 'Escape') clear();
          }}
          aria-label={
            byWeight
              ? `Percent of the account to hold in ${stock.sym}`
              : `Shares of ${stock.sym} to hold`
          }
        />
        <button className="btn-amber" disabled={draft.trim() === ''} onClick={calculate}>
          Calculate
        </button>
      </div>

      {/* Said once, under the empty box. */}
      {!result && (
        <span className="font-sans text-[12px] leading-snug text-ink-soft">
          {byWeight ? 'Percent of the account to hold.' : 'Shares you want to hold.'}
        </span>
      )}

      {result && (
        <div className="rounded-lg border border-line bg-paper px-2.5 py-2">
          {result.action === null ? (
            <span className="font-sans text-[13px] text-ink-soft">
              {/* Reached by typing the holding the position already has. */}
              Nothing to trade — already holding{' '}
              {byWeight
                ? money(result.targetShares * stock.price)
                : `${fmtShares(result.targetShares)} sh`}
              .
            </span>
          ) : (
            <>
              <div>
                <span
                  className={`text-[14px] font-bold ${
                    result.action === 'BUY' ? 'text-buy' : 'text-sell'
                  }`}
                >
                  {result.action === 'BUY' ? 'Buy' : 'Sell'}{' '}
                  {byWeight ? money(result.amount) : `${fmtShares(result.shares)} sh`}
                </span>
                {/* No sign in front of it. The line above already says Buy or Sell, and the
                    colour says it a second time — a third statement in a minus sign only made the
                    figure harder to read. */}
                <span
                  className={`sub font-semibold ${
                    result.action === 'BUY' ? 'text-buy' : 'text-sell'
                  }`}
                >
                  {byWeight ? `${fmtShares(result.shares)} sh` : money(result.amount)}
                </span>
              </div>

              {result.partial && (
                <p className="sub text-warn">
                  Cash covers {fmtShares(result.shares)} of {fmtShares(result.requested)} sh.
                </p>
              )}

              {/* Where the trade lands, and only that.
                  Each line used to carry "before → after". The before figures are all on the page
                  already — the holding two columns to the left, the cash in its own tile, the
                  weight beside the holding — so the arrow spent three lines restating what was
                  already visible, and in this narrow column each one wrapped onto two. */}
              <dl className="mt-2 space-y-0.5 border-t border-line-soft pt-2 font-mono text-[12.5px] tabular-nums">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Total</dt>
                  <dd>
                    {byWeight
                      ? money(result.targetShares * stock.price)
                      : `${fmtShares(result.targetShares)} sh`}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Cash</dt>
                  <dd className={result.cashAfter < 0 ? 'text-danger' : ''}>
                    {money(result.cashAfter)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Weight</dt>
                  <dd className={result.withinBand ? '' : 'font-semibold text-danger'}>
                    {pct(result.weightAfter)}
                  </dd>
                </div>
              </dl>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`badge ${
                    result.withinBand ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'
                  }`}
                >
                  {result.withinBand
                    ? 'inside the band'
                    : `outside ${stock.bandMin}–${stock.bandMax}%`}
                </span>
                {/* Meaningless on a fund, which is not bought on the 100-share grid at all. */}
                {!byWeight && result.isLot && (
                  <span className="badge bg-ok-soft text-ok">clean lot</span>
                )}
              </div>

              <div className="mt-2.5 flex gap-1.5">
                <button
                  className={result.action === 'BUY' ? 'btn-buy' : 'btn-sell'}
                  onClick={() => {
                    onTrade(stock.id, result.targetShares);
                    clear();
                  }}
                >
                  {result.action === 'BUY' ? 'Buy' : 'Sell'}{' '}
                  {byWeight ? money(result.amount) : fmtShares(result.shares)}
                </button>
                <button className="btn-ghost" onClick={clear}>
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
