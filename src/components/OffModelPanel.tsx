import { useState } from 'react';
import Panel from './Panel';
import WhatIfCell from './WhatIfCell';
import { dropFocusOnWheel } from './Inputs';
import { OffModelSale } from '@/lib/actions';
import { affordableShares, offModelAsStock, offModelValue, totalValue } from '@/lib/engine';
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
 *
 * The advisor keeps working from this table after trading on it, so a row stays whatever is left
 * of the holding — sold out included — and each one takes the same Calculate box as a model row,
 * to buy or sell any amount. Sell and Sell all stay as the one-click way to clear them.
 *
 * The last row of the table buys a new holding: ticker, shares and price typed together, paid for
 * out of cash and clamped to it like every one-row buy. It is a trade, so it goes on the log:
 * Undo takes the row away with the cash it spent, and a reset drops it. A holding the account
 * already owns but the export missed belongs in the Current holdings dialog instead, which edits
 * the starting position without moving cash.
 */
export default function OffModelPanel({
  portfolio,
  sale,
  onSell,
  onTrade,
  onSellAll,
  onUndo,
  onAdd,
  undoable,
}: {
  portfolio: Portfolio;
  /** The last Sell all, reported until anything else happens. */
  sale: OffModelSale | null;
  onSell: (id: string) => void;
  /** A buy or a sell to a chosen holding, from the Calculate box. */
  onTrade: (id: string, targetShares: number) => void;
  onSellAll: () => void;
  onUndo: () => void;
  /** A new holding, bought from the add row at the foot of the table. */
  onAdd: (holding: { sym: string; shares: number; price: number }) => void;
  undoable: boolean;
}) {
  const holdings = portfolio.offModel;
  const total = holdings.reduce((n, h) => n + offModelValue(h), 0);
  const account = totalValue(portfolio);
  const sellable = holdings.filter((h) => offModelValue(h) > 0);

  const [newSym, setNewSym] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newPrice, setNewPrice] = useState('');

  const ticker = newSym.trim().toUpperCase();
  const price = Math.max(0, Number(newPrice) || 0);
  const count = Math.max(0, Math.floor(Number(newShares) || 0));
  /* What the cash pays for, since the add is a buy and is clamped to it like any other one-row buy.
     Priced as a holding of nothing, so the arithmetic is the same `whatIf` the trade will run. */
  const covered =
    price > 0
      ? Math.min(
          count,
          affordableShares(portfolio, offModelAsStock({ id: '', sym: ticker, shares: 0, price })),
        )
      : 0;
  /* A ticker, some shares and a price, and enough cash for at least one of them. A row with no
     trade behind it could not be undone, so nothing is added unless something is bought. */
  const ready = ticker !== '' && price > 0 && count > 0 && covered > 0;
  const addedValue = covered * price;
  /* Stated, not prevented. The same symbol in both lists is usually a mistake, but it is also how
     a position half in the model and half out of it is described, so the row is still allowed. */
  const clash =
    ticker !== '' &&
    [...portfolio.stocks, ...holdings].some((x) => x.sym.toUpperCase() === ticker);

  const add = () => {
    if (!ready) return;
    onAdd({ sym: ticker, shares: count, price });
    setNewSym('');
    setNewShares('');
    setNewPrice('');
  };

  /** Enter commits the row from any of its three boxes, so it is typed straight through. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') add();
  };

  return (
    <div className="mb-4">
      <Panel
        title="Not In Model"
        summary={
          holdings.length === 0
            ? 'Nothing yet'
            : `${holdings.length} holding${holdings.length === 1 ? '' : 's'} · ${money(total)}`
        }
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
          {holdings.length === 0 ? (
            <>
              Nothing here. Anything the account holds outside the model goes in this list — add it
              at the foot of the table, with the price it is worth today.
            </>
          ) : (
            <>
              {money(total)} —{' '}
              <b className="text-ink">{pct(account > 0 ? (total / account) * 100 : 0)}</b> of the
              account.
            </>
          )}
        </div>

        {/* `table-stick`, the same as the positions table, so the column names follow the page
            down under the compact bar. It used to sit in an `overflow-x-auto` box, and a scroll
            box of its own is exactly what stops a header sticking to the window. */}
        <div className="table-stick">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th th-lead">Ticker</th>
                <th className="th">Held</th>
                <th className="th">Price</th>
                <th className="th">Value</th>
                <th className="th">% of account</th>
                <th className="th">Sell</th>
                <th className="th th-lead w-[260px]">Buy or sell</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const value = offModelValue(h);
                return (
                  <tr key={h.id} className={`align-top ${i % 2 ? 'bg-panel-alt' : 'bg-panel'}`}>
                    <td className="td font-sans text-[14px] font-bold">{h.sym}</td>
                    <td className="td">{fmtShares(h.shares)} sh</td>
                    <td className="td">{money(h.price)}</td>
                    <td className="td tabular-nums">{money(value)}</td>
                    <td className="td tabular-nums">
                      {pct(account > 0 ? (value / account) * 100 : 0)}
                    </td>
                    <td className="td">
                      {value === 0 ? (
                        <span className="text-[13px] text-ink-soft">nothing held</span>
                      ) : (
                        <button className="btn-sell" onClick={() => onSell(h.id)}>
                          Sell
                        </button>
                      )}
                    </td>
                    <td className="td">
                      {h.price > 0 ? (
                        <WhatIfCell
                          portfolio={portfolio}
                          stock={offModelAsStock(h)}
                          onTrade={onTrade}
                          banded={false}
                        />
                      ) : (
                        <span className="text-[13px] text-ink-soft">needs a price</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* The add row keeps the table's own columns, so what is being typed lines up under
                  the heading that names it and the value it will carry is priced as it is typed. */}
              <tr className={holdings.length % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                {/* Boxed to their own width rather than the column's: with no rows above them
                    the three fields would each stretch to a third of the table. */}
                <td className="td border-t border-line">
                  <div className="max-w-[8rem]">
                    <input
                      className="field font-sans text-[14px] font-bold uppercase
                                 placeholder:font-normal placeholder:normal-case"
                      placeholder="Ticker"
                      aria-label="Ticker of the holding to add"
                      value={newSym}
                      onChange={(e) => setNewSym(e.target.value)}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </td>
                <td className="td border-t border-line">
                  <div className="max-w-[9rem]">
                    <input
                      type="number"
                      min="0"
                      className="field text-right"
                      placeholder="Shares"
                      aria-label="Shares held"
                      value={newShares}
                      onChange={(e) => setNewShares(e.target.value)}
                      onWheel={dropFocusOnWheel}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </td>
                <td className="td border-t border-line">
                  <div className="max-w-[9rem]">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="field text-right"
                      placeholder="Price"
                      aria-label="Price per share"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      onWheel={dropFocusOnWheel}
                      onKeyDown={onKeyDown}
                    />
                  </div>
                </td>
                <td className="td tabular-nums border-t border-line">
                  {ready ? money(addedValue) : <span className="text-ink-soft">—</span>}
                </td>
                {/* A buy swaps cash for shares, so the account total it is a share of does not move. */}
                <td className="td tabular-nums border-t border-line">
                  {ready && account > 0 ? (
                    pct((addedValue / account) * 100)
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
                <td className="td border-t border-line" />
                <td className="td border-t border-line">
                  <button className="btn-chip disabled:opacity-45" disabled={!ready} onClick={add}>
                    + Add holding
                  </button>
                  <span className={`sub ${ready && clash ? 'font-semibold text-warn' : ''}`}>
                    {ticker === '' && price === 0 && count === 0
                      ? 'Ticker, shares and price.'
                      : ticker === ''
                        ? 'Needs a ticker.'
                        : count === 0
                          ? 'Needs shares.'
                          : price === 0
                            ? 'Needs a price.'
                            : covered === 0
                              ? 'Not enough cash to buy any.'
                              : clash
                                ? `${ticker} is already held. This adds a second, separate row.`
                                : covered < count
                                  ? `Cash covers ${fmtShares(covered)} of ${fmtShares(count)} sh, for ${money(addedValue)}.`
                                  : `Buys ${fmtShares(count)} sh of ${ticker} for ${money(addedValue)}.`}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </Panel>
    </div>
  );
}
