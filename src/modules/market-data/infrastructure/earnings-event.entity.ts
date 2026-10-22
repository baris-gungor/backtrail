import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';

/** One earnings report of an equity. Upcoming reports are replaced on refresh. */
@Entity('earnings_events')
export class EarningsEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  assetId: string;

  @PrimaryColumn({ type: 'timestamptz' })
  reportedAt: Date;

  @Column({ type: 'varchar', length: 8 })
  source: 'sec' | 'yahoo';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** FK only. */
  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;
}
