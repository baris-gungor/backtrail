import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { SignalEntity } from '../../analysis/infrastructure/signal.entity';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { OrderSide, OrderSource, OrderStatus, OrderType } from '../domain/order';
import { PortfolioSubscriptionEntity } from './portfolio-subscription.entity';
import { PortfolioEntity } from './portfolio.entity';

const price = {
  type: 'numeric',
  precision: 18,
  scale: 6,
  nullable: true,
  transformer: numericToNumber,
} as const;

@Entity('orders')
@Unique(['portfolioId', 'signalId'])
@Index(['portfolioId', 'status'])
export class OrderEntity extends BaseEntity {
  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'varchar', length: 4 })
  side: OrderSide;

  @Column({ type: 'varchar', length: 8 })
  type: OrderType;

  /** Decimal string. Null for an automatic entry until it is sized at the fill. */
  @Column({ type: 'numeric', nullable: true })
  quantity: string | null;

  /** Manual BUY by amount instead of quantity, decimal string. */
  @Column({ type: 'numeric', nullable: true })
  notional: string | null;

  @Column(price)
  limitPrice: number | null;

  /** Protective levels for the position an entry opens. */
  @Column(price)
  stopLoss: number | null;

  @Column(price)
  takeProfit: number | null;

  @Column({ type: 'varchar', length: 16 })
  status: OrderStatus;

  @Column({ type: 'varchar', length: 16 })
  source: OrderSource;

  /** Open time of the 4h bar whose close produced an automatic order. */
  @Column({ type: 'timestamptz', nullable: true })
  barTime: Date | null;

  @Column({ type: 'uuid', nullable: true })
  signalId: string | null;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  /** Phase 6. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  brokerOrderId: string | null;

  /** Idempotency key. */
  @Column({ type: 'varchar', length: 128, unique: true })
  clientOrderId: string;

  /** Bar open time (or wall time for manual market orders) of the fill. */
  @Column({ type: 'timestamptz', nullable: true })
  filledAt: Date | null;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;

  @ManyToOne(() => SignalEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'signal_id' })
  signal?: SignalEntity;

  @ManyToOne(() => PortfolioSubscriptionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: PortfolioSubscriptionEntity;
}
