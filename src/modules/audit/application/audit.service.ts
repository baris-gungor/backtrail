import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AuditEventEntity, type AuditActor } from '../infrastructure/audit-event.entity';

export interface AuditRecord {
  actor?: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: object | null;
  after?: object | null;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  limit: number;
}

/** JSON-safe copy: drops functions and undefined, turns Dates and Decimals into strings. */
const snapshot = (value: object | null | undefined): Record<string, unknown> | null =>
  value ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : null;

/**
 * Audit trail of user and system changes. A failed audit write is logged and does
 * not undo the change it describes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEventEntity) private readonly events: Repository<AuditEventEntity>,
  ) {}

  async record(entry: AuditRecord): Promise<void> {
    try {
      // save, not insert: TypeORM's insert typing rejects jsonb Record columns.
      await this.events.save(
        this.events.create({
          actor: entry.actor ?? 'user',
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: snapshot(entry.before),
          after: snapshot(entry.after),
        }),
      );
    } catch (error) {
      this.logger.error({ msg: 'Audit write failed', action: entry.action, err: error });
    }
  }

  list(q: AuditQuery): Promise<AuditEventEntity[]> {
    const where: FindOptionsWhere<AuditEventEntity> = {};
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    return this.events.find({ where, order: { createdAt: 'DESC' }, take: q.limit });
  }
}
