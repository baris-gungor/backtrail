import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** `user`: an HTTP request (single user, no auth). `system`: automatic actions such as reconciliation. */
export type AuditActor = 'user' | 'system';

/** Who changed what and when, with the state before and after. */
@Entity('audit_events')
@Index(['entityType', 'entityId'])
@Index(['createdAt'])
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  actor: AuditActor;

  /** Dotted verb, e.g. `portfolio.update`, `trading.halt`. */
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 32 })
  entityType: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
