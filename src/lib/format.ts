/**
 * Locale is pinned to en-US rather than left to the runtime. The page renders on the server and
 * again in the browser, and a locale that differs between the two would produce a hydration
 * mismatch on every dollar figure.
 */

export function money(n: number): string {
  const sign = n < 0 ? '-$' : '$';
  return (
    sign +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Weights are shown to three decimals: at these account sizes the third digit is a real share. */
export function pct(n: number): string {
  return `${n.toFixed(3)}%`;
}

export function shares(n: number): string {
  return n.toLocaleString('en-US');
}

export interface PriceAge {
  /** Always an absolute date and time: a relative label is wrong the moment the tab sits open. */
  label: string;
  /** Whether these prices came from a day other than today, which is when to say so loudly. */
  stale: boolean;
  /** Whole days between the load and now, for the warning. Zero when loaded today. */
  days: number;
}

/**
 * How old the prices are.
 *
 * The line is drawn at the calendar day rather than a number of hours, because that is the line
 * an advisor already thinks in: prices from today are the ones they exported this morning, and
 * anything else is from a previous session. Within-day drift is real but invisible to this tool
 * either way, and pretending to measure it would overstate what the app knows.
 *
 * Returns null when there is nothing to date — the worked example, or a portfolio typed in by
 * hand, neither of which has an export behind it.
 */
export function priceAge(loadedAt: string | undefined, now = new Date()): PriceAge | null {
  if (!loadedAt) return null;
  const then = new Date(loadedAt);
  if (Number.isNaN(then.getTime())) return null;

  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000);

  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const date = then.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

  return {
    label: days === 0 ? `loaded ${time} today` : `loaded ${date}, ${time}`,
    stale: days > 0,
    days,
  };
}
