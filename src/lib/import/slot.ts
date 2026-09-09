import { money } from '../format';
import { parseSheets } from './parse';
import { ParsedImport } from './types';
import { readWorkbook } from './workbook';

/**
 * Reading one dropped file and deciding whether it is the kind that was asked for.
 *
 * Shared by the two places a file is taken: the upload screen's two slots, and the dialog that
 * loads the next account onto a model already in hand. Both have to reject a model export offered
 * as holdings with the same words, because it is the same mistake.
 */

export type Kind = 'model' | 'holdings';

export interface SlotRead {
  file: File;
  parsed: ParsedImport;
  /** One line describing what was found, shown under the file name. */
  summary: string;
}

export async function readSlot(file: File, kind: Kind): Promise<SlotRead> {
  const parsed = parseSheets(await readWorkbook(file));

  if (kind === 'model') {
    const model = parsed.models[0];
    if (!model) {
      throw new Error(
        parsed.holdings
          ? 'This looks like a holdings export. Try it in the holdings slot instead.'
          : 'No model found. A model export needs a Symbol column and an Allocation % column.',
      );
    }
    const band = model.cashBand;
    return {
      file,
      parsed,
      summary: `${model.rows.length} positions${
        band ? ` · cash band ${band.floor}–${band.ceiling}%` : ' · no cash row'
      }`,
    };
  }

  const holdings = parsed.holdings;
  if (!holdings) {
    throw new Error(
      parsed.models.length > 0
        ? 'This looks like a model export, not an account. The model is already loaded — this slot wants the holdings export.'
        : 'No holdings found. A holdings export needs a Symbol column and a Quantity column.',
    );
  }
  /* An account that has been funded but not yet invested reads as zero positions, which on its
     own looks like a file that failed. Say what it does carry instead. */
  const what =
    holdings.positions.length === 0 && holdings.cashFound
      ? `cash only · ${money(holdings.cash)}`
      : `${holdings.positions.length} positions`;

  return {
    file,
    parsed,
    summary: `${what}${holdings.accountName ? ` · ${holdings.accountName}` : ''}`,
  };
}
