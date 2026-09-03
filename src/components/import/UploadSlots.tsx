import { useRef, useState } from 'react';
import { parseSheets } from '@/lib/import/parse';
import { readWorkbook } from '@/lib/import/workbook';
import { ParsedImport } from '@/lib/import/types';
import { money } from '@/lib/format';

/**
 * Two files, two slots.
 *
 * The exports are different documents doing different jobs — one carries the mandate, the other
 * carries the account — so each gets its own target and its own verdict. A single combined
 * dropzone left the advisor guessing which file had actually been understood, and put the two
 * possible failures behind one message.
 */

interface Slot {
  file: File;
  parsed: ParsedImport;
  summary: string;
}

export type Kind = 'model' | 'holdings';

/** Reads one file and checks it is the kind this slot expects. */
async function readSlot(file: File, kind: Kind): Promise<Slot> {
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
        ? 'This looks like a model export. Try it in the model slot instead.'
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

function SlotCard({
  kind,
  step,
  title,
  blurb,
  slot,
  error,
  busy,
  onFile,
  onClear,
}: {
  kind: Kind;
  step: string;
  title: string;
  blurb: string;
  slot?: Slot;
  error?: string;
  busy: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const filled = Boolean(slot);
  const tone = error
    ? 'border-sell bg-sell-soft'
    : filled
      ? 'border-buy bg-buy-soft'
      : over
        ? 'border-accent bg-accent-soft'
        : 'border-line bg-paper';

  return (
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
        if (f) onFile(f);
      }}
      className={`flex flex-col rounded-xl border-2 border-dashed px-5 py-5 transition-colors ${tone}`}
    >
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />

      <div className="flex items-baseline gap-2">
        <span
          className={`badge ${
            filled && !error ? 'bg-buy text-white' : 'bg-accent-soft text-accent'
          }`}
        >
          {filled && !error ? '✓' : step}
        </span>
        <h3 className="text-[15px] font-bold">{title}</h3>
      </div>

      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{blurb}</p>

      {slot && !error ? (
        <div className="mt-3">
          <p className="truncate font-mono text-[13px] font-semibold" title={slot.file.name}>
            {slot.file.name}
          </p>
          <p className="mt-0.5 font-mono text-[12.5px] text-ink-soft">{slot.summary}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
              Replace
            </button>
            <button className="btn-ghost hover:border-sell hover:text-sell" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {error && <p className="mb-2.5 text-[13px] leading-relaxed text-sell">{error}</p>}
          <button className="btn-outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Reading…' : `Choose the ${kind} file`}
          </button>
          <p className="mt-2 text-[12.5px] text-ink-soft">or drop it here &middot; .xlsx or .csv</p>
        </div>
      )}
    </div>
  );
}

export default function UploadSlots({ onReady }: { onReady: (parsed: ParsedImport) => void }) {
  const [slots, setSlots] = useState<Partial<Record<Kind, Slot>>>({});
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({});
  const [busy, setBusy] = useState<Kind | null>(null);

  const take = async (kind: Kind, file: File) => {
    setBusy(kind);
    setErrors((e) => ({ ...e, [kind]: undefined }));
    try {
      const slot = await readSlot(file, kind);
      setSlots((s) => ({ ...s, [kind]: slot }));
    } catch (err) {
      setSlots((s) => ({ ...s, [kind]: undefined }));
      setErrors((e) => ({
        ...e,
        [kind]: err instanceof Error ? err.message : 'That file could not be read.',
      }));
    } finally {
      setBusy(null);
    }
  };

  const clear = (kind: Kind) => {
    setSlots((s) => ({ ...s, [kind]: undefined }));
    setErrors((e) => ({ ...e, [kind]: undefined }));
  };

  /** Both slots folded into the single shape the review step reads. */
  const merged = (): ParsedImport => ({
    models: slots.model?.parsed.models ?? [],
    holdings: slots.holdings?.parsed.holdings,
    sheets: [...(slots.model?.parsed.sheets ?? []), ...(slots.holdings?.parsed.sheets ?? [])],
    warnings: [
      ...(slots.model?.parsed.warnings ?? []),
      ...(slots.holdings?.parsed.warnings ?? []),
    ],
  });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SlotCard
          kind="model"
          step="1"
          title="The model"
          blurb="Targets and drift bands, plus the cash band. This is the mandate every position is measured against."
          slot={slots.model}
          error={errors.model}
          busy={busy === 'model'}
          onFile={(f) => take('model', f)}
          onClear={() => clear('model')}
        />
        <SlotCard
          kind="holdings"
          step="2"
          title="The holdings"
          blurb="What the account actually owns: share counts, prices and the cash balance."
          slot={slots.holdings}
          error={errors.holdings}
          busy={busy === 'holdings'}
          onFile={(f) => take('holdings', f)}
          onClear={() => clear('holdings')}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
        <button
          className="btn-solid px-6 py-3 text-[15px]"
          disabled={!slots.model}
          onClick={() => onReady(merged())}
        >
          Review and load
        </button>
        <span className="text-[13.5px] text-ink-soft">
          {!slots.model
            ? 'The model is required — targets and bands live in it.'
            : !slots.holdings
              ? 'Holdings are optional; without them every position starts at zero shares.'
              : 'Both files read. Nothing changes until you apply.'}
        </span>
      </div>
    </>
  );
}
