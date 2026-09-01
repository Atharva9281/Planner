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
