import { describe, expect, it } from 'vitest';
import { priceAge } from './format';

/**
 * The age of the loaded prices, which is the only thing on screen telling an advisor whether they
 * are working from today's export or one restored from a previous session. The workspace survives
 * the window now, so this is the difference between correct figures and quietly wrong ones.
 */
describe('how old the prices are', () => {
  const at = (iso: string) => new Date(iso);

  it('says nothing when there is no export behind the portfolio', () => {
    // The worked example and a hand-typed portfolio have no load date, and inventing one would
    // date invented prices.
    expect(priceAge(undefined)).toBeNull();
    expect(priceAge('not a date')).toBeNull();
  });

  it('is not stale when the files were loaded earlier the same day', () => {
    const age = priceAge(at('2026-09-03T09:14:00').toISOString(), at('2026-09-03T16:40:00'))!;

    expect(age.stale).toBe(false);
    expect(age.days).toBe(0);
    expect(age.label).toContain('today');
  });

  /**
   * The line is the calendar day, not 24 hours. Prices loaded at 11pm and read at 8am the next
   * morning are nine hours old but from yesterday's session, and yesterday is what matters: the
   * market has opened since.
   */
  it('is stale the next morning, though under 24 hours have passed', () => {
    const age = priceAge(at('2026-09-02T23:00:00').toISOString(), at('2026-09-03T08:00:00'))!;

    expect(age.stale).toBe(true);
    expect(age.days).toBe(1);
  });

  it('counts whole days across a gap, and dates the label rather than saying "today"', () => {
    const age = priceAge(at('2026-08-30T09:14:00').toISOString(), at('2026-09-03T09:00:00'))!;

    expect(age.days).toBe(4);
    expect(age.stale).toBe(true);
    expect(age.label).not.toContain('today');
    expect(age.label).toContain('Aug');
  });

  /**
   * Whole days are counted between midnights, so a load at 11:59pm and a read at 12:01am is one
   * day rather than rounding to zero on the two minutes between them.
   */
  it('measures from midnight to midnight, not by elapsed hours', () => {
    const age = priceAge(at('2026-09-02T23:59:00').toISOString(), at('2026-09-03T00:01:00'))!;

    expect(age.days).toBe(1);
    expect(age.stale).toBe(true);
  });
});
