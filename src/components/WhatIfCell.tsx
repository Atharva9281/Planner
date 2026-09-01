import { useState } from 'react';
import { whatIf } from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { Portfolio, Stock } from '@/lib/types';

/**
 * "What if I held this many?"
 *
 * The advisor types a share count and gets the whole consequence: the net buy or sell, what it
 * costs, where cash lands and what weight the position ends at. Nothing moves until Trade is
 * pressed, so this is a question you can ask as often as you like.
 *
 * A count that would leave the band is priced and flagged rather than refused — exploring is not
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
  const [asked, setAsked] = useState<number | null>(null);

  const calculate = () => {
    const n = Number(draft);
    setAsked(draft.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.floor(n));
  };

  const clear = () => {
    setDraft('');
    setAsked(null);
  };

  const result = asked === null ? null : whatIf(portfolio, stock, asked);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step="1"
          className="field w-24 text-right"
          placeholder="shares"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') calculate();
            if (e.key === 'Escape') clear();
          }}
          aria-label={`Shares of ${stock.sym} to hold`}
        />
        <button className="btn-ghost" disabled={draft.trim() === ''} onClick={calculate}>
          Calculate
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-line bg-paper px-2.5 py-2">
          {result.action === null ? (
            <span className="font-sans text-[13px] text-ink-soft">
              Already holding {fmtShares(result.targetShares)} sh.
            </span>
          ) : (
            <>
              <div>
                <span
                  className={`text-[14px] font-bold ${
                    result.action === 'BUY' ? 'text-buy' : 'text-sell'
                  }`}
                >
                  {result.action === 'BUY' ? 'Net buy' : 'Net sell'} {fmtShares(result.shares)} sh
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

              <dl className="mt-2 space-y-0.5 border-t border-line-soft pt-2 font-mono text-[12.5px] tabular-nums">
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
                  Trade to {fmtShares(result.targetShares)}
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
