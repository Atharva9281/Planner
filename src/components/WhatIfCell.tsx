import { useState } from 'react';
import { afterTrading, whatIf } from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { Portfolio, Stock } from '@/lib/types';

/**
 * "Buy or sell this many."
 *
 * The advisor types an amount to trade and gets the whole consequence: what it costs, where the
 * holding lands, where cash lands, and what weight the position ends at. Nothing moves until the
 * trade button is pressed, so this is a question you can ask as often as you like.
 *
 * It takes a movement rather than a destination because every figure beside it is a movement:
 * room to the ceiling, shares the cash affords, room to the floor. When this box meant "hold this
 * many", reading 342 out of the ceiling column and typing it against a 379-share position
 * produced a sell of 37 — the right number, the opposite trade, and no warning that it had been
 * misread. The four destination columns still state where the position would land; this states
 * how far to move it, which is what the columns next to it are for.
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
  const [draft, setDraft] = useState('');
  /** The number typed, as an amount to trade. Negative sells. Null when nothing has been asked. */
  const [asked, setAsked] = useState<number | null>(null);

  const calculate = () => {
    const n = Number(draft);
    setAsked(draft.trim() === '' || !Number.isFinite(n) || n === 0 ? null : Math.trunc(n));
  };

  const clear = () => {
    setDraft('');
    setAsked(null);
  };

  /*
   * The box asks for an amount to trade; the engine works in destinations. Converting here rather
   * than in the engine keeps the lot rule, the band checks and the cash clamp exactly as they are.
   *
   * It reads as a delta because that is what the three room columns beside it state — room to the
   * ceiling, shares the cash affords, room to the floor. Reading 342 there and typing it into a
   * box that meant "hold 342" produced a sell of 37 on a 379-share position: the right figure,
   * the opposite trade.
   *
   * A sell is clamped at the whole holding, since there is nothing beyond it to sell.
   */
  const destination = asked === null ? null : afterTrading(stock, asked);

  const result = destination === null ? null : whatIf(portfolio, stock, destination);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {/* No `min`: a negative number is how a sell is expressed here. */}
        <input
          type="number"
          step="1"
          className="field w-24 text-right"
          placeholder="shares"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') calculate();
            if (e.key === 'Escape') clear();
          }}
          aria-label={`Shares of ${stock.sym} to buy, or a negative number to sell`}
        />
        <button className="btn-ghost" disabled={draft.trim() === ''} onClick={calculate}>
          Calculate
        </button>
      </div>

      {/* Said once, under the empty box, rather than only discovered by typing a minus sign. */}
      {!result && (
        <span className="font-sans text-[12px] leading-snug text-ink-soft">
          Shares to buy. Use a minus to sell.
        </span>
      )}

      {result && (
        <div className="rounded-lg border border-line bg-paper px-2.5 py-2">
          {result.action === null ? (
            <span className="font-sans text-[13px] text-ink-soft">
              {/* Reached by asking to sell more than is held, on a position holding nothing. */}
              Nothing to trade — already holding {fmtShares(result.targetShares)} sh.
            </span>
          ) : (
            <>
              <div>
                <span
                  className={`text-[14px] font-bold ${
                    result.action === 'BUY' ? 'text-buy' : 'text-sell'
                  }`}
                >
                  {result.action === 'BUY' ? 'Buy' : 'Sell'} {fmtShares(result.shares)} sh
                </span>
                <span className="sub">
                  {result.action === 'BUY' ? '−' : '+'}
                  {money(result.amount)}
                </span>
              </div>

              {result.partial && (
                <p className="sub text-warn">
                  Cash covers {fmtShares(result.shares)} of {fmtShares(result.requested)} sh.
                </p>
              )}
              {/* A sell asked for more than the position holds, so it was cut to the holding. */}
              {result.action === 'SELL' && asked !== null && result.shares < Math.abs(asked) && (
                <p className="sub text-warn">
                  Only {fmtShares(result.shares)} sh are held, so that is all that can be sold.
                </p>
              )}

              <dl className="mt-2 space-y-0.5 border-t border-line-soft pt-2 font-mono text-[12.5px] tabular-nums">
                {/* Where the position lands. The whole reason the box changed meaning: the number
                    typed is a movement, so the resulting holding has to be stated, not inferred. */}
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Holding</dt>
                  <dd>
                    {fmtShares(stock.shares)} &rarr; {fmtShares(result.targetShares)} sh
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Cash</dt>
                  <dd className={result.cashAfter < 0 ? 'text-sell' : ''}>
                    {money(result.cashBefore)} &rarr; {money(result.cashAfter)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Weight</dt>
                  <dd className={result.withinBand ? '' : 'font-semibold text-sell'}>
                    {pct(result.weightBefore)} &rarr; {pct(result.weightAfter)}
                  </dd>
                </div>
              </dl>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`badge ${
                    result.withinBand ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'
                  }`}
                >
                  {result.withinBand
                    ? 'inside the band'
                    : `outside ${stock.bandMin}–${stock.bandMax}%`}
                </span>
                {result.isLot && <span className="badge bg-buy-soft text-buy">clean lot</span>}
              </div>

              <div className="mt-2.5 flex gap-1.5">
                <button
                  className={result.action === 'BUY' ? 'btn-buy' : 'btn-sell'}
                  onClick={() => {
                    onTrade(stock.id, result.targetShares);
                    clear();
                  }}
                >
                  {result.action === 'BUY' ? 'Buy' : 'Sell'} {fmtShares(result.shares)}
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
