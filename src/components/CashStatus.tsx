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
    /*
     * Six tracks wide, three narrow, with cash taking two of them either way. A grid rather than a
     * wrapping flex row because flex wrapped the floor tile onto a line of its own and then
     * stretched it across the full width; here the two shapes are 1 + 2 + 1 + 1 + 1 on one row,
     * or 1 + 2 over 1 + 1 + 1 on two. Neither leaves a tile stranded.
     *
     * The tiles own the whole row at every width. They used to share it with the two Edit buttons,
     * which cost about 360px and squeezed the total-account tile below the width of its own
     * figure — that is what was clipping "$562,871.50" at 1366. Those buttons now sit in the page
     * header with Undo and Reset, which is where the compact bar has always kept them.
     */
    <div className="grid grid-cols-3 gap-3 wide:grid-cols-6">
      <div className={tile}>
        <div className={`${figure} text-ink`}>{money(total)}</div>
        <div className={label}>Total account</div>
      </div>

      <div className={`${tile} col-span-2`}>
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

      <div className={tile}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashTarget / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashTarget}% target</div>
      </div>

      <div className={tile}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashCeiling / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashCeiling}% ceiling</div>
      </div>

      <div className={tile}>
        <div className={`${figure} text-ink-soft`}>
          {money((portfolio.cashFloor / 100) * total)}
        </div>
        <div className={label}>{portfolio.cashFloor}% floor</div>
      </div>
    </div>
  );
}
