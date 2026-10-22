import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { Timeframe } from '../../market-data/domain/bar';
import type { SignalSide } from '../domain/strategy';
import { StrategyConfigEntity } from './strategy-config.entity';

@Entity('signals')
@Unique(['assetId', 'strategyConfigId', 'timeframe', 'barTime'])
@Index(['assetId', 'barTime'])
export class SignalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'uuid' })
  strategyConfigId: string;

  @Column({ type: 'varchar', length: 8 })
  timeframe: Timeframe;

  /** openTime of the closed bar that produced the signal. */
  @Column({ type: 'timestamptz' })
  barTime: Date;

  @Column({ type: 'varchar', length: 4 })
  side: SignalSide;

  @Column({ type: 'numeric', precision: 5, scale: 4, transformer: numericToNumber })
  strength: number;

  /** Close of the signal bar. */
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  price: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericToNumber,
  })
  stopLoss: number | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericToNumber,
  })
  takeProfit: number | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'jsonb' })
  indicators: Record<string, number>;

  /** Strategy code version that produced the signal. */
  @Column({ type: 'int' })
  strategyVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** FK only. */
  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;

  @ManyToOne(() => StrategyConfigEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategy_config_id' })
  strategyConfig?: StrategyConfigEntity;
}
