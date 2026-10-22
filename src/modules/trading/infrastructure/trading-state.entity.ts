import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** The global kill switch. A single row with id 1. */
@Entity('trading_state')
export class TradingStateEntity {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ type: 'boolean', default: false })
  halted: boolean;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  changedAt: Date;
}

export const TRADING_STATE_ID = 1;
