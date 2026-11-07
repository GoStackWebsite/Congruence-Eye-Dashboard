import { Module } from '@nestjs/common';
import { ProbesService } from './probes.service';
import { ProbesController, RecorderIngestController, RecordersController } from './recorders.controller';
import { RecordersService } from './recorders.service';

/** Contract v3: DVR / NVR recorders, connection tests (probes) and LAN discovery. */
@Module({
  controllers: [RecordersController, ProbesController, RecorderIngestController],
  providers: [RecordersService, ProbesService],
  exports: [RecordersService, ProbesService],
})
export class RecordersModule {}
