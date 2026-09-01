import { useMemo, useState } from 'react';
import Modal from '../Modal';
import { applyImport, pickModel } from '@/lib/import/apply';
import { offModelSymbols } from '@/lib/import/parse';
import { ParsedImport, Resolution } from '@/lib/import/types';
import { money } from '@/lib/format';
import { ExplorerState } from '@/lib/types';

/**
 * Upload, then review, then apply.
 *
 * The review step is the point of this dialog. A custodian export is ambiguous in ways the file
 * itself cannot settle — several disagreeing cash figures, funds a 100-share lot means nothing
 * to, holdings the model has no row for. Each of those is put in front of the advisor rather than
 * guessed at, because a wrong answer here moves every number in the tool.
 *
 * Prices are not among them. The model export carries targets and bands and no prices at all, so
 * a model position the account does not hold simply arrives without one, and the result table
 * below says so. Nothing here invents market data.
 */
export default function ImportDialog({
  initial,
  onClose,
  onApply,
}: {
  /** A parse already done on the page behind, so the dialog opens straight into the review. */
  initial?: ParsedImport;
  onClose: () => void;
  onApply: (state: ExplorerState) => void;
}) {
  const [parsed] = useState<ParsedImport | null>(initial ?? null);
  const [resolution, setResolution] = useState<Resolution>(() => ({
    modelName: initial ? pickModel(initial)?.name : undefined,
    keepOffModel: true,
  }));

  const model = parsed ? pickModel(parsed, resolution.modelName) : undefined;
  const offModel = parsed && model ? offModelSymbols(model, parsed.holdings) : [];

  const preview = useMemo(
    () => (parsed ? applyImport(parsed, resolution) : null),
    [parsed, resolution],
  );

  const nothingFound = parsed && !model && !parsed.holdings;
  // Holdings alone cannot drive the tool: targets and bands live in the model export.
  const missingModel = parsed && !model && !!parsed.holdings;

  return (
    <Modal
      title="Load a portfolio"
      subtitle="Check what was read, settle anything the files leave open, then apply."
      width="max-w-4xl"
      onClose={onClose}
      footer={
        parsed ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              Choose different files
            </button>
            <div className="flex items-center gap-4">
              <span
                className={`font-mono text-[13px] tabular-nums ${
                  missingModel ? 'font-semibold text-warn' : 'text-ink-soft'
                }`}
              >
                {missingModel
                  ? 'Add the model export to continue'
                  : preview &&
                    `${preview.portfolio.stocks.length} positions · ${money(
                      preview.portfolio.cash,
                    )} cash`}
              </span>
              <button
                className="btn-solid"
                disabled={!preview || preview.portfolio.stocks.length === 0}
                onClick={() => preview && onApply(preview)}
              >
                Apply to portfolio
              </button>
            </div>
          </>
        ) : undefined
      }
    >
      {nothingFound && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-[13.5px] leading-relaxed text-warn">
          Nothing recognisable was found in those files.
        </p>
      )}

      {parsed && (model || parsed.holdings) && (
        <div className="flex flex-col gap-8">
          {missingModel && (
            <div className="rounded-lg border border-[#e7c48a] bg-warn-soft px-4 py-3.5">
              <p className="text-[14px] font-bold text-warn">The model export is missing</p>
              <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-warn">
                The holdings read fine — {parsed.holdings!.positions.length} positions and a cash
                balance. But targets and drift bands live in the model export, and without them
                there is nothing for the tool to measure against. Add that file to continue.
              </p>
              <button className="btn-outline mt-3" onClick={onClose}>
                Add the model export
              </button>
            </div>
          )}

          {/* ---------- what came in ---------- */}
          <section>
            <div className="modal-section">
              <h3>What was read</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {parsed.sheets.map((s, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-paper px-3 py-2.5"
                >
                  <span className="truncate text-[13.5px] font-semibold">{s.name}</span>
                  <span className="shrink-0 font-mono text-[12.5px] text-ink-soft">
                    {s.read === 'skipped' ? 'not recognised' : `${s.read} · ${s.rows} rows`}
                  </span>
                </div>
              ))}
            </div>

            {parsed.holdings?.accountName && (
              <p className="mt-3 text-[13.5px] text-ink-soft">
                Account <b className="text-ink">{parsed.holdings.accountName}</b>
                {parsed.holdings.accountNumber && ` · ${parsed.holdings.accountNumber}`}
              </p>
            )}

            {parsed.models.length > 1 && (
              <label className="mt-4 block max-w-lg">
                <span className="field-label mb-1.5">Model</span>
                <select
                  className="field font-sans"
                  value={resolution.modelName}
                  onChange={(e) => setResolution((r) => ({ ...r, modelName: e.target.value }))}
                >
                  {parsed.models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.rows.length} positions)
                    </option>
                  ))}
                </select>
              </label>
            )}

            {parsed.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-warn-soft px-3 py-2.5">
                {parsed.warnings.map((w, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-warn">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- everything else in the account ---------- */}
          {offModel.length > 0 && (
            <section>
              <div className="modal-section">
                <h3>Everything else in the account</h3>
              </div>
              <div className="flex flex-col gap-2">
                {offModel.length > 0 && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent"
                      checked={resolution.keepOffModel}
                      onChange={(e) =>
                        setResolution((r) => ({ ...r, keepOffModel: e.target.checked }))
                      }
                    />
                    <span className="flex-1 text-[13.5px] leading-relaxed">
                      Keep{' '}
                      <b>
                        {offModel.length} holding{offModel.length === 1 ? '' : 's'}
                      </b>{' '}
                      the model has no row for
                      <span className="sub">
                        {offModel.map((h) => h.sym).join(', ')} ·{' '}
                        {money(offModel.reduce((n, h) => n + h.shares * h.price, 0))}. They count
                        toward account value and can be sold to raise cash.
                      </span>
                    </span>
                  </label>
                )}

              </div>
            </section>
          )}

          {/* ---------- the result ---------- */}
          {preview && preview.portfolio.stocks.length > 0 && (
            <section>
              <div className="modal-section">
                <h3>Result</h3>
                <span className="font-mono text-[12.5px] tabular-nums text-ink-soft">
                  cash {preview.portfolio.cashTarget}% target &middot; band{' '}
                  {preview.portfolio.cashFloor}&ndash;{preview.portfolio.cashCeiling}%
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="th th-lead">Symbol</th>
                      <th className="th">Type</th>
                      <th className="th">Target</th>
                      <th className="th">Band</th>
                      <th className="th">Shares</th>
                      <th className="th">Price</th>
                      <th className="th">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.portfolio.stocks.map((s, i) => (
                      <tr key={s.id} className={i % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                        <td className="td font-sans text-[14px] font-bold">
                          {s.sym}
                          {s.lotRounding === false && (
                            <span className="badge ml-1.5 bg-warn-soft text-warn">no lot</span>
                          )}
                        </td>
                        <td className="td text-[12.5px] text-ink-soft">{s.type ?? '—'}</td>
                        <td className="td">{s.target}%</td>
                        <td className="td text-ink-soft">
                          {s.bandMin}&ndash;{s.bandMax}%
                        </td>
                        <td className="td">{s.shares.toLocaleString('en-US')}</td>
                        <td className={`td ${s.price ? '' : 'text-warn'}`}>
                          {s.price ? money(s.price) : 'needs a price'}
                        </td>
                        <td className="td tabular-nums">
                          {s.price ? money(s.shares * s.price) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
