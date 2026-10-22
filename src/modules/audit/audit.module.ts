import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './application/audit.service';
import { AuditEventEntity } from './infrastructure/audit-event.entity';
import { AuditController } from './presentation/audit.controller';

/** Leaf module: other modules record changes through AuditService; it depends on none of them. */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
