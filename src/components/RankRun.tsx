import { RankOutcome } from '@/lib/actions';
import { money } from '@/lib/format';
import { Stage, StopAt } from '@/lib/rank';
import { Portfolio } from '@/lib/types';

/**
 * The ranked deployment: one press that sells what the model never asked for, brings every
 * position to the mandate, and then spends what is left strictly down the advisor's order.
 *
 * Kept apart from the three universal buttons beside it, and deliberately. Those apply one column
 * of the table to every row — the figure each position lands on is already printed on its own
 * row, which is what makes them safe to press without a preview. This one is a sequence: it sells,
 * it reads an order, and where it stops depends on how much the earlier steps raised. Same panel,
 * because both move money; its own group, because they are not the same kind of thing.
 */

/** What each rung is called where the advisor reads it, rather than in the engine's shorthand. */
const STAGE_NAME: Record<Stage, string> = {
  floor: 'band floor',
  'lot-low': 'lowest lot',
  target: 'target lot',
  'lot-high': 'highest lot',
};

/**
 * Both read as "spend down to here, no further", because that is what each one does.
 *
 * The ceiling option was first labelled "Stop at the cash ceiling", which promised something it
 * cannot deliver. Steps are taken whole, so there is rarely a buy that lands cash exactly on the
 * ceiling: the run stops before the step that would cross it, leaving the balance a little *above*
 * — 8.36% against an 8% ceiling in the worked example. "Spend to" is honest about the direction and
 * silent about the landing; "stop at" named a figure the run does not reach.
 */
const STOP_LABEL: Record<StopAt, string> = {
  floor: 'Spend to the cash floor',
  ceiling: 'Spend to the cash ceiling',
};

export function RankRunButton({
  portfolio,
  ranked,
  stopAt,
  onStopAt,
  onRun,
  onEditRanks,
  blockers,
}: {
  portfolio: Portfolio;
  /** How many positions carry a rank. Nothing to deploy into while this is zero. */
  ranked: number;
  stopAt: StopAt;
  onStopAt: (stopAt: StopAt) => void;
  onRun: () => void;
  /** Opens the model editor, where the order is set. */
  onEditRanks: () => void;
  /** Why the run cannot be made. Empty when it can. */
  blockers: string[];
}) {
  const stopped = blockers[0] ?? null;

  return (
    <div
      className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md
                 border border-line bg-panel-alt px-3.5 py-2.5"
    >
      <div className="min-w-0 text-[13.5px]">
        <span className="font-semibold">Ranked deployment</span>{' '}
        <span className="text-ink-soft">
          {ranked === 0 ? (
            <>
              · nothing ranked yet, so the cash has nowhere to go.{' '}
              <button className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent" onClick={onEditRanks}>
                Set the order
              </button>
            </>
          ) : (
            <>
              · {ranked} ranked, {portfolio.stocks.length - ranked} held at their floor ·{' '}
              <button className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent" onClick={onEditRanks}>
                Change the order
              </button>
            </>
          )}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Where the run stops spending, the one decision in it that is not about a stock. Beside
            the button rather than inside a dialog, because it changes what the press does. */}
        <select
          className="field h-[30px] w-auto py-0 text-[12.5px]"
          value={stopAt}
          onChange={(e) => onStopAt(e.target.value as StopAt)}
          title={
            stopAt === 'floor'
              ? `Deploys every dollar the mandate allows, down to the ${portfolio.cashFloor}% floor less half a point.`
              : `Keeps the cash: no buy that would take the balance under its ${portfolio.cashCeiling}% ceiling. Steps are taken whole, so it stops a little above rather than exactly on it.`
          }
        >
          <option value="floor">{STOP_LABEL.floor}</option>
          <option value="ceiling">{STOP_LABEL.ceiling}</option>
        </select>

        <button
          className="btn-solid"
          disabled={stopped !== null || ranked === 0}
          title={stopped ?? (ranked === 0 ? NOTHING_RANKED : RUN_HINT)}
          onClick={onRun}
        >
          Deploy by rank
        </button>
      </div>
    </div>
  );
}

const NOTHING_RANKED =
  'No position is ranked, so there is nothing for the run to deploy into. Number them under Edit model & cash band — 1 gets first call on the cash.';

const RUN_HINT =
  'Sells every off-model holding, takes every position to its band floor, then works down the conviction order: lowest lot, target lot, highest lot. A step the cash cannot cover whole is skipped and the next rank gets its turn. One press, one undo.';

/**
 * What the run did.
 *
 * Longer than the one line the universal buttons report, because the run did more than one thing
 * and each part is separately worth knowing: what the selling raised, what the mandate cost, how
 * far down the order the money reached, and where it stopped. Compressed as far as it goes and no
 * further — a run that silently spends a third of the account should not summarise itself in six
 * words.
 */
export function RankRunResult({
  outcome,
  portfolio,
  undoable,
  onUndo,
}: {
  outcome: RankOutcome;
  portfolio: Portfolio;
  /** False once anything else has happened, when this is no longer the press an undo would take. */
  undoable: boolean;
  onUndo: () => void;
}) {
  const opening = [
    outcome.offModelSold > 0 &&
      `sold ${outcome.offModelSold} off-model holding${
        outcome.offModelSold === 1 ? '' : 's'
      } for ${money(outcome.offModelProceeds)}`,
    outcome.floorTraded > 0 && `${outcome.floorTraded} to their band floor`,
  ].filter(Boolean) as string[];

  return (
    <div
      className="mx-4 mb-3 rounded-md border border-line bg-panel-alt px-3.5 py-2.5 text-[13.5px]"
      role="status"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <span className="font-semibold">
            {outcome.steps.length} trade{outcome.steps.length === 1 ? '' : 's'}
          </span>{' '}
          <span className="text-ink-soft">
            {opening.length > 0 ? `· ${opening.join(' · ')}` : '· nothing to sell or square off'}
            {` · ${outcome.ranked} ranked, ${outcome.unranked} left at the floor`}
          </span>
        </div>

        {undoable && (
          <button className="btn-ghost shrink-0" onClick={onUndo}>
            Undo the whole run
          </button>
        )}
      </div>

      {/* Where the money actually went, best first. The single most useful line here: it says how
          far down his own order the cash reached, which is the question the ranking exists to ask. */}
      {outcome.landed.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] tabular-nums">
          {outcome.landed.map((l) => (
            <li key={l.sym} className={l.reached === null ? 'text-ink-faint' : ''}>
              <span className="text-ink-faint">{l.rank}.</span>{' '}
              <span className="font-sans font-semibold">{l.sym}</span>{' '}
              <span className={l.reached === 'lot-high' ? 'text-accent' : 'text-ink-soft'}>
                {l.reached ? STAGE_NAME[l.reached] : 'unmoved'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <span className="text-ink-soft">Cash</span>{' '}
          <span className="font-mono font-semibold tabular-nums">{money(outcome.cashAfter)}</span>{' '}
          <span className="font-mono tabular-nums text-ink-soft">
            ({outcome.cashPctAfter.toFixed(2)}%)
          </span>{' '}
          <span className="text-ink-faint">
            band {portfolio.cashFloor}–{portfolio.cashCeiling}%
          </span>
        </span>

        {/* The mandate cost more than the account had. Not a thing the run may decline to do, so
            it is reported rather than prevented. */}
        {outcome.floorOverspend > 0 && (
          <span className="font-semibold text-danger">
            Meeting the floors alone went {money(outcome.floorOverspend)} past the limit.
          </span>
        )}

        {/* The two endings, which call for opposite responses. */}
        {outcome.stopped === 'cash' ? (
          <span className="text-warn">
            Stopped on cash: {outcome.skipped.length} step
            {outcome.skipped.length === 1 ? '' : 's'} skipped, the first being{' '}
            <span className="font-semibold">{outcome.skipped[0].sym}</span> to its{' '}
            {STAGE_NAME[outcome.skipped[0].stage]} at {money(outcome.skipped[0].needed)}.
          </span>
        ) : (
          outcome.cashAboveCeiling && (
            <span className="text-warn">
              Every ranked position reached its ceiling and the cash is still above its own. Rank
              more of them to put the rest to work.
            </span>
          )
        )}
      </div>
    </div>
  );
}
