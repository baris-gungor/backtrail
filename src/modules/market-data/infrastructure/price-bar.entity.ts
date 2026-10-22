import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { Timeframe } from '../domain/bar';

/**
 * Composite primary key (asset_id, timeframe, open_time) doubles as the time-series index.
 */
@Entity('price_bars')
export class PriceBarEntity {
  @PrimaryColumn({ type: 'uuid' })
  assetId: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  timeframe: Timeframe;

  @PrimaryColumn({ type: 'timestamptz' })
  openTime: Date;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  open: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  high: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  low: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  close: number;

  @Column({ type: 'numeric', precision: 24, scale: 4, transformer: numericToNumber })
  volume: number;

  @Column({ type: 'boolean' })
  isComplete: boolean;

  /** FK only. Do not query assets through this relation; use AssetsService. */
  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;
}
