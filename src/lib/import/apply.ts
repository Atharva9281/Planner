import { baselineFrom } from '../defaultState';
import { ExplorerState, OffModelHolding, Portfolio, Stock } from '../types';
import { classify, offModelSymbols, unpricedSymbols } from './parse';
import { ParsedImport, ParsedModel, Resolution } from './types';

/**
 * Builds a portfolio from an import and the decisions the advisor made in the preview.
 *
 * Nothing is invented here. Prices are market data: they come from the holdings file when the
 * account holds the position, and otherwise from the advisor, who typed them in the preview.
 * A row with neither still arrives at zero and the table shows it as needing a price, rather
 * than the row being quietly dropped or given a made-up figure.
 *
 * The same applies to cash. The Cash and Equiv row supplies it whenever the file has one; an
 * account being opened has no such file, so the balance the advisor entered is used instead.
 * Options never made it past the parser and the asset class decides what may be traded.
 */
export function applyImport(parsed: ParsedImport, resolution: Resolution): ExplorerState {
  const model = pickModel(parsed, resolution.modelName);
  const holdings = parsed.holdings;

  const sharesOf = new Map((holdings?.positions ?? []).map((p) => [p.sym, p.shares]));
  const priceOf = new Map((holdings?.positions ?? []).map((p) => [p.sym, p.price]));

  let seq = 1;
  const stocks: Stock[] = (model?.rows ?? []).map((row) => ({
    id: `s${seq++}`,
    sym: row.sym,
    type: row.type,
    /* The holdings file prices what the account owns. For everything else — every row of a model
       loaded against an account that holds nothing yet — the price is the one the advisor typed
       in the preview. The file always wins where it has an answer. */
    price: priceOf.get(row.sym) ?? resolution.prices?.[row.sym] ?? 0,
    target: row.target,
    bandMin: row.bandMin,
    bandMax: row.bandMax,
    shares: sharesOf.get(row.sym) ?? 0,
    // The model's own Type decides both of these, so nothing is asked at import time: fixed
    // income is held rather than traded, and a lot means nothing to something bought in dollars.
    tradeable: classify(row.type ?? '') === 'tradeable',
    lotRounding: classify(row.type ?? '') === 'tradeable',
  }));

  // Anything held that the model has no row for, kept as an off-model holding so it still counts
  // toward total account value and can be sold to raise cash.
  const offModel: OffModelHolding[] =
    resolution.keepOffModel && model
      ? offModelSymbols(model, holdings).map((p) => ({
          id: `o${seq++}`,
          sym: p.sym,
          shares: p.shares,
          price: p.price,
          tradeable: p.tradeable,
        }))
      : [];

  /* A Cash and Equiv row is the balance whenever there is one. Without it the account has no
     balance on file — a new account, or the one export that omits the row — and the figure the
     advisor entered in the preview stands in its place. */
  const cash = holdings?.cashFound ? holdings.cash : (resolution.cash ?? 0);

  const portfolio: Portfolio = {
    stocks,
    cash,
    cashFloor: model?.cashBand?.floor ?? 3,
    cashTarget: model?.cashBand?.target ?? 5,
    cashCeiling: model?.cashBand?.ceiling ?? 8,
    offModel,
  };

  return {
    portfolio,
    baseline: baselineFrom(portfolio),
    source: {
      kind: 'import',
      label: holdings?.accountName || model?.name || 'Imported portfolio',
    },
    log: [],
    nextId: seq,
  };
}

export function pickModel(parsed: ParsedImport, name?: string): ParsedModel | undefined {
  return parsed.models.find((m) => m.name === name) ?? parsed.models[0];
}

/**
 * Everything the preview needs to warn about before the advisor commits.
 *
 * `unpriced` counts down as prices are typed, so it is both the list of fields to show and the
 * number still outstanding. `needsCash` is true for an account whose files carry no balance at
 * all, which is every account being opened rather than reviewed.
 */
export function importIssues(parsed: ParsedImport, resolution: Resolution) {
  const model = pickModel(parsed, resolution.modelName);
  const needsCash = !parsed.holdings?.cashFound;
  if (!model) return { unpriced: [], noBand: [], invalidBand: [], needsCash };

  return {
    unpriced: unpricedSymbols(model, parsed.holdings).filter(
      (sym) => !((resolution.prices?.[sym] ?? 0) > 0),
    ),
    noBand: model.rows.filter((r) => r.bandMin === r.bandMax).map((r) => r.sym),
    invalidBand: model.rows.filter((r) => r.bandMin > r.bandMax).map((r) => r.sym),
    needsCash,
  };
}
