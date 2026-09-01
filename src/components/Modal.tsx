import { useEffect } from 'react';

export default function Modal({
  title,
  subtitle,
  width = 'max-w-3xl',
  footer,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  width?: string;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind is a wide table; letting it scroll under the panel is disorienting.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[88vh] w-full ${width} flex-col overflow-hidden rounded-2xl
                    bg-panel shadow-[0_24px_70px_rgba(20,23,30,0.28)]`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.01em]">{title}</h2>
            {subtitle && (
              <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-ink-soft">
                {subtitle}
              </p>
            )}
          </div>
          <button
            className="-mr-2 -mt-1 rounded-lg px-2 py-1 text-2xl leading-none text-ink-faint
                       transition-colors hover:bg-paper hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
