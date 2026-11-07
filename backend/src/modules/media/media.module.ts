import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { RecapsService } from './recaps.service';

@Module({ controllers: [MediaController], providers: [RecapsService], exports: [RecapsService] })
export class MediaModule {}
