import { useState } from 'react';

/**
 * Both inputs hold a local draft while they are being typed into and commit on blur or Enter.
 *
 * Committing on every keystroke would mean clearing a field to retype it briefly writes 0 into
 * the portfolio, which moves total account value and makes every band in both tables jump while
 * the user is mid-edit.
 */

interface Common {
  className?: string;
  title?: string;
}

export function NumInput({
  value,
  onCommit,
  step = '1',
  className,
  title,
  placeholder,
  blankZero = false,
}: Common & {
  value: number;
  onCommit: (v: number) => void;
  step?: string;
  placeholder?: string;
  /**
   * Show an empty box rather than `0`.
   *
   * For fields where zero means "not set" rather than "set to nothing" — the conviction rank being
   * the one. A column of twenty zeroes reads as twenty deliberate entries, when what it means is
   * that the advisor has said nothing about any of them.
   */
  blankZero?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      step={step}
      className={className}
      title={title}
      placeholder={placeholder}
      value={draft ?? (blankZero && value === 0 ? '' : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        onCommit(Number(draft) || 0);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function SymInput({
  value,
  onCommit,
  className,
  title,
}: Common & { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className={className}
      title={title}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
