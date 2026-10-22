import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';

export enum IngestionStatus {
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
}

@Entity('ingestion_runs')
@Index(['assetId', 'startedAt'])
export class IngestionRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 16 })
  status: IngestionStatus;

  @Column({ type: 'timestamptz' })
  rangeFrom: Date;

  @Column({ type: 'timestamptz' })
  rangeTo: Date;

  @Column({ type: 'int', default: 0 })
  hourlyBarsUpserted: number;

  @Column({ type: 'int', default: 0 })
  fourHourBarsUpserted: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** FK only. */
  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;
}
