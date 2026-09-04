import { Fragment } from 'react';
import BandBar from './BandBar';
import RowToggle from './RowToggle';
import { NumInput } from './Inputs';
import WhatIfCell from './WhatIfCell';
import {
  affordableShares,
  bandShareLimits,
  highestLotWithinBand,
  lotAwareTarget,
  lotRounds,
  isTradeable,
  lowestLotWithinBand,
  mandatoryStatus,
  needsDecision,
  rawMaxBuy,
  rawMinSell,
  RawMaxBuy,
  RawMinSell,
  totalValue,
  weight,
} from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { BuyMode, Portfolio, SellMode, Stock } from '@/lib/types';
import { RowCollapse } from '@/lib/useRowCollapse';

/**
 * The three raw-room columns are the first thing to go when the window cannot hold nine.
 *
 * They answer a different question from the rest of the row — the same position with the lot
 * preference switched off — so folding them costs less than folding anything else. Below the
 * `wide` breakpoint they leave the header and reappear here, as a strip beneath the row they
 * describe. Every figure and both buttons come with them: this is the same content re-laid, not
 * a summary of what a wider window would have shown.
 */
const RAW_COLUMN = 'hidden wide:table-cell';

interface Props {
  portfolio: Portfolio;
  /** Stock ids with something to undo, so the per-row reset can be disabled when it is a no-op. */
  resettable: Set<string>;
  onBuy: (stockId: string, mode: BuyMode) => void;
  onSell: (stockId: string, mode: SellMode) => void;
  onResetStock: (stockId: string) => void;
  /** Lets an imported position that arrived without a price be given one in place. */
  onPrice: (stockId: string, price: number) => void;
  /** Executes a what-if: move this holding to exactly this many shares. */
  onTradeTo: (stockId: string, targetShares: number) => void;
  /** Row open/shut state, held above so Expand all sits on the panel header. */
  collapse: RowCollapse;
}

/** Everything one row needs, assembled from the engine so the JSX below does no arithmetic. */
function row(p: Portfolio, s: Stock) {
  const total = totalValue(p);
  const { minShares, maxShares } = bandShareLimits(p, s);
  const target = lotAwareTarget(p, s);
  const { highestLot } = highestLotWithinBand(p, s);
  const { lowestLot } = lowestLotWithinBand(p, s);

  return {
    minShares,
    maxShares,
    target,
    highestLot,
    lowestLot,
    lots: lotRounds(s),
    canAfford: affordableShares(p, s),
    buyToTarget: Math.max(target.goal - s.shares, 0),
    sellToTarget: Math.max(s.shares - target.goal, 0),
    buyToHighLot: Math.max(highestLot - s.shares, 0),
    sellToLowLot: Math.max(s.shares - lowestLot, 0),
    weight: weight(p, s),
    goalWeight: total > 0 ? ((target.goal * s.price) / total) * 100 : 0,
    mandatory: mandatoryStatus(p, s),
  };
}

/** A share count over its dollar value, in the direction's colour. */
function Move({ action, n, price }: { action: 'BUY' | 'SELL'; n: number; price: number }) {
  return (
    <div className="mt-1.5">
      <span className={`font-semibold ${action === 'BUY' ? 'text-buy' : 'text-sell'}`}>
        {action} {fmtShares(n)} sh
      </span>
      <span className="sub">{money(n * price)}</span>
    </div>
  );
}

const CAPTION = 'text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';

/**
 * One figure in the folded strip, carrying the column header it came from.
 *
 * The header is kept because it is the only thing tying the number to the column it folded out
 * of: an advisor who learned this table on a wide screen should recognise "Room to the ceiling"
 * in the same words, not have to work out which figure it became.
 */
function StripFigure({
  label,
  action,
  children,
}: {
  label: string;
  /** The column's button, kept on its own line under the number it acts on. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className={CAPTION}>{label}</span>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * The raw-room columns as a strip under the row, for windows too narrow to carry them as columns.
 * Rendered only while the row is open, which is also the only time the columns above would have
 * shown anything a shut row does not already state.
 */
function RawRoomStrip({
  stock,
  rawBuy,
  rawSell,
  cash,
  canTrade,
  onBuy,
  onSell,
}: {
  stock: Stock;
  rawBuy: RawMaxBuy;
  rawSell: RawMinSell;
  cash: number;
  canTrade: boolean;
  onBuy: (stockId: string, mode: BuyMode) => void;
  onSell: (stockId: string, mode: SellMode) => void;
}) {
  return (
    /* Three fixed tracks rather than a wrapping row: the three figures keep the left-to-right
       order they have as columns, and each one's button stays under its own number instead of
       drifting into the next group when the window changes width. */
    <div className="px-3 pt-1 pb-4">
      <span className={`${CAPTION} text-ink-faint`}>Raw room, no lot preference</span>

      <div className="mt-2.5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <StripFigure
          label="Room to the ceiling"
          action={
            canTrade && (
              <button
                className="btn-buy"
                disabled={rawBuy.maxBuy <= 0}
                onClick={() => onBuy(stock.id, 'rawmax')}
              >
                Buy this raw max
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-buy">
            {fmtShares(rawBuy.maxBuy)} sh
          </span>
          <span className="font-mono text-[12px] text-ink-soft">
            {money(rawBuy.maxBuy * stock.price)}
          </span>
          {/* The caption names the band, so say plainly when it was the cash that bound it. */}
          <span className="font-mono text-[12px] text-ink-soft">
            {rawBuy.limiter === 'band'
              ? `to the ${stock.bandMax}% ceiling`
              : 'capped by cash, not the band'}
          </span>
        </StripFigure>

        <StripFigure label="Shares cash affords">
          <span className="text-[15px] text-ink-soft">{fmtShares(rawBuy.cashAfford)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">
            {money(cash)} / {money(stock.price)}
          </span>
        </StripFigure>

        <StripFigure
          label="Room to the floor"
          action={
            canTrade && (
              <button
                className="btn-sell"
                disabled={rawSell.maxSell <= 0}
                onClick={() => onSell(stock.id, 'rawmax')}
              >
                Sell this raw max
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-sell">
            {fmtShares(rawSell.maxSell)} sh
          </span>
          <span className="font-mono text-[12px] text-ink-soft">
            {money(rawSell.maxSell * stock.price)}
          </span>
          <span className="font-mono text-[12px] text-ink-soft">
            to the {stock.bandMin}% floor
          </span>
        </StripFigure>
      </div>
    </div>
  );
}

/**
 * One row per holding, with every button under the number it acts on: the lot buttons in the
 * columns that define the band edges they move toward, and a single Adjust to target beside the
 * model's own answer. A position is either above or below target, never both, so one button
 * covers it and no permanently-greyed twin sits next to it.
 */
export default function LotAwareTable({
  portfolio,
  resettable,
  onBuy,
  onSell,
  onResetStock,
  onPrice,
  onTradeTo,
  collapse,
}: Props) {
  return (
    <div className="table-stick">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th th-lead rounded-tl-lg">Stock &middot; target</th>
            <th className="th">Toward the floor</th>
            <th className="th th-lead">Holding now</th>
            <th className="th">Toward the ceiling</th>
            <th className="th th-lead">Lot-aware target</th>
            <th className={`th ${RAW_COLUMN}`}>Room to the ceiling</th>
            <th className={`th ${RAW_COLUMN}`}>Shares cash affords</th>
            <th className={`th ${RAW_COLUMN}`}>Room to the floor</th>
            <th className="th th-lead rounded-tr-lg">What if I held…</th>
          </tr>
        </thead>
        <tbody>
          {portfolio.stocks.map((s, i) => {
            const stripe = i % 2 ? 'bg-panel-alt' : 'bg-panel';

            /* Without a price there is no weight, no band in shares and no trade. Saying so
               beats rendering a row of zeroes that reads as a real position sitting at 0%.

               Red rather than amber, and the whole row rather than the one cell that is empty,
               because the consequence is not confined to this row: an unpriced holding adds
               nothing to total account value, so every other position's weight is overstated
               while this sits here. It is a fault in the page, not a gap on a line. */
            if (s.price <= 0) {
              return (
                <tr
                  key={s.id}
                  className="bg-sell-soft shadow-[inset_4px_0_0_0_var(--color-sell)]"
                >
                  <td className="td font-sans text-[15px] font-bold">
                    {s.sym}
                    {/* Its own line, sized to its text: inline it collides with a four-letter
                        ticker, and full width it reads as a banner rather than a label. */}
                    <span className="badge mt-1.5 block w-fit bg-sell text-white">
                      NEEDS A PRICE
                    </span>
                    <span className="sub">
                      {s.target}% &middot; {s.bandMin}&ndash;{s.bandMax}%
                    </span>
                  </td>
                  <td className="td" colSpan={8}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-sans text-[13.5px] font-semibold text-sell">
                        Set a price to trade this position. Until then every weight on the page is
                        overstated, and the trade log will not export.
                      </span>
                      <label className="flex items-center gap-2">
                        <span className="font-sans text-[12.5px] text-ink-soft">$</span>
                        <NumInput
                          className="field w-32 text-right"
                          step="0.01"
                          value={0}
                          onCommit={(v) => onPrice(s.id, v)}
                        />
                      </label>
                      <span className="font-sans text-[12.5px] text-ink-soft">
                        {fmtShares(s.shares)} sh held
                      </span>
                    </div>
                  </td>
                </tr>
              );
            }

            const r = row(portfolio, s);
            const affordAny = r.canAfford > 0;
            /* Fixed income and any class the tool does not trade: every figure still shown, and
               counted toward account value, but no button anywhere on the row. */
            const canTrade = isTradeable(s);
            const adjust = !canTrade
              ? null
              : r.buyToTarget > 0
                ? 'BUY'
                : r.sellToTarget > 0
                  ? 'SELL'
                  : null;
            const adjustN = r.buyToTarget || r.sellToTarget;

            /* Inside its band and already at the model's own answer: there is no decision on this
               row, so it does not open by default. The lot buttons and the what-if are exploration
               rather than instruction, and the raw room table below never hides them. */
            const settled = !needsDecision(portfolio, s);
            const open = collapse.isOpen(s.id, settled);

            /* The two band edges as lots, which is what this table is for. Null when there is no
               lot on that side to move to. Computed once so the shut row and the open row lead
               with the same figure and the same wording. */
            const floorEdge = !r.lots
              ? { n: r.minShares, label: `${s.bandMin}% floor` }
              : r.lowestLot > s.shares
                ? null
                : { n: r.lowestLot, label: `${s.bandMin}% floor lot` };

            const ceilingEdge = !r.lots
              ? { n: r.maxShares, label: `${s.bandMax}% ceiling` }
              : r.highestLot < s.shares
                ? null
                : { n: r.highestLot, label: `${s.bandMax}% ceiling lot` };

            /* The same room with the lot preference switched off: as far as the band or the cash
               allows, odd numbers included. The arithmetic behind these used to sit in a second
               table; the answers are what the advisor acts on, so only they are kept. */
            const rawBuy = rawMaxBuy(portfolio, s);
            const rawSell = rawMinSell(portfolio, s);

            if (!open) {
              return (
                <tr
                  key={s.id}
                  className={`${stripe} ${
                    r.mandatory ? 'shadow-[inset_3px_0_0_0_var(--color-sell)]' : ''
                  }`}
                >
                  {/* A shut row carries share counts and nothing else. Prices, weights, band
                      labels and dollar values are all one expand away, and leaving them out is
                      what keeps the nine columns inside the window instead of off the side of it.
                      The one exception is a breach, which is too important to fold away. */}
                  <td className="td py-2.5 align-middle font-sans text-[15px] font-bold">
                    {s.sym}
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {floorEdge ? (
                      `${fmtShares(floorEdge.n)} sh`
                    ) : (
                      <span className="text-[12.5px] text-ink-soft">no lot</span>
                    )}
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    <span className="font-semibold">{fmtShares(s.shares)} sh</span>
                    {r.mandatory && (
                      <span className="badge ml-2.5 bg-sell-soft text-sell">{r.mandatory} band</span>
                    )}
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {ceilingEdge ? (
                      `${fmtShares(ceilingEdge.n)} sh`
                    ) : (
                      <span className="text-[12.5px] text-ink-soft">no lot</span>
                    )}
                  </td>

                  {/* The move is stated, not offered: nothing on a shut row trades, so none can
                      be fired by mistake while scanning. Open the row to act. */}
                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {!canTrade ? (
                      <span className="text-[12.5px] text-ink-soft">not traded here</span>
                    ) : adjust === null ? (
                      <span className="text-ink-soft">at target</span>
                    ) : (
                      <span
                        className={`font-semibold ${
                          adjust === 'BUY' ? 'text-buy' : 'text-sell'
                        }`}
                      >
                        {adjust} {fmtShares(adjustN)} sh
                      </span>
                    )}
                  </td>

                  {/* Folded away below `wide`, where a shut row keeps only the five columns it
                      leads with. These three are one expand away, in the strip. */}
                  <td className={`td py-2.5 align-middle whitespace-nowrap ${RAW_COLUMN}`}>
                    {fmtShares(rawBuy.maxBuy)} sh
                  </td>
                  <td
                    className={`td py-2.5 align-middle whitespace-nowrap text-ink-soft ${RAW_COLUMN}`}
                  >
                    {fmtShares(rawBuy.cashAfford)} sh
                  </td>
                  <td className={`td py-2.5 align-middle whitespace-nowrap ${RAW_COLUMN}`}>
                    {fmtShares(rawSell.maxSell)} sh
                  </td>

                  <td className="td py-2.5 text-right align-middle">
                    <RowToggle
                      label={s.sym}
                      open={false}
                      onToggle={() => collapse.toggle(s.id, settled)}
                    />
                  </td>
                </tr>
              );
            }

            const breach = r.mandatory ? 'shadow-[inset_3px_0_0_0_var(--color-sell)]' : '';

            return (
              <Fragment key={s.id}>
                <tr className={`${stripe} ${breach} row-with-strip`}>
                  {/* ---- identity, the mandate, and the row-level undo ---- */}
                  <td className="td">
                    <span className="font-sans text-[15px] font-bold">{s.sym}</span>
                    <span className="sub">{money(s.price)}</span>
                    <div className="mt-2 font-sans text-[13.5px] font-semibold">
                      {s.target}% target
                    </div>
                    <span className="sub">
                      band {s.bandMin}&ndash;{s.bandMax}%
                    </span>
                    {!canTrade && (
                      <span className="badge mt-1.5 bg-accent-soft text-accent">held, not traded</span>
                    )}
                    <button
                      className="btn-ghost mt-2.5 block"
                      disabled={!resettable.has(s.id)}
                      onClick={() => onResetStock(s.id)}
                    >
                      Reset
                    </button>
                  </td>

                  {/* ---- the floor side: the lowest lot the band allows ----

                       This table is the lot-aware one, so the figure here is the lot, not the raw
                       band edge in shares. The raw edge and the subtraction behind it live in the
                       raw room table below, which exists for exactly that. */}
                  <td className="td">
                    {!floorEdge ? (
                      <>
                        <span className="sub !mt-0">{s.bandMin}% floor</span>
                        <span className="badge mt-2 bg-warn-soft text-warn">
                          no lot to sell down to
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[15px] font-semibold">
                          {fmtShares(floorEdge.n)} sh
                        </span>
                        <span className="sub">{floorEdge.label}</span>
                        {r.lots && r.lowestLot === s.shares ? (
                          <span className="mt-2 block text-ink-soft">already the lowest lot</span>
                        ) : (
                          <>
                            <Move action="SELL" n={r.sellToLowLot} price={s.price} />
                            {canTrade && (
                              <button className="btn-sell mt-2" onClick={() => onSell(s.id, 'lowlot')}>
                                Sell to lowest lot
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </td>

                  {/* ---- where it actually sits ---- */}
                  <td className="td">
                    <span className="text-[15px] font-semibold">{fmtShares(s.shares)} sh</span>
                    <span className={`sub ${r.mandatory ? 'font-semibold text-sell' : ''}`}>
                      {pct(r.weight)}
                    </span>
                    <span className="sub">{money(s.shares * s.price)}</span>
                    <BandBar
                      className="mt-2"
                      bandMin={s.bandMin}
                      bandMax={s.bandMax}
                      weight={r.weight}
                      goalWeight={r.goalWeight}
                      breached={r.mandatory !== null}
                    />
                    {r.mandatory && (
                      <span className="badge mt-2 bg-sell-soft text-sell">
                        MANDATORY, {r.mandatory} band
                      </span>
                    )}
                  </td>

                  {/* ---- the ceiling side: the highest lot the band allows ---- */}
                  <td className="td">
                    {!ceilingEdge ? (
                      <>
                        <span className="sub !mt-0">{s.bandMax}% ceiling</span>
                        <span className="badge mt-2 bg-warn-soft text-warn">
                          no lot to buy up to
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[15px] font-semibold">
                          {fmtShares(ceilingEdge.n)} sh
                        </span>
                        <span className="sub">{ceilingEdge.label}</span>
                        {r.lots && r.highestLot === s.shares ? (
                          <span className="mt-2 block text-ink-soft">already the highest lot</span>
                        ) : (
                          <>
                            <Move action="BUY" n={r.buyToHighLot} price={s.price} />
                            {portfolio.cash < r.buyToHighLot * s.price && (
                              <span className="sub text-warn">
                                only {r.canAfford} sh affordable now
                              </span>
                            )}
                            {canTrade && (
                              <button
                                className="btn-buy mt-2"
                                disabled={!affordAny}
                                onClick={() => onBuy(s.id, 'highlot')}
                              >
                                Buy to highest lot
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </td>

                  {/* ---- what the model asks for, and the one move that gets there ---- */}
                  <td className="td">
                    <span className="text-[15px] font-semibold">
                      {fmtShares(r.target.goal)} sh
                    </span>{' '}
                    <span
                      className={`badge ${
                        r.target.isLot ? 'bg-buy-soft text-buy' : 'bg-warn-soft text-warn'
                      }`}
                    >
                      {r.target.isLot ? 'LOT' : r.lots ? 'raw, no lot fits' : 'raw'}
                    </span>
                    <span className="sub">
                      from {s.target}% target, raw = {r.target.raw.toFixed(1)}
                    </span>

                    {!canTrade ? (
                      <span className="mt-2 block text-[13px] text-ink-soft">
                        Fixed income is held and counted, never traded here.
                      </span>
                    ) : adjust === null ? (
                      <span className="mt-2 block text-ink-soft">at target</span>
                    ) : (
                      <>
                        <Move action={adjust} n={adjustN} price={s.price} />
                        {adjust === 'BUY' && portfolio.cash < adjustN * s.price && (
                          <span className="sub text-warn">
                            only {r.canAfford} sh affordable now
                          </span>
                        )}
                        <button
                          className={`mt-2 ${adjust === 'BUY' ? 'btn-buy' : 'btn-sell'}`}
                          disabled={adjust === 'BUY' && !affordAny}
                          onClick={() =>
                            adjust === 'BUY' ? onBuy(s.id, 'target') : onSell(s.id, 'target')
                          }
                        >
                          Adjust to target
                        </button>
                      </>
                    )}
                  </td>

                  {/* ---- the raw room: no lot preference, the honest maximum ----

                       These three fold out of the table below `wide` and reappear in the strip
                       beneath this row. Same figures, same buttons, laid across instead of down. */}
                  <td className={`td ${RAW_COLUMN}`}>
                    <span className="text-[15px] font-semibold text-buy">
                      {fmtShares(rawBuy.maxBuy)} sh
                    </span>
                    <span className="sub">{money(rawBuy.maxBuy * s.price)}</span>
                    {/* The header names the band, so say plainly when it was the cash that bound it. */}
                    <span className="sub">
                      {rawBuy.limiter === 'band'
                        ? `to the ${s.bandMax}% ceiling`
                        : 'capped by cash, not the band'}
                    </span>
                    {canTrade && (
                      <button
                        className="btn-buy mt-2"
                        disabled={rawBuy.maxBuy <= 0}
                        onClick={() => onBuy(s.id, 'rawmax')}
                      >
                        Buy this raw max
                      </button>
                    )}
                  </td>

                  <td className={`td ${RAW_COLUMN}`}>
                    <span className="text-ink-soft">{fmtShares(rawBuy.cashAfford)} sh</span>
                    <span className="sub">
                      {money(portfolio.cash)} / {money(s.price)}
                    </span>
                  </td>

                  <td className={`td ${RAW_COLUMN}`}>
                    <span className="text-[15px] font-semibold text-sell">
                      {fmtShares(rawSell.maxSell)} sh
                    </span>
                    <span className="sub">{money(rawSell.maxSell * s.price)}</span>
                    <span className="sub">to the {s.bandMin}% floor</span>
                    {canTrade && (
                      <button
                        className="btn-sell mt-2"
                        disabled={rawSell.maxSell <= 0}
                        onClick={() => onSell(s.id, 'rawmax')}
                      >
                        Sell this raw max
                      </button>
                    )}
                  </td>

                  {/* ---- the advisor's own number, and the way to shut the row ---- */}
                  <td className="td">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {canTrade && (
                          <WhatIfCell portfolio={portfolio} stock={s} onTrade={onTradeTo} />
                        )}
                      </div>
                      <RowToggle label={s.sym} open onToggle={() => collapse.toggle(s.id, settled)} />
                    </div>
                  </td>
                </tr>

                {/* The folded columns, under the row rather than beside it. `colSpan` is the wide
                    column count; a browser clamps it to however many columns are actually
                    showing, so one number is right on both sides of the breakpoint. */}
                <tr className={`${stripe} ${breach} wide:hidden`}>
                  {/* Not `.td`: the strip carries its own padding, and the border here is the one
                      the row above gave up so the pair reads as a single record. */}
                  <td className="border-b border-line-soft" colSpan={9}>
                    <RawRoomStrip
                      stock={s}
                      rawBuy={rawBuy}
                      rawSell={rawSell}
                      cash={portfolio.cash}
                      canTrade={canTrade}
                      onBuy={onBuy}
                      onSell={onSell}
                    />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
