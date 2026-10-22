import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ReconciliationDiff } from '../domain/demo-broker';
import { PortfolioEntity } from './portfolio.entity';

export type ReconciliationStatus = 'ok' | 'diff' | 'error';

/** One comparison of broker positions and cash with the database. */
@Entity('reconciliation_runs')
@Index(['portfolioId', 'createdAt'])
export class ReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'varchar', length: 8 })
  status: ReconciliationStatus;

  @Column({ type: 'jsonb' })
  diffs: ReconciliationDiff[];

  /** Broker cash and equity at the time, decimal strings. */
  @Column({ type: 'numeric', nullable: true })
  brokerCash: string | null;

  @Column({ type: 'numeric', nullable: true })
  brokerEquity: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;
}
