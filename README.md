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
npm test        # 105 tests
npm run build
```

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
```

`src/lib/engine.ts` is the place to start. Everything visible is derived from it.
