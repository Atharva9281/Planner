import Link from 'next/link';

/**
 * The front door.
 *
 * Deliberately the same page furniture as the landing screen rather than a bare browser
 * credential box: this is the first thing anyone sees, including the advisor opening the
 * installed app on a Monday morning, and a native auth dialog inside a standalone window cannot
 * be styled, cannot explain itself, and leaves no way back if it is dismissed.
 */
export default async function UnlockPage({
  searchParams,
}: {
  // A promise since Next 15. Reading it synchronously is deprecated.
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const configured = Boolean(process.env.APP_PASSWORD);

  return (
    <div className="mx-auto max-w-[100rem] px-5 py-6 sm:px-7">
      <div className="flex min-h-[78vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-[-0.02em] sm:text-5xl">
          Cash Deployment Explorer
          <span className="mt-1 block text-accent">Lot-Aware</span>
        </h1>

        {configured ? (
          <>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-soft">
              This copy is private. Enter the password to continue.
            </p>

            <form
              method="POST"
              action="/api/unlock"
              className="mt-8 flex w-full max-w-sm flex-col gap-3"
            >
              <input type="hidden" name="from" value={from ?? '/'} />
              <input
                type="password"
                name="password"
                autoFocus
                required
                autoComplete="current-password"
                aria-label="Password"
                aria-invalid={error ? true : undefined}
                className={`field text-center text-[15px] ${error ? 'border-sell' : ''}`}
              />
              <button type="submit" className="btn-solid px-8 py-3.5 text-[16px]">
                Unlock
              </button>
            </form>

            {error && (
              <p className="mt-4 text-[13.5px] font-semibold text-sell">
                That password was not right. Try again.
              </p>
            )}

            <p className="mt-8 max-w-md text-[13px] leading-relaxed text-ink-faint">
              Account files are read in your browser and never uploaded, whether or not this
              password is set. It keeps the tool itself private, not the data.
            </p>
          </>
        ) : (
          /* Reachable only by typing the address: with no password configured the proxy lets
             every route through and never sends anyone here. */
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-soft">
            No password is set on this deployment, so there is nothing to unlock.{' '}
            <Link className="font-semibold text-accent underline underline-offset-2" href="/">
              Go to the app
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
