import { Portfolio } from './types';

/**
 * What is wrong with the model as it stands, one sentence per fault. Empty when it is sound.
 *
 * The Model dialog will not close while this has anything in it. Two rules, both from the CFP:
 * the stock targets and the cash target together make up the whole account, exactly 100%; and
 * every band reads floor ≤ target ≤ ceiling, cash included. A model that breaks either one cannot
 * describe an account, so every figure computed from it would be wrong.
 */
export function modelErrors(p: Portfolio): string[] {
  const errors: string[] = [];

  const total = p.stocks.reduce((sum, s) => sum + s.target, 0) + p.cashTarget;
  // Cent-of-a-percent slack, so 33.33 + 33.33 + 33.34 is not refused over float noise.
  if (Math.abs(total - 100) > 0.005) {
    errors.push(
      `Targets add up to ${round(total)}% including cash. They must total exactly 100%, so ${
        total > 100 ? `take ${round(total - 100)}% off` : `add ${round(100 - total)}%`
      }.`,
    );
  }

  const bad = p.stocks.filter((s) => !(s.bandMin <= s.target && s.target <= s.bandMax));
  for (const s of bad) {
    errors.push(
      `${s.sym}: band floor ${s.bandMin}%, target ${s.target}%, band ceiling ${s.bandMax}%. The floor must be at or below the target, and the ceiling at or above it.`,
    );
  }

  if (!(p.cashFloor <= p.cashTarget && p.cashTarget <= p.cashCeiling)) {
    errors.push(
      `Cash: floor ${p.cashFloor}%, target ${p.cashTarget}%, ceiling ${p.cashCeiling}%. The floor must be at or below the target, and the ceiling at or above it.`,
    );
  }

  return errors;
}

const round = (n: number) => Number(n.toFixed(2));
