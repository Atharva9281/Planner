'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Slot, setWorkspace, useHydrated, useWorkspaces } from '@/lib/workspaces';
import CashStatus from '@/components/CashStatus';
import ConfirmDialog from '@/components/ConfirmDialog';
import Panel from '@/components/Panel';
import { CollapseAll } from '@/components/RowToggle';
import StuckHeader from '@/components/StuckHeader';
import SkeletonWorkspace from '@/components/SkeletonWorkspace';
import HoldingsModal from '@/components/HoldingsModal';
import LotAwareTable from '@/components/LotAwareTable';
import ModelModal from '@/components/ModelModal';
import TradeLog from '@/components/TradeLog';
import ImportDialog from '@/components/import/ImportDialog';
import {
  addOffModel,
  addStock,
  applyTrade,
  clearAll,
  removeOffModel,
  removeStock,
  resetAll,
  resetStock,
  sellOffModel,
  setCash,
  setCashBand,
  setOffModelField,
  setStockField,
  setStockShares,
  undoLast,
} from '@/lib/actions';
import { ParsedImport } from '@/lib/import/types';
import { priceAge } from '@/lib/format';
import { needsDecision, planBuy, planSell, planToShares, unpricedPositions } from '@/lib/engine';
import { BuyMode, ExplorerState, SellMode } from '@/lib/types';
import { useRowCollapse } from '@/lib/useRowCollapse';
import { downloadTradeLog } from '@/lib/xlsx/download';

type OpenModal = 'holdings' | 'model' | 'import' | null;

/**
 * One workspace, over whichever slot the route names. The state itself lives in the provider
 * above the routes, so navigating away and back — including with the browser's Back button —
 * returns to exactly what was here.
 */
export default function Explorer({ slot }: { slot: Slot }) {
  const state = useWorkspaces()[slot];
  /* One render has to match the server's HTML, which knows nothing about this tab. Until then a
     restored portfolio would flash its upload screen on the way in. */
  const hydrated = useHydrated();
  const setState = (next: ExplorerState | ((cur: ExplorerState) => ExplorerState)) =>
    setWorkspace(slot, next);

  const [openModal, setOpenModal] = useState<OpenModal>(null);
  /** A parse started from the landing page, handed to the review dialog when it opens. */
  const [pendingImport, setPendingImport] = useState<ParsedImport | null>(null);
  /** A pending discard, held until the advisor confirms it. Null when nothing is being asked. */
  const [confirming, setConfirming] = useState<null | 'clear'>(null);

  const { portfolio, baseline, log } = state;
  const isEmpty = portfolio.stocks.length === 0 && portfolio.offModel.length === 0;

  /* How old the loaded prices are. Recomputed each render rather than memoised: the answer
     depends on the clock, not only on the state. */
  const age = priceAge(state.source?.loadedAt);

  /** Positions with no price. While any exist, the account total is wrong and so is every weight
   *  derived from it, which is why the trade log will not export. */
  const unpriced = unpricedPositions(portfolio);

  /** What a discard would actually cost, in the words the confirmation uses. */
  const atRisk = [
    log.length > 0 && `${log.length} trade${log.length === 1 ? '' : 's'} on the log`,
    !isEmpty && `the loaded account${state.source?.label ? ` (${state.source.label})` : ''}`,
  ].filter(Boolean) as string[];

  /* Watching a one-pixel marker beats reading scrollY: it needs no threshold to tune, and it
     stays correct when the header above it changes height. */
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) {
      setStuck(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
    /* `hydrated` belongs here as much as `isEmpty` does: the sentinel is not in the DOM until
       hydration finishes, so an effect that runs only on mount finds nothing to observe and the
       compact bar never appears. Both flags gate whether the marker exists to watch. */
  }, [isEmpty, hydrated]);

  /**
   * Stocks a per-row reset would actually change: either they carry trades on the log, or their
   * share count has drifted from the baseline.
   */
  const resettable = useMemo(() => {
    const ids = new Set(log.filter((e) => e.stockId).map((e) => e.stockId as string));
    portfolio.stocks.forEach((s) => {
      if (s.shares !== (baseline.shares[s.id] ?? 0)) ids.add(s.id);
    });
    return ids;
  }, [log, portfolio.stocks, baseline.shares]);

  /** How many rows the model is still asking something of — the shut panel's whole story. */
  const pending = useMemo(
    () => portfolio.stocks.filter((s) => needsDecision(portfolio, s)).length,
    [portfolio],
  );

  /* Row state for the table, held here so the panel can put Expand all and Collapse all on its
     own header line instead of giving them a row of their own. */
  const rowState = useRowCollapse(portfolio.stocks.map((s) => s.id));

  /* Trades read the stock out of the state being updated, never a captured copy, so a rapid
     double click cannot price its second trade off the pre-first-click portfolio. */
  const handleBuy = (stockId: string, mode: BuyMode) =>
    setState((cur) => {
      const stock = cur.portfolio.stocks.find((s) => s.id === stockId);
      if (!stock) return cur;
      const plan = planBuy(cur.portfolio, stock, mode);
      return plan ? applyTrade(cur, plan) : cur;
    });

  const handleSell = (stockId: string, mode: SellMode) =>
    setState((cur) => {
      const stock = cur.portfolio.stocks.find((s) => s.id === stockId);
      if (!stock) return cur;
      const plan = planSell(cur.portfolio, stock, mode);
      return plan ? applyTrade(cur, plan) : cur;
    });

  const closeImport = () => {
    setOpenModal(null);
    setPendingImport(null);
  };

  const handleTradeTo = (stockId: string, targetShares: number) =>
    setState((cur) => {
      const stock = cur.portfolio.stocks.find((s) => s.id === stockId);
      if (!stock) return cur;
      const plan = planToShares(cur.portfolio, stock, targetShares);
      return plan ? applyTrade(cur, plan) : cur;
    });

  const openModelWithNewStock = () => {
    setState(addStock);
    setOpenModal('model');
  };

  return (
    <div className="mx-auto max-w-[100rem] px-5 py-6 sm:px-7">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-5">
        {/* Wide enough to hold the title on one line at 1280, so the button group beside it wraps
            onto a line of its own rather than breaking the heading in half. */}
        <div className="min-w-[27rem] flex-1">
          {/* The title is the way home. Browser Back does the same thing, and both are safe:
              the workspace lives above the routes, so leaving this page does not empty it. */}
          <Link href="/" className="inline-block">
            <h1 className="text-[26px] font-bold tracking-[-0.015em] hover:text-accent">
              Cash Deployment Explorer, Lot-Aware
            </h1>
          </Link>

          {/* What is loaded, on the title line rather than in a strip of its own. The badge is
              the one thing that must not be lost: sample figures read exactly like real ones. */}
          {!isEmpty && (
            <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
              <span
                className={`badge ${
                  state.source?.kind === 'sample'
                    ? 'bg-warn text-white'
                    : 'bg-accent-soft text-accent'
                }`}
              >
                {state.source?.kind === 'sample' ? 'EXAMPLE' : 'LOADED'}
              </span>
              <span className="text-[15px] font-bold">
                {state.source?.label ?? 'Untitled portfolio'}
              </span>
              {state.source?.kind === 'sample' && (
                <span className="text-[13.5px] text-warn">sample numbers, not a real account</span>
              )}

              {/* When these prices were exported, next to whose account they are. Every figure on
                  the page comes from a price, and a workspace that survives the window can be any
                  age by the time it is looked at again. */}
              {age && (
                <span
                  className={`text-[13.5px] ${
                    age.stale ? 'font-semibold text-warn' : 'text-ink-soft'
                  }`}
                >
                  {age.label}
                  {age.stale &&
                    ` · prices are ${age.days} day${age.days === 1 ? '' : 's'} old`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Every action that belongs to the whole workspace rather than to one position, in one
            group. The compact bar has always carried these four together; the page header now
            matches it, and moving the two Edit buttons up here is what frees the row below for
            the tiles, which could not fit five figures and two buttons on one line. */}
        {!isEmpty && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-outline"
              disabled={log.length === 0}
              onClick={() => setState(undoLast)}
            >
              Undo last action
            </button>
            <button
              className="btn-outline"
              disabled={log.length === 0}
              onClick={() => setState(resetAll)}
            >
              Reset everything to starting state
            </button>
            <button className="btn-outline" onClick={() => setOpenModal('holdings')}>
              Edit starting holdings
            </button>
            <button className="btn-outline" onClick={() => setOpenModal('model')}>
              Edit model &amp; cash band
            </button>
            {/* Not a way back — Back does that. This throws the account away so different files
                can be loaded, which no navigation does. */}
            {slot === 'portfolio' && (
              <button className="btn-outline" onClick={() => setConfirming('clear')}>
                Load different files
              </button>
            )}
          </div>
        )}
      </header>

      {!hydrated ? (
        <div className="min-h-[60vh]" aria-hidden />
      ) : isEmpty ? (
        <SkeletonWorkspace
          onReady={(parsed) => {
            setPendingImport(parsed);
            setOpenModal('import');
          }}
          onAddStock={openModelWithNewStock}
        />
      ) : (
        <>
          <div className="mb-5">
            <CashStatus portfolio={portfolio} />
          </div>

          {/* The last thing above the tables. The moment it leaves the top of the window, the
              compact bar takes over; while it is on screen there is nothing to duplicate. */}
          <div ref={sentinel} aria-hidden className="h-px" />

          <StuckHeader
            portfolio={portfolio}
            source={state.source}
            visible={stuck}
            canUndo={log.length > 0}
            onUndo={() => setState(undoLast)}
            onResetAll={() => setState(resetAll)}
            onEditHoldings={() => setOpenModal('holdings')}
            onEditModel={() => setOpenModal('model')}
          />

          <div className="mb-4">
            <Panel
              title="Every position, lot-aware and raw, in one row"
              summary={
                pending === 0
                  ? `${portfolio.stocks.length} positions · all at target`
                  : `${portfolio.stocks.length} positions · ${pending} needing a decision`
              }
              description={
                <p className="mt-2 max-w-[72rem] text-[13.5px] leading-relaxed text-ink-soft">
                  The lot-aware answer and the raw maximum for the same position, side by side.
                  A position inside its band and already at target starts collapsed, so the height
                  goes where the decisions are. Every row opens and shuts on its own chevron.
                </p>
              }
              actions={<CollapseAll collapse={rowState} />}
            >
              <LotAwareTable
                portfolio={portfolio}
                resettable={resettable}
                onBuy={handleBuy}
                onSell={handleSell}
                onResetStock={(id) => setState((cur) => resetStock(cur, id))}
                onPrice={(id, price) => setState((cur) => setStockField(cur, id, 'price', price))}
                onTradeTo={handleTradeTo}
                collapse={rowState}
              />
            </Panel>
          </div>

          <Panel
            title="Trade log"
            actions={
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {/* A disabled button with no reason beside it reads as a broken button. Say what
                    is wrong and name the rows, so the fix is one glance away. */}
                {unpriced.length > 0 && (
                  <span className="max-w-[28rem] text-right text-[13px] font-semibold text-sell">
                    {unpriced.length} position{unpriced.length === 1 ? '' : 's'} without a price
                    {' ('}
                    {unpriced.map((s) => s.sym).join(', ')}
                    {'). '}
                    Every weight here is overstated until they are priced.
                  </span>
                )}
                <button
                  className="btn-outline shrink-0"
                  disabled={log.length === 0 || unpriced.length > 0}
                  title={
                    unpriced.length > 0
                      ? 'The export would carry percentages that are wrong, because an unpriced holding is missing from total account value.'
                      : undefined
                  }
                  onClick={() => downloadTradeLog(state)}
                >
                  Download as Excel
                </button>
              </div>
            }
            summary={
              log.length === 0
                ? 'no trades yet'
                : `${log.length} trade${log.length === 1 ? '' : 's'}`
            }
            description={
              <p className="mt-2 max-w-[64rem] text-[13.5px] leading-relaxed text-ink-soft">
                Every trade this session, oldest first, with the cash balance carried down the
                column as each one lands.
              </p>
            }
          >
            <TradeLog log={log} portfolio={portfolio} />
          </Panel>
        </>
      )}

      {openModal === 'holdings' && (
        <HoldingsModal
          portfolio={portfolio}
          onClose={() => setOpenModal(null)}
          onShares={(id, shares) => setState((cur) => setStockShares(cur, id, shares))}
          onPrice={(id, price) => setState((cur) => setStockField(cur, id, 'price', price))}
          onCash={(cash) => setState((cur) => setCash(cur, cash))}
          onAddOffModel={() => setState(addOffModel)}
          onOffModelField={(id, field, value) =>
            setState((cur) => setOffModelField(cur, id, field, value))
          }
          onSellOffModel={(id) => setState((cur) => sellOffModel(cur, id))}
          onRemoveOffModel={(id) => setState((cur) => removeOffModel(cur, id))}
        />
      )}

      {openModal === 'import' && (
        <ImportDialog
          initial={pendingImport ?? undefined}
          onClose={closeImport}
          onApply={(next) => {
            setState(next);
            closeImport();
          }}
        />
      )}

      {openModal === 'model' && (
        <ModelModal
          portfolio={portfolio}
          onClose={() => setOpenModal(null)}
          onField={(id, field, value) => setState((cur) => setStockField(cur, id, field, value))}
          onAddStock={() => setState(addStock)}
          onRemoveStock={(id) => setState((cur) => removeStock(cur, id))}
          onCashBand={(field, value) => setState((cur) => setCashBand(cur, field, value))}
          onClearAll={() => {
            setOpenModal(null);
            setConfirming('clear');
          }}
        />
      )}

      {/* Both routes to an empty workspace land here first. */}
      {confirming === 'clear' && (
        <ConfirmDialog
          title="Discard this portfolio?"
          confirmLabel="Discard and start over"
          body={
            <>
              <p>
                This clears {atRisk.join(' and ')}, and returns to the upload screen.
              </p>
              <p className="mt-3 text-ink-soft">
                The two exports cannot be read back automatically, so anything decided here would
                have to be worked through again. Download the trade log first if you need it.
              </p>
            </>
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            setState(clearAll);
          }}
        />
      )}
    </div>
  );
}
