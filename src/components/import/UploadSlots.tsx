import { useRef, useState } from 'react';
import { carriedAsImport } from '@/lib/import/carry';
import { Kind, SlotRead, readSlot } from '@/lib/import/slot';
import { CarriedModel, ParsedImport } from '@/lib/import/types';

/**
 * Two files, two slots.
 *
 * The exports are different documents doing different jobs — one carries the mandate, the other
 * carries the account — so each gets its own target and its own verdict. A single combined
 * dropzone left the advisor guessing which file had actually been understood, and put the two
 * possible failures behind one message.
 *
 * This is the start-over screen. The ordinary path from one account to the next no longer comes
 * through here at all: "Load different files" asks for the holdings export in its own dialog,
 * with the model already in hand. What reaches this screen is someone starting again from
 * nothing — though a kept model still fills the first slot, since it costs nothing to offer and
 * Remove is one click.
 */

interface Slot extends Partial<SlotRead> {
  parsed: ParsedImport;
  summary: string;
  /** The account the model was carried from, when it did not come from a file. */
  carriedFrom?: string;
}

const fromCarried = (carried: CarriedModel): Slot => ({
  parsed: carriedAsImport(carried),
  summary: `${carried.model.rows.length} positions${
    carried.model.cashBand
      ? ` · cash band ${carried.model.cashBand.floor}–${carried.model.cashBand.ceiling}%`
      : ''
  }`,
  carriedFrom: carried.from,
});

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
  onRestore,
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
  /** Offered only where a kept model was removed and could be put back. */
  onRestore?: () => void;
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
          {slot.file ? (
            <p className="truncate font-mono text-[13px] font-semibold" title={slot.file.name}>
              {slot.file.name}
            </p>
          ) : (
            /* No file name to show, so say where it did come from. Left unsaid, a slot that
               filled itself in looks like the last account never really closed. */
            <p className="text-[13px] font-semibold">
              Carried over from{' '}
              <span className="text-ink-soft">{slot.carriedFrom}</span>
            </p>
          )}
          <p className="mt-0.5 font-mono text-[12.5px] text-ink-soft">{slot.summary}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
              {slot.file ? 'Replace' : 'Use a different model'}
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
          {/* Removing the kept model is one click, and without this so is losing it: the advisor
              would be off hunting for the very export this was meant to save him. */}
          {onRestore && (
            <button
              className="mt-2.5 text-[12.5px] font-semibold text-accent underline underline-offset-2 hover:text-accent-deep"
              onClick={onRestore}
            >
              Put the kept model back
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function UploadSlots({
  carried,
  onReady,
}: {
  /** A model kept from the account just closed, which fills the model slot on arrival. */
  carried?: CarriedModel;
  onReady: (parsed: ParsedImport, carried?: CarriedModel) => void;
}) {
  const [slots, setSlots] = useState<Partial<Record<Kind, Slot>>>(() =>
    carried ? { model: fromCarried(carried) } : {},
  );
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({});
  const [busy, setBusy] = useState<Kind | null>(null);

  /* True while the model slot still holds the carried model rather than a file the advisor chose
     here. Replacing or removing it turns this off, and with it the price seeding downstream: the
     old account's prices have no business in an import whose model came from somewhere else. */
  const usingCarried = Boolean(carried) && !slots.model?.file && Boolean(slots.model);

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
          blurb={
            usingCarried
              ? 'The mandate from the account you just closed, kept because one model usually covers several accounts. Replace it if this account works to a different one.'
              : 'Targets and drift bands, plus the cash band. This is the mandate every position is measured against.'
          }
          slot={slots.model}
          error={errors.model}
          busy={busy === 'model'}
          onFile={(f) => take('model', f)}
          onClear={() => clear('model')}
          onRestore={
            carried && !slots.model
              ? () => {
                  setErrors((e) => ({ ...e, model: undefined }));
                  setSlots((s) => ({ ...s, model: fromCarried(carried) }));
                }
              : undefined
          }
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
          onClick={() => onReady(merged(), usingCarried ? carried : undefined)}
        >
          Review and load
        </button>
        <span className="text-[13.5px] text-ink-soft">
          {!slots.model
            ? 'The model is required — targets and bands live in it.'
            : !slots.holdings
              ? usingCarried
                ? 'Add this account’s holdings export, or load the model on its own and every position starts at zero shares.'
                : 'Holdings are optional; without them every position starts at zero shares.'
              : 'Both files read. Nothing changes until you apply.'}
        </span>
      </div>
    </>
  );
}
