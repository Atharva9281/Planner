import { useRef, useState } from 'react';
import Modal from '../Modal';
import { carriedAsImport } from '@/lib/import/carry';
import { Kind, readSlot } from '@/lib/import/slot';
import { CarriedModel, ParsedHoldings, ParsedImport } from '@/lib/import/types';
import { money } from '@/lib/format';

/**
 * "Update files": one file changes, the other stays.
 *
 * "Update files" (once "Load different files") used to open a confirmation about discarding, and
 * the actual file picker was two screens away — so the dialog talked about what was being lost and said nothing
 * about what to do next. There are two ordinary next steps, and each needs exactly one file, so
 * both are asked for here and choosing the file *is* the confirmation:
 *
 *   - the next account on the same model, which one model covering several accounts makes the
 *     common case: this account's holdings export;
 *   - the same account on a different model (2026-09-24): the new model export, measured against
 *     the holdings already loaded.
 *
 * What is being replaced is still stated, under each. A line in a dialog about loading, rather
 * than the whole of a dialog about discarding.
 *
 * "Start over" is the way out when both change: it throws the model away too and returns to the
 * upload screen. Named, rather than left to be discovered as a Remove button on the slot
 * afterwards.
 */
export default function LoadNextAccount({
  carried,
  holdings,
  onReady,
  onModel,
  onStartOver,
  onCancel,
}: {
  carried: CarriedModel;
  /** The account's starting holdings, which a new model is measured against. */
  holdings: ParsedHoldings;
  onReady: (parsed: ParsedImport, carried: CarriedModel) => void;
  /** A model export read and checked, for the same account. */
  onModel: (modelFile: ParsedImport) => void;
  onStartOver: () => void;
  onCancel: () => void;
}) {
  const band = carried.model.cashBand;

  const takeHoldings = async (file: File) => {
    const read = await readSlot(file, 'holdings');
    const model = carriedAsImport(carried);
    onReady(
      {
        models: model.models,
        holdings: read.parsed.holdings,
        sheets: [...model.sheets, ...read.parsed.sheets],
        warnings: read.parsed.warnings,
      },
      carried,
    );
  };

  const takeModel = async (file: File) => onModel((await readSlot(file, 'model')).parsed);

  return (
    <Modal title="Update files" width="max-w-3xl" onClose={onCancel}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Path
          heading="New account"
          kept="Model remains unchanged"
          keptDetail={`${carried.model.rows.length} positions${
            band ? ` · cash band ${band.floor}–${band.ceiling}%` : ''
          }`}
          kind="holdings"
          onFile={takeHoldings}
          note="This replaces the currently loaded account. Download the trade log first, if needed, before uploading the new account file."
        />
        <Path
          heading="New model"
          kept="Holdings remain unchanged"
          keptDetail={`${holdings.positions.length} position${
            holdings.positions.length === 1 ? '' : 's'
          } · ${money(holdings.cash)} cash`}
          kind="model"
          onFile={takeModel}
          note="This replaces the current model and clears any trades made. Download the trade log first, if needed."
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
        <button className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
        {/* The other reason to be here: a different account on a different mandate. Wears the
            sell colour because it throws the model away as well, which neither path above does. */}
        <button className="btn-danger px-4 py-2.5 text-[13.5px]" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </Modal>
  );
}

/** One way through: what stays, a drop zone for the file that changes, and what it replaces. */
function Path({
  heading,
  kept,
  keptDetail,
  kind,
  onFile,
  note,
}: {
  heading: string;
  kept: string;
  keptDetail: string;
  kind: Kind;
  /** Reads the file and moves on; throws with the words to show when it is the wrong one. */
  onFile: (file: File) => Promise<void>;
  note: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await onFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col">
      <div className="modal-section">
        <h3>{heading}</h3>
      </div>

      <div className="rounded-lg border border-line bg-paper px-4 py-3">
        <p className="text-[13.5px] font-bold">{kept}</p>
        <p className="mt-0.5 font-mono text-[12.5px] text-ink-soft">{keptDetail}</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) take(f);
        }}
        className={`mt-4 rounded-xl border-2 border-dashed px-5 py-6 text-center transition-colors ${
          error
            ? 'border-danger bg-danger-soft'
            : over
              ? 'border-accent bg-accent-soft'
              : 'border-line bg-paper'
        }`}
      >
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) take(f);
            e.target.value = '';
          }}
        />

        {error && <p className="mb-3 text-[13px] leading-relaxed text-danger">{error}</p>}

        <button
          className="btn-solid px-5 py-2.5 text-[14px]"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Reading…' : `Choose the ${kind} file`}
        </button>
        <p className="mt-2 text-[12.5px] text-ink-soft">
          or drop it here &middot; .xlsx or .csv
        </p>
      </div>

      <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">{note}</p>
    </section>
  );
}
