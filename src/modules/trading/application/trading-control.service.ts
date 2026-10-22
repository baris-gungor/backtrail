import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { NotFoundError } from '../../../common/errors/domain.error';
import { AuditService } from '../../audit/application/audit.service';
import type { AuditActor } from '../../audit/infrastructure/audit-event.entity';
import { NotificationService } from '../../notifications/application/notification.service';
import { PortfolioEntity } from '../infrastructure/portfolio.entity';
import { PositionEntity } from '../infrastructure/position.entity';
import { TRADING_STATE_ID, TradingStateEntity } from '../infrastructure/trading-state.entity';
import { BrokerRouter } from './broker-router.service';

export interface TradingStateView {
  halted: boolean;
  reason: string | null;
  changedAt: Date | null;
  /** Portfolios halted on their own (e.g. by reconciliation). */
  haltedPortfolios: { id: string; name: string; reason: string | null; haltedAt: Date }[];
}

/**
 * Kill switch. While halted no automatic orders are created and manual BUYs are
 * rejected; SELLs and closing positions stay possible.
 */
@Injectable()
export class TradingControlService {
  private readonly logger = new Logger(TradingControlService.name);

  constructor(
    @InjectRepository(TradingStateEntity)
    private readonly states: Repository<TradingStateEntity>,
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    @InjectRepository(PositionEntity) private readonly positions: Repository<PositionEntity>,
    private readonly brokers: BrokerRouter,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async state(): Promise<TradingStateView> {
    const row = await this.states.findOneBy({ id: TRADING_STATE_ID });
    const halted = await this.portfolios.find({
      where: { haltedAt: Not(IsNull()) },
      order: { haltedAt: 'ASC' },
    });
    return {
      halted: row?.halted ?? false,
      reason: row?.reason ?? null,
      changedAt: row?.changedAt ?? null,
      haltedPortfolios: halted.map((p) => ({
        id: p.id,
        name: p.name,
        reason: p.haltReason,
        haltedAt: p.haltedAt!,
      })),
    };
  }

  async isHalted(portfolio: Pick<PortfolioEntity, 'haltedAt'>): Promise<boolean> {
    if (portfolio.haltedAt) return true;
    return (await this.states.findOneBy({ id: TRADING_STATE_ID }))?.halted ?? false;
  }

  /** Halts every portfolio. Optionally closes all positions with market orders. */
  async halt(reason: string, closePositions = false): Promise<TradingStateView> {
    const before = await this.state();
    await this.states.save({ id: TRADING_STATE_ID, halted: true, reason });
    // The halt flag is stored first: from here on no automatic order is created, whatever fails
    // below. Each portfolio is cleaned up on its own, so one broker error does not skip the rest.
    const ids = (await this.portfolios.findBy({ isActive: true })).map((p) => p.id);
    const failures = await this.stopAutomaticOrders(ids);
    if (closePositions) failures.push(...(await this.closeAll(ids)));
    const after = await this.state();
    await this.audit.record({
      action: 'trading.halt',
      entityType: 'trading',
      before,
      after: { ...after, closePositions, ...(failures.length ? { failures } : {}) },
    });
    if (failures.length) {
      this.logger.error({ msg: 'Trading halted with failures', reason, closePositions, failures });
    } else {
      this.logger.warn({ msg: 'Trading halted', reason, closePositions });
    }
    this.notifications.notify(
      this.notifications.texts.haltMessage({ portfolio: null, reason, actor: 'user' }),
    );
    return after;
  }

  async resume(): Promise<TradingStateView> {
    const before = await this.state();
    await this.states.save({ id: TRADING_STATE_ID, halted: false, reason: null });
    const after = await this.state();
    await this.audit.record({ action: 'trading.resume', entityType: 'trading', before, after });
    this.logger.log({ msg: 'Trading resumed' });
    this.notifications.notify(this.notifications.texts.resumeMessage(null));
    return after;
  }

  /** Halts one portfolio, e.g. after a reconciliation difference. */
  async haltPortfolio(
    portfolioId: string,
    reason: string,
    actor: AuditActor = 'user',
  ): Promise<void> {
    const portfolio = await this.portfolios.findOneBy({ id: portfolioId });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    const before = { haltedAt: portfolio.haltedAt, haltReason: portfolio.haltReason };
    portfolio.haltedAt = new Date();
    portfolio.haltReason = reason;
    await this.portfolios.save(portfolio);
    const failures = await this.stopAutomaticOrders([portfolioId]);
    await this.audit.record({
      actor,
      action: 'portfolio.halt',
      entityType: 'portfolio',
      entityId: portfolioId,
      before,
      after: {
        haltedAt: portfolio.haltedAt,
        haltReason: reason,
        ...(failures.length ? { failures } : {}),
      },
    });
    this.logger.warn({ msg: `Portfolio ${portfolio.name} halted`, portfolioId, reason });
    this.notifications.notify(
      this.notifications.texts.haltMessage({ portfolio: portfolio.name, reason, actor }),
    );
  }

  async resumePortfolio(portfolioId: string): Promise<void> {
    const portfolio = await this.portfolios.findOneBy({ id: portfolioId });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    const before = { haltedAt: portfolio.haltedAt, haltReason: portfolio.haltReason };
    portfolio.haltedAt = null;
    portfolio.haltReason = null;
    await this.portfolios.save(portfolio);
    await this.audit.record({
      action: 'portfolio.resume',
      entityType: 'portfolio',
      entityId: portfolioId,
      before,
      after: { haltedAt: null, haltReason: null },
    });
    this.notifications.notify(this.notifications.texts.resumeMessage(portfolio.name));
  }

  /**
   * Cancels pending automatic entries and exits and drops the strategies' pending decisions.
   * Returns the failures (also logged) instead of throwing.
   */
  private async stopAutomaticOrders(portfolioIds: string[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of portfolioIds) {
      try {
        await (await this.brokers.forPortfolio(id)).cancelAutomatic(id);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        failures.push(`cancel ${id}: ${text}`);
        this.logger.error({
          msg: 'Cancelling automatic orders failed',
          portfolioId: id,
          err: error,
        });
      }
    }
    return failures;
  }

  private async closeAll(portfolioIds: string[]): Promise<string[]> {
    const failures: string[] = [];
    const open = await this.positions.findBy({ portfolioId: In(portfolioIds) });
    for (const p of open) {
      try {
        const broker = await this.brokers.forPortfolio(p.portfolioId);
        await broker.placeOrder(p.portfolioId, {
          assetId: p.assetId,
          side: 'SELL',
          type: 'market',
        });
      } catch (error) {
        failures.push(`close ${p.id}: ${error instanceof Error ? error.message : String(error)}`);
        this.logger.error({
          msg: 'Closing a position on halt failed',
          positionId: p.id,
          err: error,
        });
      }
    }
    return failures;
  }
}
