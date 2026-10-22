import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import type { ExecutionModel, PositionSizing } from '../domain/execution';
import type { RiskRules } from '../domain/risk';

/**
 * `paper`: fills are simulated on stored bars (PaperBroker).
 * `alpaca_paper`: orders go to an Alpaca paper (demo) account. Live money is not supported.
 */
export type PortfolioMode = 'paper' | 'alpaca_paper';

export interface PortfolioExecution extends ExecutionModel {
  sizing: PositionSizing;
}

/**
 * A simulated or demo-broker account. Money is stored as unconstrained `numeric` and read as
 * decimal strings, so the account state round-trips exactly and paper results match backtests.
 */
@Entity('portfolios')
export class PortfolioEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 64, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'paper' })
  mode: PortfolioMode;

  @Column({ type: 'varchar', length: 8, default: 'USD' })
  baseCurrency: string;

  @Column({ type: 'numeric' })
  initialCash: string;

  @Column({ type: 'numeric' })
  cashBalance: string;

  @Column({ type: 'jsonb' })
  riskRules: RiskRules;

  @Column({ type: 'jsonb' })
  execution: PortfolioExecution;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Set when this portfolio alone is halted (e.g. a reconciliation difference). */
  @Column({ type: 'timestamptz', nullable: true })
  haltedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  haltReason: string | null;
}
