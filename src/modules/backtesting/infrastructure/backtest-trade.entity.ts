import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import type { ExitReason } from '../domain/engine';
import type { PositionSide } from '../../trading/domain/execution';
import { BacktestRunEntity } from './backtest-run.entity';

/** A closed round trip. Prices are numbers; quantity, fees and PnL are decimal strings. */
@Entity('backtest_trades')
@Index(['runId'])
export class BacktestTradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  runId: string;

  @Column({ type: 'timestamptz' })
  entryTime: Date;

  /** Fill price, slippage included. */
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  entryPrice: number;

  @Column({ type: 'timestamptz' })
  exitTime: Date;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericToNumber })
  exitPrice: number;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  quantity: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  fees: string;

  /** Net of fees. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  pnl: string;

  @Column({ type: 'numeric', precision: 10, scale: 6, transformer: numericToNumber })
  returnPct: number;

  @Column({ type: 'varchar', length: 5, default: 'long' })
  side: PositionSide;

  @Column({ type: 'varchar', length: 16 })
  exitReason: ExitReason;

  @Column({ type: 'int' })
  barsHeld: number;

  @ManyToOne(() => BacktestRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: BacktestRunEntity;
}
