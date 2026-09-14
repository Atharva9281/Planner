import { useRef, useState } from 'react';
import Modal from './Modal';
import { NumInput, SymInput } from './Inputs';
import { inRankOrder, rankOf, rankTies, rankTiesMessage } from '@/lib/rank';
import { Portfolio, Stock } from '@/lib/types';

type ModelField = 'type' | 'target' | 'bandMin' | 'bandMax';

interface Props {
  portfolio: Portfolio;
  onClose: () => void;
  onField: (stockId: string, field: ModelField, value: string | number) => void;
  onRank: (stockId: string, rank: number) => void;
  onAddStock: (sym: string) => void;
  onRemoveStock: (stockId: string) => void;
  onCashBand: (field: 'cashFloor' | 'cashTarget' | 'cashCeiling', value: number) => void;
  onClearAll: () => void;
}

/*
 * Pinned to the top of the dialog's scrolling body, so a long model never loses its column names.
 * The rule under it is a shadow rather than a border: in a collapsed-border table a sticky cell
 * leaves its border behind with the rows, and the header would scroll away bare. `-top-5` undoes
 * the body's `py-5`: a sticky cell stops at the padding, which left a strip of rows showing above.
 */
const TH =
  'sticky -top-5 z-10 bg-panel shadow-[inset_0_-1px_0_var(--color-line)] px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';
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
  onRank,
  onAddStock,
  onRemoveStock,
  onCashBand,
  onClearAll,
}: Props) {
  const duplicates = duplicateSymbols(portfolio.stocks);
  const targetTotal = portfolio.stocks.reduce((sum, s) => sum + s.target, 0);
  const invalidBand = portfolio.stocks.filter((s) => s.bandMin > s.bandMax);
  const order = inRankOrder(portfolio.stocks);
  const ties = rankTies(portfolio.stocks);

  /*
   * Narrows the rows to the tickers containing what is typed. Only the rows: the conviction order,
   * the target total and the warnings below still read the whole model, because they are
   * statements about all of it.
   */
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? portfolio.stocks.filter((s) => s.sym.toLowerCase().includes(needle))
    : portfolio.stocks;
  const tableRef = useRef<HTMLTableElement>(null);

  /** The ticker a new row will carry. Asked for up front, since the row's ticker is locked. */
  const [newSym, setNewSym] = useState('');
  const addNew = () => {
    if (!newSym.trim()) return;
    // The new row would be hidden by a search that does not match it.
    setQuery('');
    onAddStock(newSym);
    setNewSym('');
  };

  return (
    <Modal
      title="Model: targets and drift bands"
      subtitle="What to hold and in what proportion. Bands are absolute: the floor and ceiling a position may sit between, as a percentage of total account value, and they need not be symmetric around the target. Prices are market data, not model data — they live under Edit starting holdings."
      onClose={onClose}
      footer={
        <>
          {portfolio.stocks.length > 0 ? (
            <button
              className="btn-ghost hover:border-danger hover:text-danger"
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
        <div className="modal-section items-center">
          <div className="flex items-center gap-3">
            <h3>Stocks</h3>
            {portfolio.stocks.length > 0 && (
              <>
                <input
                  type="search"
                  className="field w-52 py-1.5 font-sans"
                  placeholder="Search ticker"
                  aria-label="Search the model by ticker"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Straight to the rank box of the first match, which is what the search is for.
                    if (e.key === 'Enter') {
                      const rank =
                        tableRef.current?.querySelector<HTMLInputElement>('tbody tr input');
                      rank?.focus();
                      rank?.select();
                    }
                    // Clears the search rather than closing the dialog, while there is one to clear.
                    if (e.key === 'Escape' && query) {
                      e.stopPropagation();
                      setQuery('');
                    }
                  }}
                />
                {needle && (
                  <span className="text-[13px] text-ink-soft">
                    {shown.length} of {portfolio.stocks.length}
                  </span>
                )}
              </>
            )}
          </div>
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
          <table ref={tableRef} className="w-full border-collapse">
            <thead>
              <tr>
                {/* First, because it is the one column here that is read down rather than across:
                    the order is a property of the list, not of any one row in it. */}
                <th className={TH} title="Order of conviction for the ranked deployment. 1 has first call on the cash. Leave blank to take no view.">
                  Rank
                </th>
                <th className={TH}>Symbol</th>
                <th className={TH}>Type</th>
                <th className={TH}>Target %</th>
                <th className={TH}>Band floor %</th>
                <th className={TH}>Band ceiling %</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className={`${TD} py-5 text-center text-[13.5px] text-ink-soft`}>
                    No ticker matches “{query.trim()}”.
                  </td>
                </tr>
              )}
              {shown.map((s) => {
                const bad = s.bandMin > s.bandMax;
                const tie = ties.find((t) => t.rank === rankOf(s));
                return (
                  <tr key={s.id}>
                    <td className={`${TD} w-16`}>
                      <NumInput
                        className={`field text-center ${
                          tie
                            ? 'border-danger font-bold text-danger'
                            : rankOf(s) > 0
                              ? 'border-accent font-bold text-accent'
                              : ''
                        }`}
                        value={rankOf(s)}
                        blankZero
                        placeholder="—"
                        title={
                          tie
                            ? `Rank ${tie.rank} is also used by ${tie.syms.filter((x) => x !== s.sym).join(', ')}. Each rank can go to only one stock.`
                            : `Where ${s.sym} sits in the conviction order. 1 is first call on the cash; blank leaves it at its band floor.`
                        }
                        onCommit={(v) => onRank(s.id, v)}
                      />
                    </td>
                    {/* Locked. The ticker is what the row is, so it is read, never edited. */}
                    <td className={`${TD} w-28 font-sans text-[14px] font-bold`}>{s.sym}</td>
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
                        className={`field text-right ${bad ? 'border-danger text-danger' : ''}`}
                        step="0.5"
                        value={s.bandMin}
                        onCommit={(v) => onField(s.id, 'bandMin', v)}
                      />
                    </td>
                    <td className={TD}>
                      <NumInput
                        className={`field text-right ${bad ? 'border-danger text-danger' : ''}`}
                        step="0.5"
                        value={s.bandMax}
                        onCommit={(v) => onField(s.id, 'bandMax', v)}
                      />
                    </td>
                    <td className={`${TD} w-10 text-right`}>
                      <button
                        className="rounded px-1.5 text-lg leading-none text-ink-faint transition-colors hover:text-danger"
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

        <div className="mt-3 flex items-center justify-end gap-2">
          <input
            className="field w-32 py-1.5 font-sans font-bold uppercase placeholder:font-normal placeholder:normal-case"
            placeholder="Ticker"
            aria-label="Ticker of the stock to add"
            autoFocus={portfolio.stocks.length === 0}
            value={newSym}
            onChange={(e) => setNewSym(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNew();
            }}
          />
          <button
            className="btn-chip disabled:opacity-45"
            disabled={!newSym.trim()}
            onClick={addNew}
          >
            + Add stock
          </button>
        </div>

        {/* The order read back as a sentence. Twenty rank boxes down a column are hard to read as
            a sequence, and the sequence is the thing being decided — this is the one place it can
            be checked at a glance before the run acts on it. Not while ranks are tied: it numbers
            the run's order 1, 2, 3, so two stocks both ranked 5 would read here as 1 and 2. */}
        {portfolio.stocks.length > 0 && ties.length === 0 && (
          <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {order.length === 0 ? (
              <>
                Nothing is ranked, so the deployment run has nowhere to put the cash. Number the
                positions you have a view on — 1 gets first call on the money, then 2, then 3.
                Everything left blank is taken to its band floor and held there.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">Conviction order:</span>{' '}
                <span className="font-mono text-[12.5px]">
                  {order.map((s, i) => `${i + 1}. ${s.sym}`).join('   ')}
                </span>
                {'. '}
                The other {portfolio.stocks.length - order.length} go to their band floor and stay
                there.
              </>
            )}
          </p>
        )}

        {ties.length > 0 && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-semibold leading-relaxed text-danger"
          >
            {rankTiesMessage(ties)} Deploy by rank is off until they are different.
          </p>
        )}

        {invalidBand.length > 0 && (
          <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] leading-relaxed text-danger">
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
