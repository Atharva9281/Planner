'use client';

import { useEffect, useRef } from 'react';
import { cashPct, cashStatus, totalValue } from '@/lib/engine';
import { money, pct } from '@/lib/format';
import { ExplorerState, Portfolio } from '@/lib/types';

interface Props {
  portfolio: Portfolio;
  source: ExplorerState['source'];
  /** True once the real header has scrolled out of view. */
  visible: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onResetAll: () => void;
  onEditHoldings: () => void;
  onEditModel: () => void;
}

/**
 * The header again, compressed, once the real one has scrolled away.
 *
 * Only what a decision needs: what is loaded, the account total, where cash sits against its own
 * target and band, and every button that was up top. The column headers stick directly beneath
 * this bar.
 */
export default function StuckHeader({
  portfolio,
  source,
  visible,
  canUndo,
  onUndo,
  onResetAll,
  onEditHoldings,
  onEditModel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * The table headers stick directly beneath this bar, so its exact height has to be known in CSS.
   * It changes whenever the buttons wrap onto a second line, so it is measured and published
   * rather than hard-coded. While the bar is hidden the height reads 0, which is also correct:
   * with no bar in the way, a column header sticks to the top of the window.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const publish = () =>
      document.documentElement.style.setProperty('--stuck-h', `${el.offsetHeight}px`);

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--stuck-h');
    };
  }, []);

  const total = totalValue(portfolio);
  const cp = cashPct(portfolio);
  const status = cashStatus(portfolio);
  const isSample = source?.kind === 'sample';

  const divider = <span className="text-line-soft select-none">&#124;</span>;
  const caption = 'text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-soft';

  return (
    <div
      ref={ref}
      hidden={!visible}
      className="fixed inset-x-0 top-0 z-40 border-b border-line bg-panel shadow-[0_2px_10px_rgba(20,23,30,0.08)]"
    >
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-2.5 sm:px-7">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={`badge ${isSample ? 'bg-warn text-white' : 'bg-accent-soft text-accent'}`}>
            {isSample ? 'EXAMPLE' : 'LOADED'}
          </span>

          <span className="font-mono text-[16px] font-semibold tabular-nums">{money(total)}</span>
          <span className={caption}>total</span>

          {divider}

          <span
            className={`font-mono text-[16px] font-semibold tabular-nums ${
              status === 'ok' ? 'text-buy' : 'text-warn'
            }`}
          >
            {money(portfolio.cash)}
          </span>
          <span
            className={`font-mono text-[13.5px] tabular-nums ${
              status === 'ok' ? 'text-ink-soft' : 'font-semibold text-warn'
            }`}
          >
            {pct(cp)}
          </span>
          <span className={status === 'ok' ? caption : `${caption} text-warn`}>
            cash
            {status === 'above' && ' · above the band'}
            {status === 'below' && ' · below the band'}
          </span>

          {divider}

          {/* The target the model asks for and the two edges it may drift between, in dollars.
              All three move whenever the account total does, which is the whole reason they are
              worth carrying down the page rather than being read once at the top. */}
          <span className="font-mono text-[15px] tabular-nums text-ink-soft">
            {money((portfolio.cashTarget / 100) * total)}
          </span>
          <span className={caption}>{portfolio.cashTarget}% target</span>

          {divider}

          <span className="font-mono text-[15px] tabular-nums text-ink-soft">
            {money((portfolio.cashCeiling / 100) * total)}
          </span>
          <span className={caption}>{portfolio.cashCeiling}% ceiling</span>

          {divider}

          <span className="font-mono text-[15px] tabular-nums text-ink-soft">
            {money((portfolio.cashFloor / 100) * total)}
          </span>
          <span className={caption}>{portfolio.cashFloor}% floor</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button className="btn-ghost" disabled={!canUndo} onClick={onResetAll}>
            Reset all
          </button>
          <button className="btn-chip" onClick={onEditHoldings}>
            Edit holdings
          </button>
          <button className="btn-chip" onClick={onEditModel}>
            Edit model
          </button>
        </div>
      </div>
    </div>
  );
}
