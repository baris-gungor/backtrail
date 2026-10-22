import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { AssetClass, SessionType } from '../domain/asset.types';

@Entity('assets')
export class AssetEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32, unique: true })
  symbol: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  assetClass: AssetClass;

  @Column({ type: 'varchar', length: 64, nullable: true })
  exchange: string | null;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 16 })
  sessionType: SessionType;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  /** The futures asset this ETF stands in for (e.g. GLD → GC=F), see `commodity-proxies.ts`. */
  @Column({ type: 'uuid', nullable: true })
  proxyForId: string | null;

  /** FK only. */
  @ManyToOne(() => AssetEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proxy_for_id' })
  proxyFor?: AssetEntity;
}
