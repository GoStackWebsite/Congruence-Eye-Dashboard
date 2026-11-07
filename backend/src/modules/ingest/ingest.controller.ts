import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Get, HttpCode, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Edge, Public } from '../../common/decorators';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { EdgeContext } from '../../common/roles';
import { HeartbeatDto, HeatmapDto, IngestEventsDto, IngestQueueDto, IngestStoreOpsDto } from './dto/ingest.dto';
import { IngestBatchInterceptor } from './ingest-batch.interceptor';
import { IngestService } from './ingest.service';

@ApiTags('ingest')
@ApiHeader({ name: 'X-Api-Key', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@UseInterceptors(IngestBatchInterceptor)
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Get('config') config(@Edge() edge: EdgeContext) {
    return this.ingest.config(edge);
  }
  @Post('events') @HttpCode(200) events(@Edge() edge: EdgeContext, @Body() dto: IngestEventsDto) {
    return this.ingest.events(edge, dto);
  }
  @Post('queue') @HttpCode(200) queue(@Edge() edge: EdgeContext, @Body() dto: IngestQueueDto) {
    return this.ingest.queue(edge, dto);
  }
  @Post('heatmap') @HttpCode(200) heatmap(@Edge() edge: EdgeContext, @Body() dto: HeatmapDto) {
    return this.ingest.heatmap(edge, dto);
  }
  @Post('heartbeat') @HttpCode(200) heartbeat(@Edge() edge: EdgeContext, @Body() dto: HeartbeatDto) {
    return this.ingest.heartbeat(edge, dto);
  }
  @Post('storeops') @HttpCode(200) storeops(@Edge() edge: EdgeContext, @Body() dto: IngestStoreOpsDto) {
    return this.ingest.storeops(edge, dto);
  }
  @Post('snapshot')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  snapshot(
    @Edge() edge: EdgeContext,
    @Body('cameraId', ParseIdPipe) cameraId: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind?: string,
    @Body('ts') ts?: string,
  ) {
    return this.ingest.snapshot(edge, cameraId, file, kind, ts);
  }
}
