import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/application/audit.service';
import type { ManualOrderRequest } from '../domain/broker.port';
import { OrderEntity } from '../infrastructure/order.entity';
import { BrokerRouter } from './broker-router.service';

/** User actions on orders and subscriptions: routed to the portfolio's broker and audited. */
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    private readonly brokers: BrokerRouter,
    private readonly audit: AuditService,
  ) {}

  async place(portfolioId: string, request: ManualOrderRequest): Promise<string> {
    const broker = await this.brokers.forPortfolio(portfolioId);
    const orderId = await broker.placeOrder(portfolioId, request);
    const order = await this.orders.findOneBy({ id: orderId });
    await this.audit.record({
      action:
        request.side === 'SELL' && request.type === 'market' ? 'position.close' : 'order.place',
      entityType: 'order',
      entityId: orderId,
      after: { portfolioId, request, status: order?.status, rejectReason: order?.rejectReason },
    });
    return orderId;
  }

  async cancel(portfolioId: string, orderId: string): Promise<void> {
    const before = await this.orders.findOneBy({ id: orderId, portfolioId });
    await (await this.brokers.forPortfolio(portfolioId)).cancelOrder(portfolioId, orderId);
    await this.audit.record({
      action: 'order.cancel',
      entityType: 'order',
      entityId: orderId,
      before: before ? { status: before.status } : null,
      after: { status: 'cancelled' },
    });
  }

  async unsubscribe(portfolioId: string, subscriptionId: string): Promise<void> {
    await (
      await this.brokers.forPortfolio(portfolioId)
    ).deactivateSubscription(portfolioId, subscriptionId);
    await this.audit.record({
      action: 'subscription.deactivate',
      entityType: 'subscription',
      entityId: subscriptionId,
      before: { isActive: true },
      after: { isActive: false, portfolioId },
    });
  }
}
