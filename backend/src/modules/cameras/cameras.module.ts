import { Module } from '@nestjs/common';
import { CameraStatusService } from './camera-status.service';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';

@Module({ controllers: [CamerasController], providers: [CamerasService, CameraStatusService], exports: [CamerasService, CameraStatusService] })
export class CamerasModule {}
