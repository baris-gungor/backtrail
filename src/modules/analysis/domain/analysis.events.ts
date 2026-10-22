export const SIGNALS_GENERATED = 'signals.generated';
export const ANALYSIS_COMPLETED = 'analysis.completed';

/** Emitted when new signals are stored. Paper trading (Phase 4) turns them into orders. */
export class SignalsGeneratedEvent {
  constructor(
    readonly assetId: string,
    readonly signalIds: string[],
  ) {}
}

/**
 * Emitted after every signal generation run for an asset, with or without new signals. Paper trading
 * processes the asset's new bars on it, when the stored signals are already up to date.
 */
export class AnalysisCompletedEvent {
  constructor(readonly assetId: string) {}
}
