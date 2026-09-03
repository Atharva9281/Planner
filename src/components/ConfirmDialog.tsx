import Modal from './Modal';

/**
 * The stop before something is thrown away.
 *
 * Three controls discard a loaded account — "Load different files", "Clear the whole portfolio",
 * and applying a fresh import over an existing one — and until now all three did it on one click
 * with nothing in between. That was survivable while the workspace died with the browser tab
 * anyway. It is not survivable now that it persists: the app keeps your work across days, which
 * says the work is safe, and then discards it silently on a misclick.
 *
 * The wording names what is actually lost, counted, rather than asking whether the advisor is
 * sure. "6 trades and a loaded account" is a fact they can weigh; "are you sure?" is not.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} width="max-w-lg" onClose={onCancel}>
      <div className="text-[14px] leading-relaxed text-ink">{body}</div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
        {/* Cancel is the plain, wide, obvious one; the destructive action wears the sell colour
            and has to be aimed at. The dangerous button should never be the restful one. */}
        <button className="btn-outline" onClick={onCancel}>
          Cancel, keep this work
        </button>
        <button className="btn-sell px-4 py-2.5 text-[13.5px]" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
