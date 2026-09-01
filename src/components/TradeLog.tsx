import { money, pct, shares as fmtShares } from '@/lib/format';
import { LogEntry, Portfolio } from '@/lib/types';

/**
 * The session's trades as a blotter, oldest first, so the running cash column reads top to bottom
 * in the order the decisions were made — and so the whole thing drops into a spreadsheet as-is.
 *
 * Every field the engine records gets a column. Nothing is folded into prose, because a figure in
 * a sentence cannot be summed, sorted or exported.
 *
 * The band crossings are evaluated against the *current* floor and ceiling rather than the ones in
 * force when the trade ran, so moving the band re-marks the history — which is the point when the
 * band itself is the thing being explored.
 */

/** Columns between the sequence number and the cash figures, spanned by the opening row. */
const TRADE_COLUMNS = 7;

interface Marks {
  crossedFloor: boolean;
  crossedCeiling: boolean;
}

function marks(e: LogEntry, p: Portfolio): Marks {
  return {
    crossedFloor: e.source === 'model' && e.pctBefore > p.cashFloor && e.pctAfter <= p.cashFloor,
    crossedCeiling:
      e.source === 'model' &&
      e.action === 'SELL' &&
      e.pctBefore <= p.cashCeiling &&
      e.pctAfter > p.cashCeiling,
  };
}

export default function TradeLog({ log, portfolio }: { log: LogEntry[]; portfolio: Portfolio }) {
  if (log.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[14px] text-ink-soft">
        No trades yet. Use the buttons above.
      </p>
    );
  }

  return (
    <div className="table-stick">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th rounded-tl-lg">#</th>
            <th className="th th-lead">Action</th>
            <th className="th th-lead">Symbol</th>
            <th className="th text-right">Shares</th>
            <th className="th text-right">Price</th>
            <th className="th text-right">Amount</th>
            <th className="th text-right">Ends at</th>
            <th className="th">Lot</th>
            <th className="th th-lead text-right">Cash after</th>
            <th className="th text-right">Cash %</th>
            <th className="th rounded-tr-lg">Note</th>
          </tr>
        </thead>
        <tbody>
          {/* Where cash stood before any of this, so the running column has a starting point. */}
          <tr className="bg-paper">
            <td className="td text-ink-faint">&mdash;</td>
            <td className="td font-sans text-[13px] text-ink-soft" colSpan={TRADE_COLUMNS}>
              Opening balance
            </td>
            <td className="td text-right text-ink-soft">{money(log[0].cashBefore)}</td>
            <td className="td text-right text-ink-soft">{pct(log[0].pctBefore)}</td>
            <td className="td" />
          </tr>

          {log.map((e, i) => {
            const { crossedFloor, crossedCeiling } = marks(e, portfolio);
            const flagged = crossedFloor || crossedCeiling;

            return (
              <tr
                key={e.id}
                className={
                  flagged
                    ? 'bg-warn-soft shadow-[inset_3px_0_0_0_var(--color-warn)]'
                    : i % 2
                      ? 'bg-panel-alt'
                      : 'bg-panel'
                }
              >
                <td className="td text-ink-faint">{i + 1}</td>

                <td className="td">
                  <span
                    className={`font-sans text-[13.5px] font-bold ${
                      e.action === 'BUY' ? 'text-buy' : 'text-sell'
                    }`}
                  >
                    {e.action}
                  </span>
                </td>

                <td className="td font-sans text-[14px] font-bold">{e.sym}</td>
                <td className="td text-right">{fmtShares(e.shares)}</td>
                <td className="td text-right">{money(e.price)}</td>
                <td className="td text-right font-semibold">{money(e.amount)}</td>

                {/* An off-model holding is sold entire and has no model row left behind, so there
                    is no resting position and no lot to judge it against. */}
                <td className="td text-right">
                  {e.source === 'model' ? `${fmtShares(e.resultShares)} sh` : '0 sh'}
                </td>
                <td className="td">
                  {e.source === 'model' ? (
                    <span
                      className={`badge ${
                        e.resultIsLot ? 'bg-buy-soft text-buy' : 'bg-warn-soft text-warn'
                      }`}
                    >
                      {e.resultIsLot ? 'yes' : 'no'}
                    </span>
                  ) : (
                    <span className="text-ink-faint">&mdash;</span>
                  )}
                </td>

                <td className="td text-right font-semibold">{money(e.cashAfter)}</td>
                <td
                  className={`td text-right ${
                    e.pctAfter > portfolio.cashCeiling || e.pctAfter < portfolio.cashFloor
                      ? 'font-semibold text-warn'
                      : 'text-ink-soft'
                  }`}
                >
                  {pct(e.pctAfter)}
                </td>

                <td className="td max-w-[22rem] text-[13px] leading-relaxed whitespace-normal text-ink-soft">
                  {e.label}
                  {e.partial && (
                    <span className="sub font-semibold text-warn">
                      Partial fill: cash ran out before the full amount could be bought.
                    </span>
                  )}
                  {crossedFloor && (
                    <span className="sub font-semibold text-warn">
                      Crosses below the {portfolio.cashFloor}% floor in this step.
                    </span>
                  )}
                  {crossedCeiling && (
                    <span className="sub font-semibold text-warn">
                      Crosses above the {portfolio.cashCeiling}% ceiling in this step.
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
