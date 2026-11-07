import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Edge, Public, Roles } from '../../common/decorators';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { AuthUser, EdgeContext, MANAGER_PLUS, Role } from '../../common/roles';
import { AiManagerService } from './ai-manager.service';
import { IngestBatchInterceptor } from '../ingest/ingest-batch.interceptor';
import { AiRuleDto, IngestDetectionsDto, ReviewDetectionDto, UpdateAiRuleDto } from './dto/ai-manager.dto';

const RULE_WRITERS = [Role.SUPER_ADMIN, Role.ADMIN, Role.REGIONAL_MANAGER];
type Q = Record<string, unknown>;

@ApiTags('ai-manager')
@ApiBearerAuth()
@Controller('ai-manager')
export class AiManagerController {
  constructor(private readonly svc: AiManagerService) {}
  @Get('rules') rules(@CurrentUser() u: AuthUser) {
    return this.svc.listRules(u);
  }
  @Post('rules') @Roles(...RULE_WRITERS) create(@CurrentUser() u: AuthUser, @Body() dto: AiRuleDto) {
    return this.svc.createRule(u, dto);
  }
  @Patch('rules/:id') @Roles(...RULE_WRITERS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateAiRuleDto) {
    return this.svc.updateRule(u, id, dto);
  }
  @Delete('rules/:id') @Roles(...RULE_WRITERS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.svc.deleteRule(u, id);
  }
  @Get('detections') detections(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.detections(u, q);
  }
  @Patch('detections/:id/review') @Roles(...MANAGER_PLUS) review(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: ReviewDetectionDto) {
    return this.svc.review(u, id, dto.reviewStatus);
  }
  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.summary(u, q);
  }
  @Get('open-close') openClose(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.openClose(u, q);
  }
}

@ApiTags('ingest')
@ApiHeader({ name: 'X-Api-Key', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@UseInterceptors(IngestBatchInterceptor)
@Controller('ingest')
export class AiManagerIngestController {
  constructor(private readonly svc: AiManagerService) {}
  @Post('detections') @HttpCode(200) ingest(@Edge() edge: EdgeContext, @Body() dto: IngestDetectionsDto) {
    return this.svc.ingest(edge, dto);
  }
}
