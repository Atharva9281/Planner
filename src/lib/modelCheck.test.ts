import { describe, expect, it } from 'vitest';
import { samplePortfolio } from './defaultState';
import { modelErrors } from './modelCheck';
import { Portfolio } from './types';

/** Two stocks and cash that total exactly 100%, each band in order. */
function sound(): Portfolio {
  const base = samplePortfolio();
  return {
    ...base,
    stocks: [
      { ...base.stocks[0], target: 60, bandMin: 55, bandMax: 65 },
      { ...base.stocks[1], target: 32, bandMin: 30, bandMax: 34 },
    ],
    cashFloor: 6,
    cashTarget: 8,
    cashCeiling: 10,
  };
}

describe('modelErrors', () => {
  it('passes a model that totals 100% with every band in order', () => {
    expect(modelErrors(sound())).toEqual([]);
  });

  it('refuses a total above or below 100%, cash included', () => {
    const over = { ...sound(), cashTarget: 9 };
    expect(modelErrors(over)[0]).toMatch(/101% including cash.*take 1% off/);
    const under = { ...sound(), cashTarget: 7 };
    expect(modelErrors(under)[0]).toMatch(/99% including cash.*add 1%/);
  });

  it('ignores float noise in the total', () => {
    const p = sound();
    p.stocks[0] = { ...p.stocks[0], target: 33.33, bandMin: 30, bandMax: 40 };
    p.stocks[1] = { ...p.stocks[1], target: 58.67, bandMin: 50, bandMax: 60 };
    expect(modelErrors(p)).toEqual([]);
  });

  it('refuses a target below its floor or above its ceiling', () => {
    const p = sound();
    p.stocks[0] = { ...p.stocks[0], bandMin: 61 };
    p.stocks[1] = { ...p.stocks[1], bandMax: 31 };
    expect(modelErrors(p)).toHaveLength(2);
  });

  it('refuses a cash band out of order', () => {
    const p = { ...sound(), cashFloor: 9, cashCeiling: 10 };
    expect(modelErrors(p)).toEqual([expect.stringMatching(/^Cash: floor 9%/)]);
  });
});
