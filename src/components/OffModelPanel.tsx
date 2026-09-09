import Panel from './Panel';
import { OffModelSale } from '@/lib/actions';
import { offModelValue, totalValue } from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { Portfolio } from '@/lib/types';

/**
 * What the account holds that the model never mentioned.
 *
 * The model is the mandate. A position outside it is there by accident of history — a transfer
 * in, a legacy holding, something bought outside the sleeve — so the normal answer is to sell it
 * and let the proceeds fund the model. That answer used to live one row at a time inside "Edit
 * starting holdings", which is a dialog for correcting the starting position, not a place anyone
 * goes looking for a trade. So the rule the advisor actually works to was invisible.
 *
 * It gets its own table rather than rows in the main one: these holdings have no target and no
 * band, so eight of the ten columns there mean nothing for them. What they do have is a value,
 * and that value counts toward the account total every band is a percentage of — which is why
 * the share of the account is stated here rather than left to be worked out.
 *
 * Every asset class here can be sold, fixed income included. Being held rather than traded is a
 * rule about positions the model asks for, where a target and a band say what to hold. A holding
 * the model has no row for has no such standing, whatever it is made of.
 */
export default function OffModelPanel({
  portfolio,
  sale,
  onSell,
  onSellAll,
  onUndo,
  undoable,
}: {
  portfolio: Portfolio;
  /** The last Sell all, reported until anything else happens. */
  sale: OffModelSale | null;
  onSell: (id: string) => void;
  onSellAll: () => void;
  onUndo: () => void;
  undoable: boolean;
}) {
  const holdings = portfolio.offModel;
  if (holdings.length === 0) return null;

  const total = holdings.reduce((n, h) => n + offModelValue(h), 0);
  const account = totalValue(portfolio);
  const sellable = holdings.filter((h) => offModelValue(h) > 0);

  return (
    <div className="mb-4">
      <Panel
        title="Held, but not in the model"
        summary={`${holdings.length} holding${holdings.length === 1 ? '' : 's'} · ${money(total)}`}
        actions={
          sellable.length > 0 ? (
            <button
              className="btn-sell px-4 py-2 text-[13.5px]"
              title="Sells every one of these at its listed price and adds the proceeds to cash."
              onClick={onSellAll}
            >
              Sell all {sellable.length}
            </button>
          ) : undefined
        }
      >
        {sale && (
          <div
            className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2
                       rounded-md border border-line bg-panel-alt px-3.5 py-2.5"
            role="status"
          >
            <div className="min-w-0 text-[13.5px]">
              <span className="font-semibold">
                {sale.sold} sold, {money(sale.proceeds)} added to cash
              </span>
            </div>
            {undoable && (
              <button className="btn-ghost shrink-0" onClick={onUndo}>
                Undo all {sale.sold}
              </button>
            )}
          </div>
        )}

        <div className="px-4 pb-1 text-[13.5px] leading-relaxed text-ink-soft">
          {money(total)} — <b className="text-ink">{pct((total / account) * 100)}</b> of the
          account. This counts toward the total every band is measured against, so selling it
          moves the dollar width of every band in the table above.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th th-lead">Ticker</th>
                <th className="th">Held</th>
                <th className="th">Price</th>
                <th className="th">Value</th>
                <th className="th">Sell</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const value = offModelValue(h);
                return (
                  <tr key={h.id} className={i % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                    <td className="td font-sans text-[14px] font-bold">{h.sym}</td>
                    <td className="td">{fmtShares(h.shares)} sh</td>
                    <td className="td">{money(h.price)}</td>
                    <td className="td tabular-nums">{money(value)}</td>
                    <td className="td">
                      {value === 0 ? (
                        <span className="text-[13px] text-ink-soft">nothing held</span>
                      ) : (
                        <button className="btn-sell" onClick={() => onSell(h.id)}>
                          Sell
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </Panel>
    </div>
  );
}
