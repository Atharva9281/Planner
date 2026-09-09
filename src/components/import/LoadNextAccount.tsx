import { useRef, useState } from 'react';
import Modal from '../Modal';
import { carriedAsImport } from '@/lib/import/carry';
import { readSlot } from '@/lib/import/slot';
import { CarriedModel, ParsedImport } from '@/lib/import/types';

/**
 * Moving to the next account, from the button that says so.
 *
 * "Load different files" used to open a confirmation about discarding, and the actual file
 * picker was two screens away — so the dialog talked about what was being lost and said nothing
 * about what to do next. When one model covers several accounts, the next thing is always the
 * same thing: this account's holdings export. So it is asked for here, in the dialog the button
 * opens, and choosing the file *is* the confirmation.
 *
 * What is being replaced is still stated. It is a line in a dialog about loading, rather than the
 * whole of a dialog about discarding.
 *
 * "Start over with both files" is the way out for an account on a different mandate: it throws
 * the model away too and returns to the upload screen. Named, rather than left to be discovered
 * as a Remove button on the slot afterwards.
 */
export default function LoadNextAccount({
  carried,
  atRisk,
  onReady,
  onStartOver,
  onCancel,
}: {
  carried: CarriedModel;
  /** What this replaces, in the words the old confirmation used. */
  atRisk: string[];
  onReady: (parsed: ParsedImport, carried: CarriedModel) => void;
  onStartOver: () => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const band = carried.model.cashBand;

  const take = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Load the next account" width="max-w-xl" onClose={onCancel}>
      <div className="rounded-lg border border-line bg-paper px-4 py-3">
        <p className="text-[13.5px] font-bold">The model stays as it is</p>
        <p className="mt-0.5 font-mono text-[12.5px] text-ink-soft">
          {carried.model.rows.length} positions
          {band && ` · cash band ${band.floor}–${band.ceiling}%`}
        </p>
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
          {busy ? 'Reading…' : 'Choose the holdings file'}
        </button>
        <p className="mt-2 text-[12.5px] text-ink-soft">
          or drop it here &middot; .xlsx or .csv &middot; this account&rsquo;s holdings export
        </p>
      </div>

      {atRisk.length > 0 && (
        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
          This replaces {atRisk.join(' and ')}. Download the trade log first if you need it.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
        <button className="btn-outline" onClick={onCancel}>
          Cancel, keep this work
        </button>
        {/* The other reason to be here: an account on a different mandate. Wears the sell colour
            because it throws the model away as well, which nothing else on this dialog does. */}
        <button className="btn-danger px-4 py-2.5 text-[13.5px]" onClick={onStartOver}>
          Start over with both files
        </button>
      </div>
    </Modal>
  );
}
