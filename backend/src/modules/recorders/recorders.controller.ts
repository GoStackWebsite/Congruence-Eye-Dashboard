import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Edge, Public, Roles } from '../../common/decorators';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { parseBool } from '../../common/paging';
import { AuthUser, EdgeContext, Role } from '../../common/roles';
import { CreateRecorderDto, GenerateCamerasDto, TestChannelsDto, UpdateRecorderDto } from './dto/recorder.dto';
import { ProbesService } from './probes.service';
import { RecordersService } from './recorders.service';

/** Recorder writes and connection tests: ADMIN+, or STORE_MANAGER for their own store (scope checked in the service). */
export const RECORDER_WRITERS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.STORE_MANAGER];

@ApiTags('recorders')
@ApiBearerAuth()
@Controller('recorders')
export class RecordersController {
  constructor(
    private readonly recorders: RecordersService,
    private readonly probes: ProbesService,
  ) {}

  @Get('brands') brands() {
    return this.recorders.brands();
  }
  @Get('discovered') discovered(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.recorders.discovered(u, storeId);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.recorders.list(u, storeId);
  }
  @Post() @Roles(...RECORDER_WRITERS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateRecorderDto) {
    return this.recorders.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.recorders.get(u, id);
  }
  @Patch(':id') @Roles(...RECORDER_WRITERS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateRecorderDto) {
    return this.recorders.update(u, id, dto);
  }
  @Delete(':id') @Roles(...RECORDER_WRITERS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Query('unlinkCameras') unlink?: string) {
    return this.recorders.remove(u, id, parseBool(unlink));
  }
  @Post(':id/generate-cameras') @Roles(...RECORDER_WRITERS)
  generate(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: GenerateCamerasDto) {
    return this.recorders.generateCameras(u, id, dto);
  }
  @Post(':id/test') @Roles(...RECORDER_WRITERS)
  async test(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: TestChannelsDto) {
    return this.probes.testRecorder(u, await this.recorders.find(u, id), dto?.channels);
  }
}

@ApiTags('recorders')
@ApiBearerAuth()
@Controller()
export class ProbesController {
  constructor(private readonly probes: ProbesService) {}

  @Post('cameras/:id/test') @Roles(...RECORDER_WRITERS) testCamera(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.probes.testCamera(u, id);
  }
  @Get('probes') list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.probes.list(u, q);
  }
  @Get('probes/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.probes.get(u, id);
  }
}

/** Edge (X-Api-Key) side of connection tests and LAN discovery. */
@ApiTags('ingest')
@ApiHeader({ name: 'X-Api-Key', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@Controller('ingest')
export class RecorderIngestController {
  constructor(private readonly probes: ProbesService) {}

  @Get('probes') claim(@Edge() edge: EdgeContext) {
    return this.probes.claim(edge);
  }
  @Post('probes/:id')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  result(@Edge() edge: EdgeContext, @Param('id', ParseIdPipe) id: number, @Body() body: Record<string, unknown>, @UploadedFile() file?: Express.Multer.File) {
    return this.probes.result(edge, id, body, file);
  }
  @Post('discovered') @HttpCode(200) discovered(@Edge() edge: EdgeContext, @Body() body: unknown) {
    return this.probes.ingestDiscovered(edge, body);
  }
}
