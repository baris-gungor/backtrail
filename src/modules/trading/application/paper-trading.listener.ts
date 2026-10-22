import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ANALYSIS_COMPLETED, AnalysisCompletedEvent } from '../../analysis/domain/analysis.events';
import { BrokerRouter } from './broker-router.service';

/**
 * Processes an asset's new closed bars for every portfolio trading it, simulated and demo-broker
 * alike. Runs after signal generation (not on `market-data.synced`), so subscriptions with source
 * `signals` see the new signals.
 */
@Injectable()
export class PaperTradingListener {
  private readonly logger = new Logger(PaperTradingListener.name);

  constructor(private readonly brokers: BrokerRouter) {}

  @OnEvent(ANALYSIS_COMPLETED, { async: true })
  async onAnalysisCompleted(event: AnalysisCompletedEvent): Promise<void> {
    for (const broker of this.brokers.all()) {
      try {
        await broker.processAsset(event.assetId);
      } catch (error) {
        this.logger.error({ msg: 'Bar processing failed', assetId: event.assetId, err: error });
      }
    }
  }
}
