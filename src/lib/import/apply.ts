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
 * Options never made it past the parser.
 *
 * The asset class decides what may be traded *inside* the model, where a target and a band say
 * what to hold and fixed income is held rather than traded. It decides nothing outside it: a
 * holding the model has no row for can always be sold, whatever it is made of.
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
    /* The model's own Type decides both of these, so nothing is asked at import time.
       They are deliberately not the same question. Fixed income *is* traded — the model gives it
       a target and a band like anything else — but it is bought in dollars at whatever NAV, so
       the 100-share grid has no meaning for it. Only an unrecognised asset class is left untraded.
       A model carried over from the previous account brings both flags already settled, and those
       win — see the note on `ModelRow.tradeable`. */
    tradeable: row.tradeable ?? classify(row.type ?? '') !== 'holdOnly',
    lotRounding: row.lotRounding ?? classify(row.type ?? '') === 'tradeable',
    /* Only a carried model has one; a file-read model leaves the whole order unset, which is the
       run declining to touch anything until he has said what he thinks. */
    ...(row.rank ? { rank: row.rank } : {}),
  }));

  /* Anything held that the model has no row for. Always kept, and never a question at import.
     The account owns it either way, and dropping it would take real money out of total account
     value with no sale behind it — which shrinks every band in the table, since a band is a
     percentage of that total. On one real pair of files it was 18% of the account.
     What to *do* about it is a separate decision, made later on screen: the model is the mandate,
     so the normal answer is to sell, and the off-model panel offers that in one press. */
  const offModel: OffModelHolding[] = model
    ? offModelSymbols(model, holdings).map((p) => ({
        id: `o${seq++}`,
        sym: p.sym,
        shares: p.shares,
        price: p.price,
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
      /* Stamped here rather than at render, because this is the moment the prices entered the
         app. Everything downstream is derived from them, so this is their age too. */
      loadedAt: new Date().toISOString(),
      /* Kept separately because `label` is usually the account. Without it, closing this account
         would leave nothing able to name the model it was measured against. */
      modelName: model?.name,
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
