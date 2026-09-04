'use client';

import { contextSheet, ordersSheet, tradeLogFilename } from './tradeLog';
import { buildXlsx } from './write';
import { orderSummary } from '../orders';
import { ExplorerState } from '../types';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Builds the workbook and hands it to the browser as a download.
 *
 * The object URL is revoked on the next frame rather than immediately: revoking it in the same
 * tick can beat the browser to reading it, and the download quietly does nothing.
 */
export function downloadTradeLog(state: ExplorerState, now = new Date()): void {
  const label = state.source?.label ?? 'Untitled portfolio';
  const { orders, cashBefore, steps } = orderSummary(state);

  const bytes = buildXlsx([
    ordersSheet(orders, state.portfolio, cashBefore),
    contextSheet(state.portfolio, label, now, steps),
  ]);

  // A fresh ArrayBuffer, so the Blob never holds a view into a larger pooled buffer.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: MIME });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = tradeLogFilename(label, now);
  document.body.appendChild(a);
  a.click();
  a.remove();

  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
