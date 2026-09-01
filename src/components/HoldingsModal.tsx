import Modal from './Modal';
import { NumInput, SymInput } from './Inputs';
import { offModelValue, totalValue } from '@/lib/engine';
import { money } from '@/lib/format';
import { Portfolio } from '@/lib/types';

interface Props {
  portfolio: Portfolio;
  onClose: () => void;
  onShares: (stockId: string, shares: number) => void;
  /** Prices live in the model, but they are edited here too: an advisor updating a starting
   *  position is usually looking at a statement that carries both. */
  onPrice: (stockId: string, price: number) => void;
  onCash: (cash: number) => void;
  onAddOffModel: () => void;
  onOffModelField: (id: string, field: 'sym' | 'shares' | 'price', value: string | number) => void;
  onSellOffModel: (id: string) => void;
  onRemoveOffModel: (id: string) => void;
}

const TH =
  'border-b border-line px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';
const TD = 'border-b border-line-soft px-2 py-2.5 align-middle';

export default function HoldingsModal({
  portfolio,
  onClose,
  onShares,
  onPrice,
  onCash,
  onAddOffModel,
  onOffModelField,
  onSellOffModel,
  onRemoveOffModel,
}: Props) {
  const offModelTotal = portfolio.offModel.reduce((sum, h) => sum + offModelValue(h), 0);

  return (
    <Modal
      title="Starting holdings"
      subtitle="The position this account begins from. Editing a share count or the cash balance redefines that starting point, so a reset returns here."
      onClose={onClose}
      footer={
        <>
          <span className="font-mono text-[13px] tabular-nums text-ink-soft">
            Total account {money(totalValue(portfolio))}
          </span>
          <button className="btn-solid" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <section className="mb-8">
        <div className="modal-section">
          <h3>Model holdings</h3>
          <span className="font-mono text-[12px] text-ink-soft">
            {portfolio.stocks.length} position{portfolio.stocks.length === 1 ? '' : 's'}
          </span>
        </div>

        {portfolio.stocks.length === 0 ? (
          <p className="rounded-lg bg-paper px-4 py-6 text-center text-[13.5px] text-ink-soft">
            No stocks in the model yet. Add them under Edit model &amp; cash band.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Symbol</th>
                <th className={TH}>Price</th>
                <th className={`${TH} w-44`}>Shares</th>
                <th className={`${TH} text-right`}>Value</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.stocks.map((s) => (
                <tr key={s.id}>
                  <td className={`${TD} font-sans text-[14px] font-bold`}>{s.sym}</td>
                  <td className={`${TD} w-36`}>
                    <NumInput
                      className={`field text-right ${s.price <= 0 ? 'border-warn text-warn' : ''}`}
                      step="0.01"
                      value={s.price}
                      onCommit={(v) => onPrice(s.id, v)}
                    />
                  </td>
                  <td className={`${TD} w-36`}>
                    <NumInput
                      className="field text-right"
                      value={s.shares}
                      onCommit={(v) => onShares(s.id, v)}
                    />
                  </td>
                  <td className={`${TD} text-right font-mono text-[13px] tabular-nums`}>
                    {s.price > 0 ? money(s.shares * s.price) : <span className="text-warn">needs a price</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-8">
        <div className="modal-section">
          <h3>Cash</h3>
        </div>
        <label className="block max-w-xs">
          <span className="field-label mb-1.5">Balance</span>
          <NumInput className="field text-right" value={portfolio.cash} onCommit={onCash} />
        </label>
      </section>

      <section>
        <div className="modal-section">
          <h3>Other holdings, not in the model</h3>
          {portfolio.offModel.length > 0 && (
            <span className="font-mono text-[12px] tabular-nums text-ink-soft">
              {money(offModelTotal)}
            </span>
          )}
        </div>

        {portfolio.offModel.length === 0 ? (
          <p className="rounded-lg bg-paper px-4 py-5 text-center text-[13.5px] text-ink-soft">
            Nothing here. Anything the account holds outside the model goes in this list.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Symbol</th>
                <th className={TH}>Shares</th>
                <th className={TH}>Price</th>
                <th className={`${TH} text-right`}>Value</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {portfolio.offModel.map((h) => (
                <tr key={h.id}>
                  <td className={`${TD} w-28`}>
                    <SymInput
                      className="field font-sans font-bold"
                      value={h.sym}
                      onCommit={(v) => onOffModelField(h.id, 'sym', v)}
                    />
                  </td>
                  <td className={`${TD} w-32`}>
                    <NumInput
                      className="field text-right"
                      value={h.shares}
                      onCommit={(v) => onOffModelField(h.id, 'shares', v)}
                    />
                  </td>
                  <td className={`${TD} w-32`}>
                    <NumInput
                      className="field text-right"
                      step="0.01"
                      value={h.price}
                      onCommit={(v) => onOffModelField(h.id, 'price', v)}
                    />
                  </td>
                  <td className={`${TD} text-right font-mono text-[13px] tabular-nums`}>
                    {money(offModelValue(h))}
                  </td>
                  {/* One way out per row, and neither can move the account total on its own:
                      a holding worth something is sold, a row worth nothing is removed. */}
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {h.tradeable === false ? (
                      <span className="badge bg-accent-soft text-accent">held, not traded</span>
                    ) : offModelValue(h) === 0 ? (
                      <button
                        className="btn-ghost"
                        title="Nothing is held here, so removing this row changes no other number"
                        onClick={() => onRemoveOffModel(h.id)}
                      >
                        Remove row
                      </button>
                    ) : (
                      <button className="btn-sell" onClick={() => onSellOffModel(h.id)}>
                        Sell, add to cash
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-3 flex items-start justify-between gap-4">
          <p className="max-w-lg text-[13px] leading-relaxed text-ink-soft">
            These count toward total account value, and so toward every band in dollars, until they
            are sold. Selling one adds the whole proceeds to cash, which leaves the account total
            where it was. A row holding nothing can be removed outright; anything with value has to
            be sold, so no band ever moves without a trade behind it.
          </p>
          <button className="btn-chip shrink-0" onClick={onAddOffModel}>
            + Add holding
          </button>
        </div>
      </section>
    </Modal>
  );
}
