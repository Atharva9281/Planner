import Link from 'next/link';
import { TILE, TILE_GRID, TILE_LABEL } from './CashStatus';
import { FOLD, POSITION_COLUMNS, POSITIONS_TITLE, PositionsHead } from './PositionsHead';
import UploadSlots from './import/UploadSlots';
import { CarriedModel, ParsedImport } from '@/lib/import/types';

/**
 * The working page before it has any data: the real tiles and the real table, drawn empty, with
 * the upload panel sitting inside them.
 *
 * The point is that nothing moves when the files land. The advisor sees the shape of the page
 * first, then it fills in — rather than one screen being swapped for a completely different one.
 *
 * The ghost table is absolutely positioned so the upload card sets the height; the other way
 * round and a card taller than five empty rows gets clipped.
 */

const GHOST_ROWS = 7;

/*
 * The columns, the header row, the heading above it and the tile shape below all come from the
 * modules that draw the real thing. Nothing here is a second copy: this ghost had drifted twice
 * from hand-kept lists, and the last time it was missing the brighter header ink on four columns
 * and one rounded corner — so the header bar changed at the one moment anybody is watching it.
 *
 * The tile labels are the one thing written out here, because the real ones carry percentages
 * that do not exist until a model is loaded.
 */
const TILES = ['Total account', 'Cash', 'Target', 'Ceiling', 'Floor'];

/** A dimmed bar standing in for a value that has not arrived yet. */
function Bar({ w }: { w: string }) {
  return <div className="h-2.5 rounded-full bg-line" style={{ width: w }} />;
}

export default function SkeletonWorkspace({
  carried,
  onReady,
  onAddStock,
}: {
  /** A model kept from the account just closed, which arrives already in the model slot. */
  carried?: CarriedModel;
  onReady: (parsed: ParsedImport, carried?: CarriedModel) => void;
  onAddStock: () => void;
}) {
  return (
    <>
      {/* ---- the tiles, empty. CashStatus's own grid, cash spanning two tracks ---- */}
      <div className={`mb-5 ${TILE_GRID}`} aria-hidden>
        {TILES.map((label) => (
          <div key={label} className={`${TILE} ${label === 'Cash' ? 'col-span-2' : ''}`}>
            <div className="font-mono text-[22px] font-semibold leading-none text-line">—</div>
            <div className={`${TILE_LABEL} text-ink-faint`}>{label}</div>
          </div>
        ))}
      </div>

      {/* ---- the table, drawn but empty, with the upload panel inside it ---- */}
      <section className="panel overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <h2 className="panel-title">{POSITIONS_TITLE}</h2>
        </div>

        <div className="relative">
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <table className="w-full border-collapse">
              <PositionsHead />
              <tbody className="opacity-40">
                {Array.from({ length: GHOST_ROWS }).map((_, r) => (
                  <tr key={r} className={r % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                    {POSITION_COLUMNS.map((c) => (
                      <td key={c.label} className={`td ${c.raw ? FOLD : ''}`}>
                        <div className="flex flex-col gap-2">
                          <Bar w="58%" />
                          <Bar w="38%" />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The panel that actually does something, over the top of the empty shape. */}
          <div className="relative flex justify-center px-4 pt-16 pb-10 sm:px-8">
            <div className="w-full max-w-3xl rounded-2xl border border-line bg-panel p-6 shadow-[0_16px_50px_rgba(20,23,30,0.16)] sm:p-7">
              <div className="text-center">
                <h3 className="text-xl font-bold tracking-[-0.01em]">
                  {carried ? 'Open the next account' : 'Load a portfolio'}
                </h3>
                {/* Says nothing about the model being kept: the slot below shows that, and can be
                    emptied from there, which would leave a claim up here that had stopped being
                    true. What stays true either way is that this account's holdings are needed. */}
                <p className="mx-auto mt-1.5 max-w-lg text-[14px] leading-relaxed text-ink-soft">
                  {carried
                    ? 'Add this account’s holdings export and the table fills in.'
                    : 'Two exports from your custodian. Upload each one below and the table fills in.'}
                </p>
              </div>

              <div className="mt-6">
                <UploadSlots carried={carried} onReady={onReady} />
              </div>

              <p className="mt-6 border-t border-line-soft pt-5 text-center text-[13.5px] text-ink-soft">
                No files to hand? You can{' '}
                <button
                  className="font-semibold text-accent underline underline-offset-2 hover:text-accent-deep"
                  onClick={onAddStock}
                >
                  enter a portfolio by hand
                </button>{' '}
                or{' '}
                <Link
                  className="font-semibold text-accent underline underline-offset-2 hover:text-accent-deep"
                  href="/example"
                >
                  open the worked example
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
