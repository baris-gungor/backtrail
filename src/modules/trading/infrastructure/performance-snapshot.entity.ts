import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { PortfolioEntity } from './portfolio.entity';

/** Mark-to-market state of a portfolio after each processing run. */
@Entity('performance_snapshots')
export class PerformanceSnapshotEntity {
  @PrimaryColumn({ type: 'uuid' })
  portfolioId: string;

  @PrimaryColumn({ type: 'timestamptz' })
  at: Date;

  @Column({ type: 'numeric' })
  equity: string;

  @Column({ type: 'numeric' })
  cash: string;

  @Column({ type: 'numeric' })
  positionsValue: string;

  /** Depth below the running equity peak, 0..1. */
  @Column({ type: 'numeric', precision: 8, scale: 6, transformer: numericToNumber })
  drawdown: number;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;
}
