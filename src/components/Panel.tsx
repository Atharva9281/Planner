'use client';

import { ReactNode, useState } from 'react';

interface Props {
  title: string;
  /** Explanatory copy under the title. Hidden while collapsed, where it would only add height. */
  description?: ReactNode;
  /** Stands in for the whole body on the header line once it is shut. */
  summary: string;
  /** Controls that belong to the section, not to the toggle. Only shown while open. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A section that folds down to its own title.
 *
 * The body is unmounted rather than hidden, so a shut panel costs no layout and its column
 * headers stop competing for the sticky slot under the bar.
 */
export default function Panel({ title, description, summary, actions, children }: Props) {
  const [open, setOpen] = useState(true);

  return (
    /* No overflow clipping here on purpose. A wide table has to be allowed to push the page into
       a horizontal scroll: clipping would drop the last columns silently, and an inner scroll box
       would make itself the scroll container and break the sticky column headers. The rounded
       corners are carried by the header cells themselves instead. */
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <button
            className="group flex items-center gap-2.5 text-left"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border
                         border-line text-[11px] text-ink-soft transition-colors
                         group-hover:border-ink-faint group-hover:text-ink"
              aria-hidden
            >
              {open ? '▾' : '▸'}
            </span>
            <h2 className="panel-title">{title}</h2>
            {!open && <span className="text-[13.5px] text-ink-soft">{summary}</span>}
          </button>

          {open && description}
        </div>

        {open && actions}
      </div>

      {open && children}
    </section>
  );
}
