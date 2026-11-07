import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import { parseIntOpt } from '../../common/paging';
import { ADMINS } from '../../common/roles';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @Roles(...ADMINS)
  list(@Query() q: Record<string, unknown>) {
    return this.audit.list({ userId: parseIntOpt(q.userId), entity: q.entity ? String(q.entity) : undefined, page: q.page, pageSize: q.pageSize });
  }
}
