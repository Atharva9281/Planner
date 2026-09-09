import { BulkOutcome } from '@/lib/actions';
import { money } from '@/lib/format';
import { Destination } from '@/lib/types';

/**
 * The three destinations, in the order the band runs: the lot above the floor, the model's own
 * answer, the lot below the ceiling.
 *
 * Each one is a column of the table applied to every row at once. Nothing is optimised or
 * allocated — the number each position lands on is the number already printed in that column —
 * which is why these can be buttons at all rather than a plan to review.
 */
/** Said on all three, since the cash rule is the same one whichever destination is pressed. */
const CASH_HINT =
  ' Every position lands on its number whether or not the cash covers it — if the buying runs the cash negative, the line above the table says by how much, and what to sell to raise it is your call.';

const CHOICES: { destination: Destination; label: string; hint: string }[] = [
  {
    destination: 'lot-low',
    label: 'To lowest lot',
    hint: 'Takes every position to the round lot just inside its own band floor.',
  },
  {
    destination: 'target',
    label: 'To target lot',
    hint: "Takes every position to the model's lot-aware target: the nearest clean lot that still sits inside the band, or the raw share count where no lot does.",
  },
  {
    destination: 'lot-high',
    label: 'To highest lot',
    hint: 'Takes every position to the round lot just inside its own band ceiling.',
  },
];

const NAMES: Record<Destination, string> = {
  'lot-low': 'the lot nearest each floor',
  target: 'the lot-aware target',
  'lot-high': 'the lot nearest each ceiling',
};

/**
 * Sits on the table's own header line, beside Expand all — not in the page header with Undo and
 * the Edit buttons. These press trades into the account, and a control that moves money should
 * not share a group with one that opens a dialog.
 */
export function TradeAllButtons({
  onTradeAll,
  disabled,
}: {
  onTradeAll: (destination: Destination) => void;
  /** True while some position has no price, when no destination on the page can be trusted. */
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span className="text-[12.5px] font-semibold text-ink-soft">Every position:</span>
      {CHOICES.map((c) => (
        <button
          key={c.destination}
          className="btn-outline"
          disabled={disabled}
          title={
            disabled
              ? 'A position has no price, so its share counts cannot be worked out. Give it one first.'
              : c.hint + CASH_HINT
          }
          onClick={() => onTradeAll(c.destination)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What the press did, in one line, with the way back beside it.
 *
 * Two things it has to be honest about. The counts are positions the button did *not* move — a
 * row left alone because it has no lot rule reads as a bug unless the line says otherwise. And
 * the cash, which these buttons will knowingly run negative.
 *
 * A shortfall is shown the way every ledger shows one — a minus sign and red — rather than as a
 * sentence telling the advisor to go and sell something. He can read a negative balance, and the
 * instruction was both obvious and slightly patronising.
 */
export function TradeAllResult({
  outcome,
  cashFloor,
  undoable,
  onUndo,
}: {
  outcome: BulkOutcome;
  cashFloor: number;
  /** False once anything else has happened, when this is no longer the press an undo would take. */
  undoable: boolean;
  onUndo: () => void;
}) {
  const notes = [
    outcome.settled > 0 && `${outcome.settled} already there`,
    outcome.noDestination > 0 && `${outcome.noDestination} with no lot to trade to`,
  ].filter(Boolean) as string[];

  const short = outcome.cashAfter < 0;

  return (
    <div
      className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md
                 border border-line bg-panel-alt px-3.5 py-2.5"
      role="status"
    >
      <div className="min-w-0 text-[13.5px]">
        <span className="font-semibold">
          {outcome.traded === 0
            ? 'Nothing to trade'
            : `${outcome.traded} position${outcome.traded === 1 ? '' : 's'} traded`}
        </span>{' '}
        <span className="text-ink-soft">
          to {NAMES[outcome.destination]}
          {notes.length > 0 && ` · ${notes.join(' · ')}`}
        </span>
        {short ? (
          <span className="ml-2 font-semibold text-danger">
            Cash <span className="font-mono tabular-nums">{money(outcome.cashAfter)}</span>
          </span>
        ) : (
          outcome.belowCashFloor && (
            <span className="ml-2 font-semibold text-warn">
              Cash is now below its {cashFloor}% floor.
            </span>
          )
        )}
      </div>

      {undoable && (
        <button className="btn-ghost shrink-0" onClick={onUndo}>
          Undo all {outcome.traded}
        </button>
      )}
    </div>
  );
}
