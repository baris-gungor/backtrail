import type { EntryDecision, ExitDecision } from '../../analysis/domain/strategy';
import type { Bar } from '../../market-data/domain/bar';
import type { ExitLevels, Slot } from './execution';

/**
 * A `Slot` stored by bar time instead of bar index, because indexes shift when older bars are
 * backfilled. Times are ISO strings so the value round-trips through jsonb.
 */
export interface StoredSlot {
  pending:
    | { kind: 'entry'; signalTime: string; decision: EntryDecision; side?: 'short' }
    | { kind: 'exit'; signalTime: string; decision: ExitDecision; cause?: 'earnings' }
    | null;
  entrySignalTime: string | null;
  entryBarTime: string | null;
  levels: ExitLevels;
  /** Side of the held position; missing means long. */
  side?: 'short';
}

export const FLAT_SLOT: StoredSlot = {
  pending: null,
  entrySignalTime: null,
  entryBarTime: null,
  levels: {},
};

export function storeSlot(slot: Slot, bars: Bar[]): StoredSlot {
  const time = (i: number) => (i >= 0 ? bars[i].openTime.toISOString() : null);
  const { pending } = slot;
  return {
    pending:
      pending &&
      (pending.kind === 'entry'
        ? {
            kind: 'entry',
            signalTime: time(pending.signalIndex)!,
            decision: pending.decision,
            ...(pending.side === 'short' ? { side: 'short' as const } : {}),
          }
        : {
            kind: 'exit',
            signalTime: time(pending.signalIndex)!,
            decision: pending.decision,
            ...(pending.cause ? { cause: pending.cause } : {}),
          }),
    entrySignalTime: time(slot.entrySignalIndex),
    entryBarTime: time(slot.entryBarIndex),
    levels: slot.levels,
    ...(slot.side === 'short' ? { side: 'short' as const } : {}),
  };
}

/** Index of the bar opening at `time`, or of the latest bar before it; -1 when none. */
export function indexAtOrBefore(bars: Bar[], time: Date): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].openTime.getTime() <= time.getTime()) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function loadSlot(key: string, stored: StoredSlot, bars: Bar[]): Slot {
  const index = (time: string | null) => (time ? indexAtOrBefore(bars, new Date(time)) : -1);
  const { pending } = stored;
  return {
    key,
    pending:
      pending &&
      (pending.kind === 'entry'
        ? {
            kind: 'entry',
            signalIndex: index(pending.signalTime),
            decision: pending.decision,
            ...(pending.side ? { side: pending.side } : {}),
          }
        : {
            kind: 'exit',
            signalIndex: index(pending.signalTime),
            decision: pending.decision,
            ...(pending.cause ? { cause: pending.cause } : {}),
          }),
    entrySignalIndex: index(stored.entrySignalTime),
    entryBarIndex: index(stored.entryBarTime),
    levels: stored.levels,
    ...(stored.side ? { side: stored.side } : {}),
  };
}
