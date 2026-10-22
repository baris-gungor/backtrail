import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import { PortfolioSubscriptionEntity } from './portfolio-subscription.entity';
import { PortfolioEntity } from './portfolio.entity';

const level = {
  type: 'numeric',
  precision: 18,
  scale: 6,
  nullable: true,
  transformer: numericToNumber,
} as const;

/** An open long position. Closed positions are deleted; their round trip is a closed trade. */
@Entity('positions')
@Unique(['portfolioId', 'assetId'])
export class PositionEntity extends BaseEntity {
  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  /** The subscription that opened it; null for manual positions. */
  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'numeric' })
  quantity: string;

  /** Entry fill price, slippage included. */
  @Column({ type: 'numeric' })
  avgPrice: string;

  @Column({ type: 'numeric' })
  entryFee: string;

  @Column(level)
  stopLoss: number | null;

  @Column(level)
  takeProfit: number | null;

  @Column({ type: 'timestamptz' })
  openedAt: Date;

  /** Last 4h bar checked against the levels of a position without a subscription. */
  @Column({ type: 'timestamptz', nullable: true })
  lastBarTime: Date | null;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;

  @ManyToOne(() => PortfolioSubscriptionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id' })
  subscription?: PortfolioSubscriptionEntity;
}
