import Modal from './Modal';
import { NumInput, SymInput } from './Inputs';
import { Portfolio, Stock } from '@/lib/types';

type ModelField = 'sym' | 'type' | 'target' | 'bandMin' | 'bandMax';

interface Props {
  portfolio: Portfolio;
  onClose: () => void;
  onField: (stockId: string, field: ModelField, value: string | number) => void;
  onAddStock: () => void;
  onRemoveStock: (stockId: string) => void;
  onCashBand: (field: 'cashFloor' | 'cashTarget' | 'cashCeiling', value: number) => void;
  onClearAll: () => void;
}

const TH =
  'border-b border-line px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';
const TD = 'border-b border-line-soft px-2 py-2.5 align-middle';

/** Symbols on more than one row. Each row is still its own position, but the advisor should know
 *  the two will read as one holding on any statement. */
function duplicateSymbols(stocks: Stock[]): string[] {
  const seen = new Map<string, number>();
  stocks.forEach((s) => seen.set(s.sym, (seen.get(s.sym) ?? 0) + 1));
  return [...seen.entries()].filter(([, n]) => n > 1).map(([sym]) => sym);
}

export default function ModelModal({
  portfolio,
  onClose,
  onField,
  onAddStock,
  onRemoveStock,
  onCashBand,
  onClearAll,
}: Props) {
  const duplicates = duplicateSymbols(portfolio.stocks);
  const targetTotal = portfolio.stocks.reduce((sum, s) => sum + s.target, 0);
  const invalidBand = portfolio.stocks.filter((s) => s.bandMin > s.bandMax);

  return (
    <Modal
      title="Model: targets and drift bands"
      subtitle="What to hold and in what proportion. Bands are absolute: the floor and ceiling a position may sit between, as a percentage of total account value, and they need not be symmetric around the target. Prices are market data, not model data — they live under Edit starting holdings."
      onClose={onClose}
      footer={
        <>
          {portfolio.stocks.length > 0 ? (
            <button
              className="btn-ghost hover:border-sell hover:text-sell"
              onClick={onClearAll}
            >
              Clear the whole portfolio
            </button>
          ) : (
            <span />
          )}
          <button className="btn-solid" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <section className="mb-8">
        <div className="modal-section">
          <h3>Stocks</h3>
          {/* Stated, not judged. A cash band carries no target, so there is no honest total to
              check this against until a model file supplies one. */}
          {portfolio.stocks.length > 0 && (
            <span className="font-mono text-[12.5px] tabular-nums text-ink-soft">
              stock targets total {targetTotal.toFixed(1)}%
            </span>
          )}
        </div>

        {portfolio.stocks.length === 0 ? (
          <p className="rounded-lg bg-paper px-4 py-6 text-center text-[13.5px] text-ink-soft">
            No stocks yet. Add one to begin.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Symbol</th>
                <th className={TH}>Type</th>
                <th className={TH}>Target %</th>
                <th className={TH}>Band floor %</th>
                <th className={TH}>Band ceiling %</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {portfolio.stocks.map((s) => {
                const bad = s.bandMin > s.bandMax;
                return (
                  <tr key={s.id}>
                    <td className={`${TD} w-28`}>
                      <SymInput
                        className="field font-sans font-bold"
                        value={s.sym}
                        onCommit={(v) => onField(s.id, 'sym', v)}
                      />
                    </td>
                    {/* The sleeve, straight from the export. Descriptive, so it is text rather
                        than a number and nothing computes against it. */}
                    <td className={`${TD} w-52`}>
                      <SymInput
                        className="field font-sans text-[13px]"
                        value={s.type ?? ''}
                        onCommit={(v) => onField(s.id, 'type', v)}
                      />
                    </td>
                    <td className={TD}>
                      <NumInput
                        className="field text-right"
                        step="0.5"
                        value={s.target}
                        onCommit={(v) => onField(s.id, 'target', v)}
                      />
                    </td>
                    <td className={TD}>
                      <NumInput
                        className={`field text-right ${bad ? 'border-sell text-sell' : ''}`}
                        step="0.5"
                        value={s.bandMin}
                        onCommit={(v) => onField(s.id, 'bandMin', v)}
                      />
                    </td>
                    <td className={TD}>
                      <NumInput
                        className={`field text-right ${bad ? 'border-sell text-sell' : ''}`}
                        step="0.5"
                        value={s.bandMax}
                        onCommit={(v) => onField(s.id, 'bandMax', v)}
                      />
                    </td>
                    <td className={`${TD} w-10 text-right`}>
                      <button
                        className="rounded px-1.5 text-lg leading-none text-ink-faint transition-colors hover:text-sell"
                        title={`Remove ${s.sym} from the model`}
                        onClick={() => onRemoveStock(s.id)}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="mt-3 flex justify-end">
          <button className="btn-chip" onClick={onAddStock}>
            + Add stock
          </button>
        </div>

        {invalidBand.length > 0 && (
          <p className="mt-3 rounded-lg bg-sell-soft px-3 py-2 text-[13px] leading-relaxed text-sell">
            {invalidBand.map((s) => s.sym).join(', ')} has a floor above its ceiling, so no share
            count can satisfy the band and nothing will be tradeable.
          </p>
        )}

        {duplicates.length > 0 && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn">
            {duplicates.join(', ')} {duplicates.length === 1 ? 'appears' : 'appear'} on more than
            one row. Each row is tracked as its own position, so the shares are not combined.
          </p>
        )}
      </section>

      <section>
        <div className="modal-section">
          <h3>Cash band</h3>
        </div>
        {/* All three come off the model export's USD CASH row: Allocation % is the target,
            Min and Max Drift % the two edges. */}
        <div className="flex max-w-xl gap-4">
          <label className="flex-1">
            <span className="field-label mb-1.5">Floor %</span>
            <NumInput
              className="field text-right"
              step="0.5"
              value={portfolio.cashFloor}
              onCommit={(v) => onCashBand('cashFloor', v)}
            />
          </label>
          <label className="flex-1">
            <span className="field-label mb-1.5">Target %</span>
            <NumInput
              className="field text-right"
              step="0.5"
              value={portfolio.cashTarget}
              onCommit={(v) => onCashBand('cashTarget', v)}
            />
          </label>
          <label className="flex-1">
            <span className="field-label mb-1.5">Ceiling %</span>
            <NumInput
              className="field text-right"
              step="0.5"
              value={portfolio.cashCeiling}
              onCommit={(v) => onCashBand('cashCeiling', v)}
            />
          </label>
        </div>
        <p className="mt-2.5 max-w-lg text-[13px] leading-relaxed text-ink-soft">
          Advisory only. Cash falling outside this band is flagged in the trade log, and the
          target is shown beside the balance; no trade is ever generated to reach either.
        </p>
      </section>
    </Modal>
  );
}
