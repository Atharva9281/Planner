import { ExplorerState } from '../types';
import { CarriedModel, HoldingRow, ParsedHoldings, ParsedImport, PendingImport } from './types';

/**
 * Lifts the model off a loaded account so the next account can be opened against it.
 *
 * One model routinely covers several accounts. Making the advisor re-upload the same model export
 * for each of them is work with no decision in it, and every repeat is a chance to pick the wrong
 * file.
 *
 * The model is read back out of the live portfolio rather than kept aside from the import, so
 * what carries is the mandate as it stands on screen — every band and target he changed in "Edit
 * model & cash band" included. That is deliberate: those edits are edits to the model, which is
 * exactly the thing being reused. The alternative, replaying the file as it was read, would hand
 * the next account a mandate he had already decided against.
 *
 * Undefined where there is nothing to carry: an empty workspace, or one holding only off-model
 * positions, which are holdings rather than a model.
 */
export function carryModel(state: ExplorerState): CarriedModel | undefined {
  const { portfolio, source } = state;
  if (portfolio.stocks.length === 0) return undefined;

  const prices: Record<string, number> = {};
  for (const s of portfolio.stocks) if (s.price > 0) prices[s.sym] = s.price;

  return {
    model: {
      /* The real model name or nothing at all. Never the account name: `source.label` is the
         account wherever the holdings file named one, and calling a model after one of the
         accounts it serves is how it ends up looking like that account's own.
         Empty rather than an invented placeholder, because `applyImport` falls back to the model
         name for the account label — and a placeholder there put "Model carried over" in the
         header where the account's name belongs. */
      name: source?.modelName ?? '',
      rows: portfolio.stocks.map((s) => ({
        sym: s.sym,
        type: s.type,
        target: s.target,
        bandMin: s.bandMin,
        bandMax: s.bandMax,
        /* Carried explicitly rather than re-derived from `type`. Both flags were settled when
           this model was first read, and the advisor can edit a sleeve name afterwards; deriving
           them again would let a rename quietly turn a hold-only row into a tradeable one. */
        tradeable: s.tradeable !== false,
        lotRounding: s.lotRounding !== false,
        /* The conviction order goes with the mandate. It is the same securities and the same view
           of them, and re-entering it per account is the kind of repeated work that eventually
           gets entered differently. */
        rank: s.rank,
      })),
      cashBand: {
        target: portfolio.cashTarget,
        floor: portfolio.cashFloor,
        ceiling: portfolio.cashCeiling,
      },
    },
    prices,
    /* Names the account, and only the account. `source.label` falls back to the model name when
       the holdings file carried no account name, which turned the slot into "Carried over from
       <model>" — circular, and no help in telling one account from another. */
    from:
      source?.label && source.label !== source.modelName ? source.label : 'the account just closed',
  };
}

/**
 * The carried model dressed as an import, so the upload screen and the review dialog can treat it
 * exactly as they treat a model that arrived as a file. Nothing downstream needs to know the
 * difference.
 */
export function carriedAsImport(carried: CarriedModel): ParsedImport {
  return {
    models: [carried.model],
    sheets: [
      {
        name: carried.model.name ? `${carried.model.name} (carried over)` : 'The model, carried over',
        read: 'model',
        rows: carried.model.rows.length,
      },
    ],
    warnings: [],
  };
}

/**
 * The account's starting position, read back out as if it were its holdings export.
 *
 * The baseline is the file as it was loaded plus any correction made in "Edit current holdings",
 * which edits the baseline rather than trading. Trades made since are left out on purpose: see
 * `swapModel`. A model row the account never held is not a holding and is left out as well.
 *
 * `prices` is every price the account knows, held or not: the table's own figures, typed ones
 * included, and those of an off-model row bought since. They seed the next review's fields.
 */
export function startingHoldings(state: ExplorerState): {
  holdings: ParsedHoldings;
  prices: Record<string, number>;
} {
  const { portfolio, baseline, source } = state;

  const prices: Record<string, number> = {};
  for (const s of portfolio.stocks) if (s.price > 0) prices[s.sym] = s.price;
  for (const h of portfolio.offModel) if (h.price > 0) prices[h.sym] = h.price;

  /* Summed by symbol, because an off-model row can repeat a ticker, and the parser would have
     read one line of a holdings file per security. */
  const held = new Map<string, HoldingRow>();
  const hold = (sym: string, shares: number, price: number, tradeable: boolean) => {
    if (shares <= 0) return;
    const row = held.get(sym);
    if (row) row.shares += shares;
    else held.set(sym, { sym, shares, price: prices[sym] ?? price, tradeable });
  };
  for (const s of portfolio.stocks) {
    hold(s.sym, baseline.shares[s.id] ?? 0, s.price, s.tradeable !== false);
  }
  for (const h of baseline.offModel ?? []) hold(h.sym, h.shares, h.price, true);

  return {
    holdings: {
      /* The account and nothing else, for the same reason as `carryModel`'s `from`: a label that
         fell back to the model name would put the old model's name on the new one's account. */
      accountName:
        source?.label && source.label !== source.modelName ? source.label : undefined,
      positions: [...held.values()],
      cash: baseline.cash,
      /* Whatever the first load settled for the balance, file or typed, is the balance now. */
      cashFound: true,
    },
    prices,
  };
}

/**
 * The same account on a new model: the other half of "Update files".
 *
 * It starts again from the starting position and clears the trade log. The trades were decided
 * against the old model and may be wrong under the new one, so it is as if the holdings file had
 * been loaded with this model to begin with (the CFP's call, 2026-09-24).
 *
 * Every price the account already has comes along, which is what makes overlapping models cheap
 * to swap between: a held position is priced by the holdings, a ticker both models share keeps
 * the price typed for it, and only a ticker new to this account asks for one. The order of
 * priority comes along for the tickers both models share, being the advisor's view of the
 * security rather than of either model.
 */
export function swapModel(state: ExplorerState, modelFile: ParsedImport): PendingImport {
  const { holdings, prices } = startingHoldings(state);

  const rankOf = new Map<string, number>();
  for (const s of state.portfolio.stocks) if (s.rank) rankOf.set(s.sym, s.rank);

  return {
    parsed: {
      models: modelFile.models.map((m) => ({
        ...m,
        rows: m.rows.map((r) => (rankOf.has(r.sym) ? { ...r, rank: rankOf.get(r.sym) } : r)),
      })),
      holdings,
      sheets: [
        ...modelFile.sheets,
        {
          name: holdings.accountName
            ? `${holdings.accountName} (current holdings)`
            : 'The current holdings',
          read: 'holdings',
          rows: holdings.positions.length,
        },
      ],
      warnings: modelFile.warnings,
    },
    keptPrices: prices,
    loadedAt: state.source?.loadedAt,
  };
}
