import { Fragment } from 'react';
import RowToggle from './RowToggle';
import { NumInput } from './Inputs';
import { FOLD, POSITION_COLUMNS, PositionsHead } from './PositionsHead';
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
  RawMaxBuy,
  totalValue,
  weight,
} from '@/lib/engine';
import { money, pct, shares as fmtShares } from '@/lib/format';
import { LotEdge, Portfolio, Stock } from '@/lib/types';
import { RowCollapse } from '@/lib/useRowCollapse';

interface Props {
  portfolio: Portfolio;
  /** Stock ids with something to undo, so the per-row reset can be disabled when it is a no-op. */
  resettable: Set<string>;
  /** Trades to the model's lot-aware answer for this row. */
  onTarget: (stockId: string) => void;
  /** Trades to a band-edge lot, whichever side of the holding that lot happens to be on. */
  onLot: (stockId: string, edge: LotEdge) => void;
  /** Trades to the band edge itself, with no lot preference. */
  onEdge: (stockId: string, edge: LotEdge) => void;
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
  const { minShares, maxShares } = bandShareLimits(p, s);
  const target = lotAwareTarget(p, s);
  const high = highestLotWithinBand(p, s);
  const low = lowestLotWithinBand(p, s);
  const lots = lotRounds(s);

  return {
    /* The band edges as plain share counts: the fewest that stay at or above the floor, the most
       that stay at or below the ceiling. */
    minShares,
    maxShares,
    /** The raw target in whole shares, before the lot rule has any say. */
    targetShares: Math.round(target.raw),
    target,
    /* The nearest lot inside each edge — or the edge itself where no lot on that side serves the
       position, which is what `isLot` reports. Null where the lot rule does not apply at all,
       which is true of anything bought in dollars with fractional shares. */
    lowerLot: lots ? low.lowestLot : null,
    lowerIsLot: low.isLot,
    upperLot: lots ? high.highestLot : null,
    upperIsLot: high.isLot,
    lots,
    /** What the lot-aware goal comes to as a share of the account — stated only where the lot
     *  sits outside the band and needs to account for itself. */
    goalPct: (() => {
      const t = totalValue(p);
      return t > 0 ? ((target.goal * s.price) / t) * 100 : 0;
    })(),
    canAfford: affordableShares(p, s),
    buyToTarget: Math.max(target.goal - s.shares, 0),
    sellToTarget: Math.max(s.shares - target.goal, 0),
    weight: weight(p, s),
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
  /**
   * What the figure is, where the column header does not already say it.
   *
   * Optional, and left off most columns on purpose. "Lot closest to lower band" over a cell
   * reading "200 sh · lot above the 2% floor" says the same thing twice, and eight columns each
   * saying it twice is what made a row take a paragraph to read. The band edges keep a bare
   * percentage, because the header names the edge but not where it sits.
   */
  caption?: string;
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
  /*
   * The button is always drawn, and disabled when there is nothing to do.
   *
   * A missing button leaves a hole in the line the others make, which is the whole thing the
   * bottom-alignment was for. It also reads as an oversight rather than an answer: a greyed
   * button with "Already holding 600 shares" on hover says the action exists and why it is
   * unavailable, where an empty cell says nothing at all.
   */
  if (shares === null) {
    return (
      <div className="cell-inner">
        <div>
          {caption && <span className="sub !mt-0">{caption}</span>}
          <span className="badge mt-2 bg-warn-soft text-warn">no lot here</span>
        </div>
        {canTrade && onGo && (
          <div className="cell-action">
            <button
              className="btn-ghost"
              disabled
              title="There is no round lot on this side of the band to trade to."
            >
              Trade
            </button>
          </div>
        )}
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
        {caption && <span className="sub">{caption}</span>}

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
      {canTrade && onGo && (
        <div className="cell-action">
          <button
            className={
              action === null ? 'btn-ghost' : action === 'BUY' ? 'btn-buy' : 'btn-sell'
            }
            disabled={
              action === null || (action === 'BUY' && affordable !== undefined && affordable <= 0)
            }
            aria-label={goLabel}
            title={
              action === null
                ? `Already holding ${fmtShares(shares)} shares.`
                : goLabel
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
  total,
  canTrade,
  onGo,
}: {
  stock: Stock;
  affordable: number;
  maxShares: number;
  /** Total account value, to say what weight the position would end at. */
  total: number;
  canTrade: boolean;
  onGo: () => void;
}) {
  const landing = stock.shares + affordable;
  const breaches = landing > maxShares;
  /* A buy swaps cash for shares, so the account total does not move and the resulting weight is
     just the landing holding over the same denominator. */
  const landingPct = total > 0 ? ((landing * stock.price) / total) * 100 : 0;

  return (
    <div className="cell-inner">
      <div>
        <span className="text-[15px] font-semibold">{fmtShares(affordable)} sh</span>
        {affordable > 0 && (
          <>
            <span className="sub">Total {fmtShares(landing)} sh</span>
            {/* Where that lands as a share of the account, rather than how far past the ceiling
                it is in shares. The percentage is the language the whole page measures in, and it
                answers the breach question by itself: red is the ceiling being passed. */}
            <span className={`sub ${breaches ? 'font-semibold text-danger' : ''}`}>
              {pct(landingPct)}
            </span>
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
  total,
  canTrade,
  onEdge,
  onSpend,
}: {
  stock: Stock;
  minShares: number;
  maxShares: number;
  rawBuy: RawMaxBuy;
  /** Total account value, to say what weight spending the cash would end at. */
  total: number;
  canTrade: boolean;
  onEdge: (stockId: string, edge: LotEdge) => void;
  /** Buys every share the cash affords, band or no band. */
  onSpend: () => void;
}) {
  /* Each edge is a destination, so the move it needs depends on which side of it the position
     sits. A holding under its own floor buys up to it; the strip says so rather than offering a
     greyed "Sell to the floor" that was never the trade. */
  const toFloor = minShares - stock.shares;
  const toCeiling = maxShares - stock.shares;
  const unaffordable = (delta: number) => delta > 0 && rawBuy.cashAfford <= 0;

  const landing = stock.shares + rawBuy.cashAfford;
  const landingPct = total > 0 ? ((landing * stock.price) / total) * 100 : 0;

  return (
    <div className="px-3 pt-1 pb-4">
      <span className={`${CAPTION} text-ink-faint`}>The band edges, and what the cash buys</span>

      <div className="mt-2.5 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <StripFigure
          label="Lower band"
          action={
            canTrade && (
              <button
                className={toFloor > 0 ? 'btn-buy' : 'btn-sell'}
                disabled={toFloor === 0 || unaffordable(toFloor)}
                onClick={() => onEdge(stock.id, 'low')}
              >
                {toFloor > 0 ? 'Buy up to the floor' : 'Sell to the floor'}
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-sell">{fmtShares(minShares)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">{stock.bandMin}%</span>
        </StripFigure>

        <StripFigure
          label="Upper band"
          action={
            canTrade && (
              <button
                className={toCeiling < 0 ? 'btn-sell' : 'btn-buy'}
                disabled={toCeiling === 0 || unaffordable(toCeiling)}
                onClick={() => onEdge(stock.id, 'high')}
              >
                {toCeiling < 0 ? 'Sell down to the ceiling' : 'Buy to the ceiling'}
              </button>
            )
          }
        >
          <span className="text-[15px] font-semibold text-buy">{fmtShares(maxShares)} sh</span>
          <span className="font-mono text-[12px] text-ink-soft">{stock.bandMax}%</span>
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
            Total {fmtShares(landing)} sh
          </span>
          <span
            className={`font-mono text-[12px] ${
              landing > maxShares ? 'font-semibold text-danger' : 'text-ink-soft'
            }`}
          >
            {pct(landingPct)}
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
  onTarget,
  onLot,
  onEdge,
  onResetStock,
  onPrice,
  onTradeTo,
  collapse,
}: Props) {
  /* Read once for the whole table rather than per row: a trade swaps cash for shares, so this
     denominator is the same for every row being drawn in this pass. */
  const total = totalValue(portfolio);

  return (
    <div className="table-stick">
      <table className="w-full border-collapse">
        <PositionsHead />
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
                <tr key={s.id} className="bg-danger-soft shadow-[inset_4px_0_0_0_var(--color-danger)]">
                  <td className="td font-sans text-[15px] font-bold">
                    {s.sym}
                    {/* Its own line, sized to its text: inline it collides with a four-letter
                        ticker, and full width it reads as a banner rather than a label. */}
                    <span className="badge mt-1.5 block w-fit bg-danger text-white">
                      NEEDS A PRICE
                    </span>
                    <span className="sub">
                      {s.target}% &middot; {s.bandMin}&ndash;{s.bandMax}%
                    </span>
                  </td>
                  {/* Everything but the ticker beside it. */}
                  <td className="td" colSpan={POSITION_COLUMNS.length - 1}>
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Two different faults wear the same red, and saying the wrong one is
                          worse than saying neither. A row holding shares with no price is
                          missing from the account total, which drags every other weight up. A
                          row holding nothing distorts no total at all — zero shares are worth
                          zero at any price — it simply cannot be turned into a share count. */}
                      <span className="font-sans text-[13.5px] font-semibold text-danger">
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
            const breach = r.mandatory ? 'shadow-[inset_3px_0_0_0_var(--color-danger)]' : '';

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
                      <span className="badge ml-2.5 bg-danger-soft text-danger">
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
                        {/* The mandate, stated once and in full, which is what lets every column
                            to the right drop its own copy of it. Both lines carry the same weight
                            because they are read together: a target means nothing without the
                            band it may drift inside. */}
                        {/* Neither line may wrap: "Band 35%–" over "45%" reads as two figures,
                            and the column is only this narrow because the captions to its right
                            went away. Holding them on one line is what claims the width back. */}
                        <div className="mt-2 font-sans text-[13.5px] font-semibold whitespace-nowrap">
                          Target {s.target}%
                        </div>
                        <div className="mt-1 font-sans text-[13.5px] font-semibold whitespace-nowrap">
                          Band {s.bandMin}%&ndash;{s.bandMax}%
                        </div>
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
                          className="btn-amber"
                          disabled={!resettable.has(s.id)}
                          onClick={() => onResetStock(s.id)}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </td>

                  {/* ---- 2. where it actually sits ----

                       No band bar here. It was 128px of fixed width on a column whose figures
                       need barely half that, and it was drawing what the numbers next to it
                       already say: the weight, and whether that weight is outside the band. On
                       the cash tile it earns its space, because there is one of it; twenty-odd
                       of them down a table cost a column's width each and add nothing. */}
                  <td className="td">
                    <span className="text-[15px] font-semibold">{fmtShares(s.shares)} sh</span>
                    {/* Where it sits, and nothing about where it may sit — the band is stated in
                        full one column to the left. */}
                    <span className={`sub ${r.mandatory ? 'font-semibold text-danger' : ''}`}>
                      {pct(r.weight)}
                    </span>
                    <span className="sub">{money(s.shares * s.price)}</span>
                    {/* Just the direction. "MANDATORY, over band" set the width of this column on
                        every breached row, and the word carried nothing the red badge and the red
                        weight above it were not already saying. The shut row has always read
                        "over band" alone, so the two now agree. */}
                    {r.mandatory && (
                      <span className="badge mt-2 bg-danger-soft text-danger">
                        {r.mandatory} band
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
                        /* A lot that is not simply the nearest one says where it lands. On a $316
                           stock one lot is about a point of the account, so being pushed a rung up
                           to reach the band can sit a long way from the target — and that should
                           not be discovered after the trade. Silent on every ordinary row. */
                        caption={r.target.pushed ? pct(r.goalPct) : undefined}
                        badge={
                          <span
                            className={`badge ${
                              r.target.isLot ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'
                            }`}
                            title={
                              r.target.pushed
                                ? `The nearest lot to the ${s.target}% target does not fit the ${s.bandMin}–${s.bandMax}% band, so this is the nearest one that does. It lands at ${pct(r.goalPct)}.`
                                : undefined
                            }
                          >
                            {r.target.isLot ? 'LOT' : 'raw'}
                          </span>
                        }
                        price={s.price}
                        held={s.shares}
                        canTrade={canTrade}
                        affordable={r.canAfford}
                        cash={portfolio.cash}
                        onGo={() => onTarget(s.id)}
                        goLabel="Adjust to target"
                      />
                    )}
                  </td>

                  {/* ---- 5. the raw floor, and selling down to it ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    <Destination
                      shares={r.minShares}
                      caption={`${s.bandMin}%`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      tone="sell"
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onEdge(s.id, 'low')}
                      goLabel="Trade to the floor"
                    />
                  </td>

                  {/* ---- 6. the lowest lot that still clears the floor ---- */}
                  <td className="td cell-fill">
                    <Destination
                      shares={r.lowerLot}
                      /* Where no lot serves this side, the figure is the floor itself. Badged, or
                         a plain share count sits under a heading promising a lot. */
                      badge={
                        r.lowerIsLot ? undefined : (
                          <span
                            className="badge bg-warn-soft text-warn"
                            title={`No round lot sits between this stock's ${s.bandMin}% floor and its target, so the floor itself is the answer.`}
                          >
                            raw
                          </span>
                        )
                      }
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onLot(s.id, 'low')}
                      goLabel="Trade to the lot nearest the floor"
                    />
                  </td>

                  {/* ---- 7. the raw ceiling, and buying up to it ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    {/* Plainly the band ceiling in shares, which is what this figure has always
                        been: `bandShareLimits` never consults the cash. The old caption switched
                        to "capped by cash, not the band" on a limiter that describes the *buy*,
                        not the number printed here. */}
                    <Destination
                      shares={r.maxShares}
                      caption={`${s.bandMax}%`}
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      tone="buy"
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onEdge(s.id, 'high')}
                      goLabel="Trade to the ceiling"
                    />
                  </td>

                  {/* ---- 8. the highest lot that still clears the ceiling ---- */}
                  <td className="td cell-fill">
                    <Destination
                      shares={r.upperLot}
                      badge={
                        r.upperIsLot ? undefined : (
                          <span
                            className="badge bg-warn-soft text-warn"
                            title={`No round lot sits between this stock's target and its ${s.bandMax}% ceiling, so the ceiling itself is the answer.`}
                          >
                            raw
                          </span>
                        )
                      }
                      price={s.price}
                      held={s.shares}
                      canTrade={canTrade}
                      affordable={r.canAfford}
                      cash={portfolio.cash}
                      onGo={() => onLot(s.id, 'high')}
                      goLabel="Trade to the lot nearest the ceiling"
                    />
                  </td>

                  {/* ---- 9. what the idle cash could pay for ---- */}
                  <td className={`td cell-fill ${FOLD}`}>
                    <SpendTheCash
                      stock={s}
                      affordable={r.canAfford}
                      maxShares={r.maxShares}
                      total={total}
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
                  <td className="border-b border-line-soft" colSpan={POSITION_COLUMNS.length}>
                    <BandStrip
                      stock={s}
                      minShares={r.minShares}
                      maxShares={r.maxShares}
                      rawBuy={rawBuy}
                      total={total}
                      canTrade={canTrade}
                      onEdge={onEdge}
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
