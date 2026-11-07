import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { CamerasService } from './cameras.service';
import { CreateCameraDto, UpdateCameraDto } from './dto/camera.dto';

@ApiTags('cameras')
@ApiBearerAuth()
@Controller('cameras')
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.cameras.list(u, storeId);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.cameras.get(u, id);
  }
  @Get(':id/snapshot')
  async snapshot(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Res() res: Response) {
    const file = await this.cameras.snapshot(u, id);
    // contract v4: a camera that has not sent a snapshot yet is not an error → 204 No Content (the UI shows its placeholder)
    if (!file) {
      res.setHeader('Cache-Control', 'no-cache');
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file, { dotfiles: 'allow' }); // server-built path; UPLOAD_DIR may sit under a dot-directory
  }
  @Post() @Roles(...ADMINS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateCameraDto) {
    return this.cameras.create(u, dto);
  }
  @Patch(':id') @Roles(...ADMINS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateCameraDto) {
    return this.cameras.update(u, id, dto);
  }
  @Delete(':id') @Roles(...ADMINS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.cameras.remove(u, id);
  }
}
