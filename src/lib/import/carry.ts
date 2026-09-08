import { ExplorerState } from '../types';
import { CarriedModel, ParsedImport } from './types';

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
      /* Never the account name. `source.label` is the account wherever the holdings file named
         one, and calling a model after one of the accounts it serves is how it ends up looking
         like that account's own. */
      name: source?.modelName || 'Model carried over',
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
      })),
      cashBand: {
        target: portfolio.cashTarget,
        floor: portfolio.cashFloor,
        ceiling: portfolio.cashCeiling,
      },
    },
    prices,
    from: source?.label || 'the account just closed',
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
    sheets: [{ name: `${carried.model.name} (carried over)`, read: 'model', rows: carried.model.rows.length }],
    warnings: [],
  };
}
