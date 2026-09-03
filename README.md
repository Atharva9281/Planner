# Cash Deployment Explorer, Lot-Aware

A single-portfolio tool for putting idle cash to work one decision at a time. Every "buy to
target" figure is checked against the nearest 100-share lot before it is offered, and every
position is measured against its own drift band rather than a single target number.

It runs entirely in the browser. Nothing is uploaded anywhere.

## What it reads

Two exports from the custodian, dropped onto the page:

**The model export** — what to hold and in what proportion. Five columns are read from it and
nothing else: `Symbol`, `Type`, `Allocation %`, `Min Drift %`, `Max Drift %`. Its `USD CASH` row
supplies the cash target and band. The model carries no prices, and none are invented for it.

**The holdings export** — what the account actually holds. The `Asset Class` column decides
everything:

| Asset class | What happens |
| --- | --- |
| `Cash and Equiv` | The row's **Quantity** is the cash balance |
| `Stocks / ETFs Sleeve`, `Index` | A position, and tradeable |
| `Fixed Income Sleeve` | Shown and counted toward account value, never traded |
| `Listed Option` | Dropped entirely — not a position, not part of account value |
| anything else | Held and shown, but not traded |

Prices come from the holdings file alone. Market value is computed as quantity x price rather
than read from the file, and every weight is that value over the account total.

## The one idea underneath the arithmetic

A band is a percentage of **total account value**, so its width in dollars moves whenever cash
moves, whenever a price changes, and whenever a holding is sold. Nothing caches a total.

Within that, the lot rule: convert the target weight to shares, look at the nearest multiple of
100, and take it **only if its resulting weight still lands inside the band**. The band is a
mandate; a tidy share count never justifies breaking it.

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 112 tests
npm run build
```

## Installing it as a desktop app

Hosted, then installed. In Chrome or Edge the address bar shows an install icon; in Safari it is
File → Add to Dock. Either one puts a real icon in the Dock or Start menu that opens in its own
window with no address bar. It is still the hosted site underneath, so a fix pushed here reaches
an installed copy the next time it is opened — there is nothing to download again.

A loaded portfolio is kept in the browser's local storage, so closing the window and reopening it
later returns to the same account and the same trade log. **Load different files** is how you
clear it.

## Deploying it

Netlify. The site is **not** a plain static upload: `src/proxy.ts` runs the password check on the
server before any page renders, so the host has to support Next.js server rendering. Netlify's
Next runtime turns that file into an edge function and the rest into a server handler — verified
locally with `netlify build`, including the routing rules that keep the icons and manifest open.

```bash
npx netlify-cli deploy --build --prod
```

Then set `APP_PASSWORD` once, under Site configuration → Environment variables. Nothing else is
configured; `netlify.toml` only pins the build command and the Node version.

Cloudflare Workers is the other free option and hosts this fine, but its Next.js integration takes
more setting up. Vercel's free tier is the one to avoid here — it forbids commercial use.

## The password

Set `APP_PASSWORD` in the host's environment and every route sits behind an unlock screen. Leave
it unset — as it is locally — and there is no gate at all, which is why `npm run dev` and the
tests need no login.

```bash
APP_PASSWORD='something-long' npm start
```

It is one shared password, not accounts: everyone who has it gets in, and there is no record of
who. Changing it is one field on the host. Note that nothing is shared between the people who use
it — the app keeps no server-side state, so each person's portfolios and trade logs live only in
their own browser.

The check runs in `src/proxy.ts`, on the server, before any page renders. The cookie it sets holds
a hash of the password rather than the password. None of this protects account data, because no
account data ever reaches a server: both exports are parsed in the browser and stay there. It
keeps the tool private, not the holdings.

Three routes: `/` to choose, `/example` for a worked example with invented figures, and
`/portfolio` for a real account. The two are independent workspaces held per browser tab, so
moving between them — including with the browser's Back button — never destroys the other.

## Layout

```
src/lib/engine.ts        all the math, pure functions over a portfolio
src/lib/actions.ts       state transitions, each returning a new state
src/lib/import/          reading the two .xlsx exports
src/lib/xlsx/            writing the trade log back out as a workbook
src/components/          the table, the panels, the modals
src/proxy.ts             the password gate, ahead of every route
src/app/manifest.ts      what makes it installable as a desktop app
```

`src/lib/engine.ts` is the place to start. Everything visible is derived from it.
