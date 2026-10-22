import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PortfolioEntity } from './portfolio.entity';

/**
 * The demo-broker account behind an `alpaca_paper` portfolio. API keys are not stored: they come
 * from the environment. One broker account backs at most one portfolio.
 */
@Entity('broker_accounts')
export class BrokerAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique through the one-to-one relation. */
  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'varchar', length: 16 })
  broker: 'alpaca';

  /** Always `paper`: live trading is not supported. */
  @Column({ type: 'varchar', length: 8, default: 'paper' })
  environment: 'paper';

  /** The broker's account id. */
  @Column({ type: 'varchar', length: 64, unique: true })
  accountRef: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** FK only. */
  @OneToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;
}
