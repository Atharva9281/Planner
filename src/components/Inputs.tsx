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
}: Common & { value: number; onCommit: (v: number) => void; step?: string }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      step={step}
      className={className}
      title={title}
      value={draft ?? String(value)}
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
