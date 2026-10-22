import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from '../application/audit.service';
import { AuditEventDto, AuditQueryDto } from './audit.dto';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Audit trail, newest first. */
  @Get()
  list(@Query() q: AuditQueryDto): Promise<AuditEventDto[]> {
    return this.audit.list(q);
  }
}
