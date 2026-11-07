import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/roles';
import { CommentDto, CreateTicketDto, TicketStatusDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.tickets.list(u, q);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateTicketDto) {
    return this.tickets.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.tickets.get(u, id);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateTicketDto) {
    return this.tickets.update(u, id, dto);
  }
  @Patch(':id/status') status(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: TicketStatusDto) {
    return this.tickets.setStatus(u, id, dto.status);
  }
  @Post(':id/comments') comment(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: CommentDto) {
    return this.tickets.comment(u, id, dto.body);
  }
}
