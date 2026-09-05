import Link from 'next/link';
import UploadSlots from './import/UploadSlots';
import { ParsedImport } from '@/lib/import/types';

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
 * The real table's ten columns, in its order, with the three that fold below `wide` marked so the
 * ghost folds with them. This list, the title above it and the tiles below all have to track
 * LotAwareTable, Explorer and CashStatus exactly: the whole point of the skeleton is that nothing
 * moves when the files land, and a ghost carrying the wrong columns or an older heading breaks it
 * at the one moment anybody is watching. It has drifted twice already.
 */
const COLUMNS: { label: string; raw?: true }[] = [
  { label: 'Ticker' },
  { label: 'Current holdings' },
  { label: 'Target holdings' },
  { label: 'Lot closest to target' },
  { label: 'Lower band', raw: true },
  { label: 'Lot closest to lower band' },
  { label: 'Upper band', raw: true },
  { label: 'Lot closest to upper band' },
  { label: 'Cash buys', raw: true },
  { label: 'Buy or sell' },
];

const TILES = ['Total account', 'Cash', 'Target', 'Ceiling', 'Floor'];

/** A dimmed bar standing in for a value that has not arrived yet. */
function Bar({ w }: { w: string }) {
  return <div className="h-2.5 rounded-full bg-line" style={{ width: w }} />;
}

export default function SkeletonWorkspace({
  onReady,
  onAddStock,
}: {
  onReady: (parsed: ParsedImport) => void;
  onAddStock: () => void;
}) {
  return (
    <>
      {/* ---- the tiles, empty. Same grid as CashStatus, cash spanning two tracks ---- */}
      <div className="mb-4 grid grid-cols-3 gap-3 wide:grid-cols-6" aria-hidden>
        {TILES.map((label) => (
          <div
            key={label}
            className={`rounded-xl border border-line bg-panel px-5 py-4 ${
              label === 'Cash' ? 'col-span-2' : ''
            }`}
          >
            <div className="font-mono text-[22px] font-semibold leading-none text-line">—</div>
            <div className="mt-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-faint">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ---- the table, drawn but empty, with the upload panel inside it ---- */}
      <section className="panel overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <h2 className="panel-title">Every position, as share counts it could hold</h2>
        </div>

        <div className="relative">
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c.label}
                      className={`th ${i === 0 ? 'th-lead' : ''} ${
                        i === COLUMNS.length - 1 ? 'rounded-tr-lg' : ''
                      } ${c.raw ? 'hidden wide:table-cell' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="opacity-40">
                {Array.from({ length: GHOST_ROWS }).map((_, r) => (
                  <tr key={r} className={r % 2 ? 'bg-panel-alt' : 'bg-panel'}>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.label}
                        className={`td ${c.raw ? 'hidden wide:table-cell' : ''}`}
                      >
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
                <h3 className="text-xl font-bold tracking-[-0.01em]">Load a portfolio</h3>
                <p className="mx-auto mt-1.5 max-w-lg text-[14px] leading-relaxed text-ink-soft">
                  Two exports from your custodian. Upload each one below and the table fills in.
                </p>
              </div>

              <div className="mt-6">
                <UploadSlots onReady={onReady} />
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
