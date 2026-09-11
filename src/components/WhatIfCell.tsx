import { useState } from 'react';
import { afterTrading, sharesForWeight, tradesByWeight, whatIf } from '@/lib/engine';
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
  /**
   * A bond fund is worked in percent of the account, so the box takes one.
   *
   * A destination rather than a movement, which is the opposite of the share box beside it — and
   * deliberately. The three figures on a fund's row are destinations too: its 5.5% floor, its 7.5%
   * target, its 9.5% ceiling. Typing 7 asks for the fourth of those, in the same language, and it
   * needs no minus sign to express a sell: 7 on a position sitting at 9 is a sale.
   */
  const byWeight = tradesByWeight(stock);

  const [draft, setDraft] = useState('');
  /** The number typed. An amount of shares to trade, or a weight to end at. Null until asked. */
  const [asked, setAsked] = useState<number | null>(null);

  const calculate = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) return setAsked(null);
    setAsked(byWeight ? n : n === 0 ? null : Math.trunc(n));
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
  const destination =
    asked === null
      ? null
      : byWeight
        ? sharesForWeight(portfolio, stock, asked)
        : afterTrading(stock, asked);

  const result = destination === null ? null : whatIf(portfolio, stock, destination);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {/* On a share row there is no `min`, because a negative number is how a sell is expressed.
            On a weight row there is one: a holding cannot be a negative share of the account, and
            the direction comes from which side of the figure the position already sits. */}
        <input
          type="number"
          step={byWeight ? '0.1' : '1'}
          min={byWeight ? 0 : undefined}
          className="field w-24 text-right"
          placeholder={byWeight ? '% of acct' : 'shares'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') calculate();
            if (e.key === 'Escape') clear();
          }}
          aria-label={
            byWeight
              ? `Percent of the account to hold in ${stock.sym}`
              : `Shares of ${stock.sym} to buy, or a negative number to sell`
          }
        />
        <button className="btn-amber" disabled={draft.trim() === ''} onClick={calculate}>
          Calculate
        </button>
      </div>

      {/* Said once, under the empty box, rather than only discovered by typing a minus sign. */}
      {!result && (
        <span className="font-sans text-[12px] leading-snug text-ink-soft">
          {byWeight ? 'Percent of the account to hold.' : 'Shares to buy. Use a minus to sell.'}
        </span>
      )}

      {result && (
        <div className="rounded-lg border border-line bg-paper px-2.5 py-2">
          {result.action === null ? (
            <span className="font-sans text-[13px] text-ink-soft">
              {/* Reached by asking to sell more than is held, on a position holding nothing. */}
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
              {/* A sell asked for more than the position holds, so it was cut to the holding. */}
              {result.action === 'SELL' && asked !== null && result.shares < Math.abs(asked) && (
                <p className="sub text-warn">Can only sell {fmtShares(result.shares)} sh</p>
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
