import { ExplorerState, Portfolio, Stock } from "./types";

/**
 * The app opens empty. Nothing on the first screen belongs to a real account until the advisor
 * puts it there, either by loading the sample below or by entering a portfolio by hand.
 */
export function emptyPortfolio(): Portfolio {
  return {
    stocks: [],
    cash: 0,
    cashFloor: 3,
    cashTarget: 5,
    cashCeiling: 8,
    offModel: [],
  };
}

/**
 * A worked example, offered explicitly rather than seeded. Ids are fixed strings so the first
 * render is identical on the server and in the browser.
 */
const SAMPLE_STOCKS: Stock[] = [
  {
    id: "s1",
    sym: "MSFT",
    type: "Stocks / ETFs Sleeve",
    price: 412.3,
    target: 40,
    bandMin: 35,
    bandMax: 45,
    shares: 600,
  },
  {
    id: "s2",
    sym: "MU",
    type: "Stocks / ETFs Sleeve",
    price: 118.4,
    target: 20,
    bandMin: 16,
    bandMax: 24,
    shares: 940,
  },
  {
    id: "s3",
    sym: "NVDA",
    type: "Stocks / ETFs Sleeve",
    price: 221.75,
    target: 12,
    bandMin: 9,
    bandMax: 15,
    shares: 280,
  },
  {
    id: "s4",
    sym: "AAPL",
    type: "Stocks / ETFs Sleeve",
    price: 298.6,
    target: 10,
    bandMin: 7,
    bandMax: 13,
    shares: 175,
  },
  {
    id: "s5",
    sym: "AMZN",
    type: "Stocks / ETFs Sleeve",
    price: 265.9,
    target: 10,
    bandMin: 7,
    bandMax: 13,
    shares: 195,
  },
];

export function samplePortfolio(): Portfolio {
  return {
    stocks: SAMPLE_STOCKS.map((s) => ({ ...s })),
    cash: 38000,
    cashFloor: 3,
    cashTarget: 5,
    cashCeiling: 8,
    offModel: [],
  };
}

/** Snapshot of the shares and cash a reset should return to. */
export function baselineFrom(p: Portfolio) {
  return {
    shares: Object.fromEntries(p.stocks.map((s) => [s.id, s.shares])),
    cash: p.cash,
  };
}

function stateFrom(
  portfolio: Portfolio,
  nextId: number,
  source?: ExplorerState["source"],
): ExplorerState {
  return {
    portfolio,
    baseline: baselineFrom(portfolio),
    source,
    log: [],
    nextId,
  };
}

export function emptyState(): ExplorerState {
  return stateFrom(emptyPortfolio(), 1);
}

/** Starts past the seeded ids, so the first stock added cannot land on top of one of them. */
export function sampleState(): ExplorerState {
  return stateFrom(samplePortfolio(), SAMPLE_STOCKS.length + 1, {
    kind: "sample",
    label: "Worked example",
  });
}
