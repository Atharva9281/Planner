'use client';

import { useState } from 'react';

/**
 * Open/shut state for a table's rows, held outside the table so the Expand all and Collapse all
 * buttons can sit on the panel's own header line rather than taking a row of their own.
 *
 * Only the rows the advisor has overruled are stored. A row with no entry follows its own default,
 * which each table decides from its data — so a row that becomes settled folds away by itself,
 * while one opened by hand stays open.
 */
export interface RowCollapse {
  isOpen: (id: string, settled: boolean) => boolean;
  toggle: (id: string, settled: boolean) => void;
  setAll: (open: boolean) => void;
  /**
   * Keeps a row open whatever its default would now be.
   *
   * Trading is the case this exists for. A row opens by default because it needs a decision, and
   * the trade that answers it makes it settled — so the row folded itself away underneath the
   * click that had just been made on it, taking the result out of sight before it could be read.
   * Acting on a row is not a request to close it; only the chevron is.
   */
  pin: (id: string) => void;
}

export function useRowCollapse(ids: string[]): RowCollapse {
  const [override, setOverride] = useState<Record<string, boolean>>({});

  return {
    isOpen: (id, settled) => override[id] ?? !settled,
    toggle: (id, settled) => setOverride((cur) => ({ ...cur, [id]: !(cur[id] ?? !settled) })),
    setAll: (open) => setOverride(Object.fromEntries(ids.map((id) => [id, open]))),
    pin: (id) => setOverride((cur) => (cur[id] === true ? cur : { ...cur, [id]: true })),
  };
}

