import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { StrategyConfigEntity } from './strategy-config.entity';

/** Catalog row for a strategy implemented in code. Synced from STRATEGIES on startup. */
@Entity('strategies')
export class StrategyEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 64, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'boolean', default: false })
  isBenchmark: boolean;

  @Column({ type: 'jsonb' })
  defaultParams: Record<string, unknown>;

  @OneToMany(() => StrategyConfigEntity, (config) => config.strategy)
  configs?: StrategyConfigEntity[];
}
