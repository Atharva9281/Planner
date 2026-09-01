import BandBar from './BandBar';
import { cashPct, cashStatus, totalValue } from '@/lib/engine';
import { money, pct } from '@/lib/format';
import { Portfolio } from '@/lib/types';

/**
 * The figures every decision is measured against, with cash drawn against its own band in the
 * same visual language as the holdings below it. The tile turns amber against the band that is
 * actually configured, never a fixed 3–8%, and the target beside it is the model's own cash
 * allocation rather than the midpoint of the band.
 */
export default function CashStatus({ portfolio }: { portfolio: Portfolio }) {
  const total = totalValue(portfolio);
  const cp = cashPct(portfolio);
  const status = cashStatus(portfolio);

  const tile = 'rounded-xl border border-line bg-panel px-5 py-4';
  const label = 'mt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';
  const figure = 'font-mono text-[22px] font-semibold leading-none tabular-nums';

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <div className={`${tile} min-w-[9rem] flex-1`}>
        <div className={`${figure} text-ink`}>{money(total)}</div>
        <div className={label}>Total account</div>
      </div>

      <div className={`${tile} min-w-[15rem] flex-[2]`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className={`${figure} ${status === 'ok' ? 'text-buy' : 'text-warn'}`}>
            {money(portfolio.cash)}
          </div>
          <div
            className={`font-mono text-[14px] tabular-nums ${
              status === 'ok' ? 'text-ink-soft' : 'font-semibold text-warn'
            }`}
          >
            {pct(cp)}
          </div>
        </div>
        <div className={label}>
          Cash
          {status === 'above' && ' · above the band'}
          {status === 'below' && ' · below the band'}
        </div>
        {/* The ring is the model's cash target, the same language the holdings rows use. */}
        <BandBar
          className="mt-2 w-full"
          bandMin={portfolio.cashFloor}
          bandMax={portfolio.cashCeiling}
          weight={cp}
          goalWeight={portfolio.cashTarget}
          breached={status !== 'ok'}
        />
      </div>

      <div className={`${tile} min-w-[9rem] flex-1`}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashTarget / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashTarget}% target</div>
      </div>

      <div className={`${tile} min-w-[9rem] flex-1`}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashCeiling / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashCeiling}% ceiling</div>
      </div>

      <div className={`${tile} min-w-[9rem] flex-1`}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashFloor / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashFloor}% floor</div>
      </div>
    </div>
  );
}
