import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import type { OrderSide } from '../domain/order';
import { OrderEntity } from './order.entity';

@Entity('fills')
@Index(['portfolioId', 'executedAt'])
export class FillEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  /** Copied from the order for listing. */
  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'varchar', length: 4 })
  side: OrderSide;

  @Column({ type: 'numeric' })
  quantity: string;

  /** Slippage included. */
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  price: number;

  @Column({ type: 'numeric' })
  fee: string;

  @Column({ type: 'timestamptz' })
  executedAt: Date;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: OrderEntity;
}
