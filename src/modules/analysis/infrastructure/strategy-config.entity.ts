import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { StrategyEntity } from './strategy.entity';

/** A named parameter set for a strategy. Signals are generated per active config. */
@Entity('strategy_configs')
@Unique(['strategyId', 'name'])
export class StrategyConfigEntity extends BaseEntity {
  @Column({ type: 'uuid' })
  strategyId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** Full validated params (defaults filled in). */
  @Column({ type: 'jsonb' })
  params: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ManyToOne(() => StrategyEntity, (strategy) => strategy.configs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategy_id' })
  strategy?: StrategyEntity;
}
