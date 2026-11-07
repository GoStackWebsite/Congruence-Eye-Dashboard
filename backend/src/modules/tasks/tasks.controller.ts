import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { BulkTaskDto, CreateTaskDto, TaskStatusDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.tasks.list(u, q);
  }
  @Post() @Roles(...MANAGER_PLUS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.tasks.get(u, id);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(u, id, dto);
  }
  @Delete(':id') @Roles(...MANAGER_PLUS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.tasks.remove(u, id);
  }
  @Patch(':id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: TaskStatusDto) {
    return this.tasks.setStatus(u, id, dto.status, { proofUrl: dto.proofUrl, remark: dto.remark });
  }
  @Post('bulk') @Roles(...MANAGER_PLUS) bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkTaskDto) {
    return this.tasks.bulk(u, dto);
  }
  @Patch(':id/verify') @Roles(...MANAGER_PLUS) verify(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.tasks.verify(u, id);
  }
}
