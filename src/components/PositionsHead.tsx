/**
 * The positions table's ten columns, in one place, and the header row both tables draw from them.
 *
 * Two tables render this header: the real one, and the empty shape drawn behind the upload card so
 * that nothing moves when the files land. They used to keep two hand-written copies of the same
 * list, which is exactly the pair that drifts — and had. The skeleton was missing `th-lead` on all
 * four of the columns a row is read by, and the rounded top-left corner, so the header bar visibly
 * changed at the one moment anybody is watching it.
 *
 * The title belongs here for the same reason: it is written above both of them.
 */

/**
 * The three columns that fold when the window cannot hold ten.
 *
 * Every column here is a share count the position could hold, so they pair off: a band edge and
 * the nearest lot inside it, twice over. When space runs out it is the raw edges that go, because
 * the lot beside each one is the answer this tool exists to give — and they come back as a strip
 * under the row rather than being lost. What the cash affords folds with them, being the one
 * figure that describes the account rather than the position.
 */
export const FOLD = 'hidden wide:table-cell';

export const POSITIONS_TITLE = 'Every position, as share counts it could hold';

export interface PositionColumn {
  label: string;
  /** Drawn in full white rather than the dimmer header ink: the columns a row is read by. */
  lead?: true;
  /** Folds below `wide`, and reappears as a strip under each open row. */
  raw?: true;
  /**
   * Takes only the width its own content needs, leaving the slack to the columns that can use it.
   *
   * A table laid out automatically hands spare width to every column in proportion, including the
   * ones with nothing to spend it on. Current holdings is three short figures and a badge, none of
   * which grow — so on a wide window it was drawing about 225px to hold 110px of text, and the
   * trade columns beside it, whose figures and buttons do wrap, were the ones going short.
   *
   * `w-[1%]` is the standard way to say this in a table: a width small enough that the browser
   * settles the column at its own content and gives the remainder to the columns left auto.
   */
  tight?: true;
  /**
   * Held to a floor wide enough for its move line on one line.
   *
   * The two band-edge columns carry the same "SELL 1,645 sh" over "$15,925.00" that every other
   * destination column does, but their headers are the shortest on the row — and a table hands out
   * spare width in proportion to a column's longest content, headers included. So they were
   * settling around 120px and breaking "SELL 325 sh" across two lines while the columns beside
   * them, with far longer headings, sat 70px wider on identical figures.
   */
  roomy?: true;
}

export const POSITION_COLUMNS: PositionColumn[] = [
  { label: 'Ticker', lead: true },
  { label: 'Current holdings', lead: true, tight: true },
  { label: 'Target holdings' },
  /* "Lot closest to target" — the "closest" is dropped. The column sits beside the band edge it
     belongs to, so which lot is meant is never in question, and the word was long enough to earn
     the column width it did not need. */
  { label: 'Lot to target', lead: true },
  { label: 'Lower band', raw: true, roomy: true },
  { label: 'Lot to lower band' },
  { label: 'Upper band', raw: true, roomy: true },
  { label: 'Lot to upper band' },
  /* "Shares with current cash" wrapped to four lines, and since every header shares one row that
     single label set the height of the whole bar. The sub-line under the figure spells the
     arithmetic out anyway. */
  { label: 'Cash buys', raw: true },
  { label: 'Buy or sell', lead: true },
];

/** The classes one header cell carries, including the corners the panel's own rounding needs. */
function headClass(column: PositionColumn, index: number): string {
  return [
    'th',
    column.lead && 'th-lead',
    column.raw && FOLD,
    column.tight && 'w-[1%]',
    column.roomy && 'min-w-[8.5rem]',
    index === 0 && 'rounded-tl-lg',
    index === POSITION_COLUMNS.length - 1 && 'rounded-tr-lg',
  ]
    .filter(Boolean)
    .join(' ');
}

export function PositionsHead() {
  return (
    <thead>
      <tr>
        {POSITION_COLUMNS.map((column, i) => (
          <th key={column.label} className={headClass(column, i)}>
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
