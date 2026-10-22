import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { ExitReason, PositionSide } from '../domain/execution';
import { PortfolioEntity } from './portfolio.entity';

/** A paper round trip, same shape as `backtest_trades`. */
@Entity('closed_trades')
@Index(['portfolioId', 'exitTime'])
export class ClosedTradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  strategyConfigId: string | null;

  @Column({ type: 'timestamptz' })
  entryTime: Date;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  entryPrice: number;

  @Column({ type: 'timestamptz' })
  exitTime: Date;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  exitPrice: number;

  @Column({ type: 'numeric' })
  quantity: string;

  @Column({ type: 'numeric' })
  fees: string;

  /** Net of fees. */
  @Column({ type: 'numeric' })
  pnl: string;

  @Column({ type: 'numeric', precision: 10, scale: 6, transformer: numericToNumber })
  returnPct: number;

  @Column({ type: 'varchar', length: 5, default: 'long' })
  side: PositionSide;

  @Column({ type: 'varchar', length: 16 })
  exitReason: ExitReason;

  /** 4h bars held; null for trades opened or closed manually. */
  @Column({ type: 'int', nullable: true })
  barsHeld: number | null;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;
}
