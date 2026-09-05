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
 * The three columns that fold when the window cannot hold ten.
 *
 * Every column here is a share count the position could hold, so they pair off: a band edge and
 * the nearest lot inside it, twice over. When space runs out it is the raw edges that go, because
 * the lot beside each one is the answer this tool exists to give — and they come back as a strip
 * under the row rather than being lost. What the cash affords folds with them, being the one
 * figure that describes the account rather than the position.
 */
const FOLD = 'hidden wide:table-cell';

interface Props {
  portfolio: Portfolio;
  /** Stock ids with something to undo, so the per-row reset can be disabled when it is a no-op. */
  resettable: Set<string>;
  onBuy: (stockId: string, mode: BuyMode) => void;
  onSell: (stockId: string, mode: SellMode) => void;
  onResetStock: (stockId: string) => void;
  /** Lets an imported position that arrived without a price be given one in place. */
  onPrice: (stockId: string, price: number) => void;
  /** Executes a what-if: move this holding by this many shares. */
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
  const lots = lotRounds(s);

  return {
    /* The band edges as plain share counts: the fewest that stay at or above the floor, the most
       that stay at or below the ceiling. */
    minShares,
    maxShares,
    /** The raw target in whole shares, before the lot rule has any say. */
    targetShares: Math.round(target.raw),
    target,
    /* The nearest lot inside each edge. Null where the lot rule does not apply at all, which is
       true of anything bought in dollars with fractional shares. */
    lowerLot: lots ? lowestLot : null,
    upperLot: lots ? highestLot : null,
    lots,
    canAfford: affordableShares(p, s),
    buyToTarget: Math.max(target.goal - s.shares, 0),
    sellToTarget: Math.max(s.shares - target.goal, 0),
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

/**
 * A destination the position could hold, and the move that reaches it.
 *
 * Every column between the ticker and the cash is one of these: a share count to end at, the
 * distance from here, and the button that closes it. Stating the destination rather than the
 * distance is what lets the whole row be read in one unit — the figure in the column is a
 * holding, never a delta.
 */
function Destination({
  shares,
  caption,
  price,
  held,
  canTrade,
  tone = 'plain',
  badge,
  onGo,
  goLabel,
  affordable,
  cash,
}: {
  shares: number | null;
  caption: string;
  price: number;
  held: number;
  canTrade: boolean;
  tone?: 'plain' | 'buy' | 'sell';
  badge?: React.ReactNode;
  onGo?: () => void;
  goLabel?: string;
  /** Whole shares the cash can pay for, so a buy that outruns it says so before it is pressed. */
  affordable?: number;
  cash?: number;
}) {
  if (shares === null) {
    return (
      <div className="cell-inner">
        <div>
          <span className="sub !mt-0">{caption}</span>
          <span className="badge mt-2 bg-warn-soft text-warn">no lot here</span>
        </div>
      </div>
    );
  }

  const delta = shares - held;
  const action = delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : null;
  const short = action === 'BUY' && affordable !== undefined && affordable < delta;

  /* The figures sit at the top of the cell and the button at the bottom of it, so every button
     across the row lands on one line however much text is above it. */
  return (
    <div className="cell-inner">
      <div>
        <span
          className={`text-[15px] font-semibold ${
            tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : ''
          }`}
        >
          {fmtShares(shares)} sh
        </span>{' '}
        {badge}
        <span className="sub">{caption}</span>

        {action === null ? (
          <span className="mt-2 block text-ink-soft">already here</span>
        ) : (
          <>
            <Move action={action} n={Math.abs(delta)} price={price} />
            {short && cash !== undefined && (
              <span className="sub text-warn">only {fmtShares(affordable!)} sh affordable now</span>
            )}
          </>
        )}
      </div>

      {/* Just "Trade". The column says where, the line above says how much and which way, and
          the colour says buy or sell — so spelling all three out again on the button only made
          seven buttons of seven different widths. `goLabel` survives as the accessible name, so
          a screen reader still hears "Trade to the lowest lot" rather than one of seven "Trade". */}
      {action !== null && canTrade && onGo && (
        <div className="cell-action">
          <button
            className={action === 'BUY' ? 'btn-buy' : 'btn-sell'}
            disabled={action === 'BUY' && affordable !== undefined && affordable <= 0}
            aria-label={goLabel}
            title={goLabel}
            onClick={onGo}
          >
            Trade
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The one column that is not a destination: how many shares the idle cash can pay for.
 *
 * Its button spends the lot of it, which is the only control in the app that will knowingly take
 * a position past its own ceiling — cash buys 92 shares of MSFT and the band stops at 614, so
 * landing at 692 breaks the mandate. Asked for by the CFP, so it exists; it states where it
 * lands and says plainly when that is outside the band, because a breach made in one click
 * should not be discovered afterwards.
 */
function SpendTheCash({
  stock,
  affordable,
  maxShares,
  cash,
  canTrade,
  onGo,
}: {
  stock: Stock;
  affordable: number;
  maxShares: number;
  cash: number;
  canTrade: boolean;
  onGo: () => void;
}) {
  const landing = stock.shares + affordable;
  const breaches = landing > maxShares;

  return (
    <div className="cell-inner">
      <div>
        <span className="text-[15px] font-semibold">{fmtShares(affordable)} sh</span>
        <span className="sub">
          {money(cash)} / {money(stock.price)}
        </span>
        {affordable > 0 && (
          <>
            <span className="sub">would hold {fmtShares(landing)} sh</span>
            {breaches && (
              <span className="sub font-semibold text-sell">
                past the {stock.bandMax}% ceiling of {fmtShares(maxShares)} sh
              </span>
            )}
          </>
        )}
      </div>

      {/* Green even when it breaches. Once every button reads "Trade", colour is the only thing
          left saying buy or sell, so it cannot also mean "this one is dangerous" — the red line
          above carries that, and says exactly which ceiling is being passed. */}
      {affordable > 0 && canTrade && (
        <div className="cell-action">
          <button
            className="btn-buy"
            aria-label={
              breaches
                ? `Spend the cash on ${stock.sym}, past its ${stock.bandMax}% ceiling`
                : `Spend the cash on ${stock.sym}`
            }
            title={
              breaches
                ? 'Buys every share the cash affords, which takes this position outside its own band.'
                : 'Buys every share the cash affords.'
            }
            onClick={onGo}
          >
            Trade
          </button>
        </div>
      )}
    </div>
  );
}

const CAPTION = 'text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-soft';

/** One figure in the folded strip, carrying the column header it came from. */
function StripFigure({
  label,
  action,
  children,
}: {
  label: string;
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

/** The folded columns, under the row rather than beside it. */
function BandStrip({
  stock,
  minShares,
  maxShares,
  rawBuy,
  rawSell,
  cash,
  canTrade,
  onBuy,
  onSell,
  onSpend,
}: {
  stock: Stock;
  minShares: number;
  maxShares: number;
  rawBuy: RawMaxBuy;
  rawSell: RawMinSell;
  cash: number;
  canTrade: boolean;
  onBuy: (stockId: string, mode: BuyMode) => void;
  onSell: (stockId: string, mode: SellMode) => void;
  /** Buys every share the cash affords, band or no band. */
  onSpend: () => void;
}) {
  return (
    <div className="px-3 pt-1 pb-4">
      <span className={`${CAPTION} text-ink-faint`}>The band edges, and what the cash buys</span>

      <div className="mt-2.5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <StripFigure
          label="Lower band"
          action={
            canTrade && (
              <button
                className="btn-sell"
                disabled={rawSell.maxSell <= 0}
                onClick={() => onSell(stock.id, 'rawmax')}
              >
                Sell to the floor
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-sell">{fmtShares(minShares)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">
            the {stock.bandMin}% floor
          </span>
        </StripFigure>

        <StripFigure
          label="Upper band"
          action={
            canTrade && (
              <button
                className="btn-buy"
                disabled={rawBuy.maxBuy <= 0}
                onClick={() => onBuy(stock.id, 'rawmax')}
              >
                Buy to the ceiling
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-buy">{fmtShares(maxShares)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">
            {rawBuy.limiter === 'band'
              ? `the ${stock.bandMax}% ceiling`
              : 'capped by cash, not the band'}
          </span>
        </StripFigure>

        {/* The folded column keeps its button, or folding would quietly remove a control rather
            than move it. Labelled in full here: the strip has room, and none of the alignment
            that forced one word on the columns applies to it. */}
        <StripFigure
          label="Cash buys"
          action={
            canTrade &&
            rawBuy.cashAfford > 0 && (
              <button className="btn-buy" onClick={() => onSpend()}>
                Spend the cash
              </button>
            )
          }
        >
          <span className="text-[15px] text-ink-soft">{fmtShares(rawBuy.cashAfford)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">
            {money(cash)} / {money(stock.price)}
          </span>
          <span className="font-mono text-[12px] text-ink-soft">
            would hold {fmtShares(stock.shares + rawBuy.cashAfford)} sh
            {stock.shares + rawBuy.cashAfford > maxShares && (
              <span className="font-semibold text-sell">
                {' '}
                · past the {stock.bandMax}% ceiling
              </span>
            )}
          </span>
        </StripFigure>
      </div>
    </div>
  );
}

/**
 * One row per holding, read left to right as share counts: what is held, what the model asks
 * for, the nearest lot to it, then each band edge with the nearest lot inside it, and finally
 * what the cash could buy.
 *
 * Every column between the ticker and the box is a holding the position could end at, so the row
 * speaks one unit throughout. Every button sits under the number it produces, which is where the
 * CFP asked for them and where they stay.
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
            <th className="th th-lead rounded-tl-lg">Ticker</th>
            <th className="th th-lead">Current holdings</th>
            <th className="th">Target holdings</th>
            <th className="th th-lead">Lot closest to target</th>
            <th className={`th ${FOLD}`}>Lower band</th>
            <th className="th">Lot closest to lower band</th>
            <th className={`th ${FOLD}`}>Upper band</th>
            <th className="th">Lot closest to upper band</th>
            {/* "Shares with current cash" wrapped to four lines, and since every header shares
                one row that single label set the height of the whole bar. The sub-line under the
                figure spells the arithmetic out anyway. */}
            <th className={`th ${FOLD}`}>Cash buys</th>
            <th className="th th-lead rounded-tr-lg">Buy or sell</th>
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
                <tr key={s.id} className="bg-sell-soft shadow-[inset_4px_0_0_0_var(--color-sell)]">
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
                  <td className="td" colSpan={9}>
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Two different faults wear the same red, and saying the wrong one is
                          worse than saying neither. A row holding shares with no price is
                          missing from the account total, which drags every other weight up. A
                          row holding nothing distorts no total at all — zero shares are worth
                          zero at any price — it simply cannot be turned into a share count. */}
                      <span className="font-sans text-[13.5px] font-semibold text-sell">
                        {s.shares > 0
                          ? `${fmtShares(s.shares)} sh held with no price, so this position is missing from the account total and every weight on the page is overstated.`
                          : 'No price, so this target cannot be turned into a share count.'}{' '}
                        The trade log will not export until it has one.
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
            /* Fixed income and any class the tool does not trade: every figure still shown, and
               counted toward account value, but no button anywhere on the row. */
            const canTrade = isTradeable(s);

            /* Inside its band and already at the model's own answer: there is no decision on this
               row, so it does not open by default. */
            const settled = !needsDecision(portfolio, s);
            const open = collapse.isOpen(s.id, settled);

            const rawBuy = rawMaxBuy(portfolio, s);
            const rawSell = rawMinSell(portfolio, s);
            const breach = r.mandatory ? 'shadow-[inset_3px_0_0_0_var(--color-sell)]' : '';

            if (!open) {
              return (
                <tr key={s.id} className={`${stripe} ${breach}`}>
                  {/* A shut row carries share counts and nothing else. Prices, weights, band
                      labels and dollar values are all one expand away, and leaving them out is
                      what keeps ten columns inside the window instead of off the side of it.
                      The one exception is a breach, which is too important to fold away. */}
                  <td className="td py-2.5 align-middle font-sans text-[15px] font-bold">
                    {s.sym}
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    <span className="font-semibold">{fmtShares(s.shares)} sh</span>
                    {r.mandatory && (
                      <span className="badge ml-2.5 bg-sell-soft text-sell">
                        {r.mandatory} band
                      </span>
                    )}
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap text-ink-soft">
                    {fmtShares(r.targetShares)} sh
                  </td>

                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {!canTrade ? (
                      <span className="text-[12.5px] text-ink-soft">not traded here</span>
                    ) : (
                      <span className="font-semibold">{fmtShares(r.target.goal)} sh</span>
                    )}
                  </td>

                  <td className={`td py-2.5 align-middle whitespace-nowrap ${FOLD}`}>
                    {fmtShares(r.minShares)} sh
                  </td>
                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {r.lowerLot === null ? (
                      <span className="text-[12.5px] text-ink-soft">no lot</span>
                    ) : (
                      `${fmtShares(r.lowerLot)} sh`
                    )}
                  </td>
                  <td className={`td py-2.5 align-middle whitespace-nowrap ${FOLD}`}>
                    {fmtShares(r.maxShares)} sh
                  </td>
                  <td className="td py-2.5 align-middle whitespace-nowrap">
                    {r.upperLot === null ? (
                      <span className="text-[12.5px] text-ink-soft">no lot</span>
                    ) : (
                      `${fmtShares(r.upperLot)} sh`
                    )}
                  </td>
                  <td
                    className={`td py-2.5 align-middle whitespace-nowrap text-ink-soft ${FOLD}`}
                  >
                    {fmtShares(r.canAfford)} sh
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

            return (
              <Fragment key={s.id}>
                <tr className={`${stripe} ${breach} row-with-strip`}>
                  {/* ---- 1. identity, the mandate, and the row-level undo ---- */}
                  <td className="td cell-fill">
                    <div className="cell-inner">
                      <div>
                        <span className="font-sans text-[15px] font-bold">{s.sym}</span>
                        <span className="sub">{money(s.price)}</span>
                        <div className="mt-2 font-sans text-[13.5px] font-semibold">
                          {s.target}% target
                        </div>
                        <span className="sub">
                          band {s.bandMin}&ndash;{s.bandMax}%
                        </span>
                        {!canTrade && (
                          <span className="badge mt-1.5 bg-accent-soft text-accent">
                            held, not traded
                          </span>
                        )}
                      </div>
                      {/* Reset joins the line the trade buttons make, rather than floating at
                          whatever height this cell's text happens to end. */}
                      <div className="cell-action">
                        <button
                          className="btn-ghost"
                          disabled={!resettable.has(s.id)}
                          onClick={() => onResetStock(s.id)}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* ---- 2. where it actually sits ---- */}
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

                  {/* ---- 3. what the model asks for, before the lot rule ----

                       Its own button, asked for by the CFP. It lands on the model's percentage
                       exactly rather than on the nearest lot, which is the more faithful trade
                       and the less tidy one — the column beside it holds the lot-aware answer,
                       and the two are one click apart on purpose. */}
                  <td className="td cell-fill">
                    <Destination
                      shares={r.targetShares}
                      caption={`${s.target}% of the account, raw = ${r.target.raw.toFixed(1)}`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onTradeTo(s.id, r.targetShares)}
                      goLabel="Trade to raw target"
                    />
                  </td>

                  {/* ---- 4. the lot-aware answer, and the one move that reaches it ---- */}
                  <td className="td cell-fill">
                    {!canTrade ? (
                      <div className="cell-inner">
                        <div>
                          <span className="text-[15px] font-semibold">
                            {fmtShares(r.target.goal)} sh
                          </span>
                          <span className="mt-2 block text-[13px] text-ink-soft">
                            Held and counted, never traded here.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <Destination
                        shares={r.target.goal}
                        caption={
                          r.target.isLot
                            ? 'the nearest lot, inside the band'
                            : r.lots
                              ? 'raw, no lot fits the band'
                              : 'raw, no lot rule here'
                        }
                        badge={
                          <span
                            className={`badge ${
                              r.target.isLot ? 'bg-buy-soft text-buy' : 'bg-warn-soft text-warn'
                            }`}
                          >
                            {r.target.isLot ? 'LOT' : 'raw'}
                          </span>
                        }
                        price={s.price}
                        held={s.shares}
                        canTrade={canTrade}
                        affordable={r.canAfford}
                        cash={portfolio.cash}
                        onGo={() =>
                          r.target.goal > s.shares
                            ? onBuy(s.id, 'target')
                            : onSell(s.id, 'target')
                        }
                        goLabel="Adjust to target"
                      />
                    )}
                  </td>

                  {/* ---- 5. the raw floor, and selling down to it ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    <Destination
                      shares={r.minShares}
                      caption={`the ${s.bandMin}% floor`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      tone="sell"
                      onGo={() => onSell(s.id, 'rawmax')}
                      goLabel="Sell to the floor"
                    />
                  </td>

                  {/* ---- 6. the lowest lot that still clears the floor ---- */}
                  <td className="td cell-fill">
                    <Destination
                      shares={r.lowerLot}
                      caption={`lot above the ${s.bandMin}% floor`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      onGo={() => onSell(s.id, 'lowlot')}
                      goLabel="Sell to lowest lot"
                    />
                  </td>

                  {/* ---- 7. the raw ceiling, and buying up to it ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    <Destination
                      shares={r.maxShares}
                      caption={
                        rawBuy.limiter === 'band'
                          ? `the ${s.bandMax}% ceiling`
                          : 'capped by cash, not the band'
                      }
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      tone="buy"
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onBuy(s.id, 'rawmax')}
                      goLabel="Buy to the ceiling"
                    />
                  </td>

                  {/* ---- 8. the highest lot that still clears the ceiling ---- */}
                  <td className="td cell-fill">
                    <Destination
                      shares={r.upperLot}
                      caption={`lot below the ${s.bandMax}% ceiling`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onBuy(s.id, 'highlot')}
                      goLabel="Buy to highest lot"
                    />
                  </td>

                  {/* ---- 9. what the idle cash could pay for ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    <SpendTheCash
                      stock={s}
                      affordable={r.canAfford}
                      maxShares={r.maxShares}
                      cash={portfolio.cash}
                      canTrade={canTrade}
                      onGo={() => onTradeTo(s.id, s.shares + r.canAfford)}
                    />
                  </td>

                  {/* ---- 10. the advisor's own number, and the way to shut the row ---- */}
                  <td className="td">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {canTrade && (
                          <WhatIfCell portfolio={portfolio} stock={s} onTrade={onTradeTo} />
                        )}
                      </div>
                      <RowToggle
                        label={s.sym}
                        open
                        onToggle={() => collapse.toggle(s.id, settled)}
                      />
                    </div>
                  </td>
                </tr>

                {/* The folded columns, under the row rather than beside it. `colSpan` is the wide
                    column count; a browser clamps it to however many columns are actually
                    showing, so one number is right on both sides of the breakpoint. */}
                <tr className={`${stripe} ${breach} wide:hidden`}>
                  {/* Not `.td`: the strip carries its own padding, and the border here is the one
                      the row above gave up so the pair reads as a single record. */}
                  <td className="border-b border-line-soft" colSpan={10}>
                    <BandStrip
                      stock={s}
                      minShares={r.minShares}
                      maxShares={r.maxShares}
                      rawBuy={rawBuy}
                      rawSell={rawSell}
                      cash={portfolio.cash}
                      canTrade={canTrade}
                      onBuy={onBuy}
                      onSell={onSell}
                      onSpend={() => onTradeTo(s.id, s.shares + r.canAfford)}
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
