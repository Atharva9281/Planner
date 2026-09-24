import { useRef, useState } from 'react';
import Modal from './Modal';
import { dropFocusOnWheel, NumInput } from './Inputs';
import { modelErrors } from '@/lib/modelCheck';
import { inRankOrder, rankOf, rankTies, rankTiesMessage } from '@/lib/rank';
import { Portfolio, Stock } from '@/lib/types';

type ModelField = 'type' | 'target' | 'bandMin' | 'bandMax';

interface Props {
  portfolio: Portfolio;
  onClose: () => void;
  onField: (stockId: string, field: ModelField, value: string | number) => void;
  onRank: (stockId: string, rank: number) => void;
  onAddStock: (sym: string, price: number) => void;
  onRemoveStock: (stockId: string) => void;
  onCashBand: (field: 'cashFloor' | 'cashTarget' | 'cashCeiling', value: number) => void;
  /** Takes back the last edit made since the dialog opened. */
  onUndo: () => void;
  /** How many edits there are to take back. */
  undoable: number;
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

/** The sleeves a model export uses. Any other one found in the model is offered as well. */
const SLEEVES = ['Stocks / ETFs Sleeve', 'Fixed Income Sleeve'];

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
  onUndo,
  undoable,
}: Props) {
  const duplicates = duplicateSymbols(portfolio.stocks);
  const targetTotal = portfolio.stocks.reduce((sum, s) => sum + s.target, 0);
  const sleeves = [
    ...new Set([...SLEEVES, ...portfolio.stocks.map((s) => s.type ?? '').filter(Boolean)]),
  ];
  /* The dialog will not close on a model that does not add up. An empty model is let go, so
     opening the editor to look is never a trap. */
  const errors = portfolio.stocks.length > 0 ? modelErrors(portfolio) : [];
  const locked = errors.length > 0;
  const cashBad = !(portfolio.cashFloor <= portfolio.cashTarget && portfolio.cashTarget <= portfolio.cashCeiling);
  const order = inRankOrder(portfolio.stocks);
  const ties = rankTies(portfolio.stocks);

  /*
   * Narrows the rows to the tickers containing what is typed. Only the rows: the order of priority,
   * the target total and the warnings below still read the whole model, because they are
   * statements about all of it.
   */
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? portfolio.stocks.filter((s) => s.sym.toLowerCase().includes(needle))
    : portfolio.stocks;
  const tableRef = useRef<HTMLTableElement>(null);

  /** The ticker and price a new row will carry, both asked for up front since neither can be
   *  changed on the row afterwards. */
  const [newSym, setNewSym] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const canAdd = newSym.trim() !== '' && Number(newPrice) > 0;
  const addNew = () => {
    if (!canAdd) return;
    // The new row would be hidden by a search that does not match it.
    setQuery('');
    onAddStock(newSym, Number(newPrice));
    setNewSym('');
    setNewPrice('');
  };

  return (
    <Modal
      title="Model Holdings and Drift Band"
      subtitle="Target, band floor % and band ceiling % are derived from the uploaded sheets and can be modified as needed. Holdings can be added or deleted on this page. Holdings can also be ranked for automatic portfolio optimization."
      onClose={onClose}
      locked={locked}
      footer={
        <>
          {/* Every edit in this dialog, one at a time, back to how it was when the dialog opened.
              Trades have their own Undo in the page header; nothing here touches them. */}
          <button className="btn-outline" disabled={undoable === 0} onClick={onUndo}>
            Undo
          </button>
          <button
            className="btn-solid"
            disabled={locked}
            title={locked ? 'Fix the errors in red before closing.' : undefined}
            onClick={onClose}
          >
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
                <th className={TH} title="Order of priority for the automatic optimizer. 1 goes first. Leave blank and the position goes to its band floor and is not optimized.">
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
                const bad = !(s.bandMin <= s.target && s.target <= s.bandMax);
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
                            : `Where ${s.sym} sits in the order of priority. 1 goes first; blank takes it to its band floor, not optimized.`
                        }
                        onCommit={(v) => onRank(s.id, v)}
                      />
                    </td>
                    {/* Locked. The ticker is what the row is, so it is read, never edited. */}
                    <td className={`${TD} w-28 font-sans text-[14px] font-bold`}>{s.sym}</td>
                    {/* The sleeve, straight from the export. Descriptive, so it is text rather
                        than a number and nothing computes against it. */}
                    <td className={`${TD} w-52`}>
                      <select
                        className="field font-sans text-[13px]"
                        value={s.type ?? ''}
                        onChange={(e) => onField(s.id, 'type', e.target.value)}
                      >
                        {!s.type && <option value="">—</option>}
                        {sleeves.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={TD}>
                      <NumInput
                        className={`field text-right ${bad ? 'border-danger text-danger' : ''}`}
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
          <input
            type="number"
            step="0.01"
            min="0"
            className="field w-32 py-1.5 text-right placeholder:font-sans"
            placeholder="Price $"
            aria-label="Price of the stock to add"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            onWheel={dropFocusOnWheel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNew();
            }}
          />
          <button
            className="btn-chip disabled:opacity-45"
            disabled={!canAdd}
            title={canAdd ? undefined : 'Enter a ticker and its price.'}
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
                Rank holdings to set their order of priority for the automatic optimizer.
                Unranked positions go to their band floor and are not optimized.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">Order of priority:</span>{' '}
                <span className="font-mono text-[12.5px]">
                  {order.map((s, i) => `${i + 1}. ${s.sym}`).join('   ')}
                </span>
                {'. '}
                The other {portfolio.stocks.length - order.length} go to their band floor and are
                not optimized.
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


        {duplicates.length > 0 && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn">
            {duplicates.join(', ')} {duplicates.length === 1 ? 'appears' : 'appear'} on more than
            one row. Each row is tracked as its own position, so the shares are not combined.
          </p>
        )}
      </section>

      <section className={locked ? 'mb-6' : undefined}>
        <div className="modal-section">
          <h3>Cash band</h3>
        </div>
        {/* All three come off the model export's USD CASH row: Allocation % is the target,
            Min and Max Drift % the two edges. */}
        <div className="flex max-w-xl gap-4">
          <label className="flex-1">
            <span className="field-label mb-1.5">Floor %</span>
            <NumInput
              className={`field text-right ${cashBad ? 'border-danger text-danger' : ''}`}
              step="0.5"
              value={portfolio.cashFloor}
              onCommit={(v) => onCashBand('cashFloor', v)}
            />
          </label>
          <label className="flex-1">
            <span className="field-label mb-1.5">Target %</span>
            <NumInput
              className={`field text-right ${cashBad ? 'border-danger text-danger' : ''}`}
              step="0.5"
              value={portfolio.cashTarget}
              onCommit={(v) => onCashBand('cashTarget', v)}
            />
          </label>
          <label className="flex-1">
            <span className="field-label mb-1.5">Ceiling %</span>
            <NumInput
              className={`field text-right ${cashBad ? 'border-danger text-danger' : ''}`}
              step="0.5"
              value={portfolio.cashCeiling}
              onCommit={(v) => onCashBand('cashCeiling', v)}
            />
          </label>
        </div>
      </section>

      {/* Last, right above Done, which it is the reason for. */}
      {locked && (
        <div
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] leading-relaxed text-danger"
        >
          <p className="font-semibold">Fix these before closing:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
