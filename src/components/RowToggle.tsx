import { RowCollapse } from '@/lib/useRowCollapse';

/**
 * Expand all and Collapse all for one table, sized to sit on its panel's header line beside the
 * title rather than in a row of its own.
 */
export function CollapseAll({ collapse }: { collapse: RowCollapse }) {
  return (
    <div className="flex shrink-0 gap-2">
      <button className="btn-ghost" onClick={() => collapse.setAll(true)}>
        Expand all
      </button>
      <button className="btn-ghost" onClick={() => collapse.setAll(false)}>
        Collapse all
      </button>
    </div>
  );
}

/**
 * The open/shut chevron for a table row.
 *
 * It lives in the last column of every table that uses it, so it sits on the same edge whatever
 * state the row is in and never moves under the pointer as rows open and close.
 *
 * Declared at module scope on purpose: a component defined inside a render is a new type on every
 * pass, which throws the button away and rebuilds it each time.
 */
export default function RowToggle({
  label,
  open,
  onToggle,
}: {
  /** What is being opened, for the screen-reader label. */
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border
                 border-line text-[12px] text-ink-soft transition-colors
                 hover:border-ink-faint hover:bg-paper hover:text-ink"
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      onClick={onToggle}
    >
      {open ? '▾' : '▸'}
    </button>
  );
}
