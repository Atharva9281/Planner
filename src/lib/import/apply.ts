import { baselineFrom } from '../defaultState';
import { ExplorerState, OffModelHolding, Portfolio, Stock } from '../types';
import { classify, offModelSymbols, unpricedSymbols } from './parse';
import { ParsedImport, ParsedModel, Resolution } from './types';

/**
 * Builds a portfolio from an import and the decisions the advisor made in the preview.
 *
 * Nothing is invented here. Prices are market data and come from the holdings file alone — the
 * model export carries targets and bands, never a price. A model position the account does not
 * hold therefore arrives at zero shares and no price, which the table shows as needing one
 * rather than quietly dropping the row.
 *
 * Cash is the Cash and Equiv row's quantity, options never made it past the parser, and the
 * asset class decides what may be traded. So the only decision left here is whether to keep the
 * holdings the model has no row for.
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
    // The holdings file prices what the account owns; nothing else has a price to give.
    price: priceOf.get(row.sym) ?? 0,
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

  const cash = holdings?.cash ?? 0;

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

/** Everything the preview needs to warn about before the advisor commits. */
export function importIssues(parsed: ParsedImport, resolution: Resolution) {
  const model = pickModel(parsed, resolution.modelName);
  if (!model) return { unpriced: [], noBand: [], invalidBand: [] };

  return {
    unpriced: unpricedSymbols(model, parsed.holdings),
    noBand: model.rows.filter((r) => r.bandMin === r.bandMax).map((r) => r.sym),
    invalidBand: model.rows.filter((r) => r.bandMin > r.bandMax).map((r) => r.sym),
  };
}
