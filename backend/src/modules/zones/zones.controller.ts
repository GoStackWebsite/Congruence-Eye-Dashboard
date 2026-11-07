import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
@ApiBearerAuth()
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string, @Query('cameraId') cameraId?: string) {
    return this.zones.list(u, storeId, cameraId);
  }
  @Post() @Roles(...ADMINS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateZoneDto) {
    return this.zones.create(u, dto);
  }
  @Patch(':id') @Roles(...ADMINS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateZoneDto) {
    return this.zones.update(u, id, dto);
  }
  @Delete(':id') @Roles(...ADMINS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.zones.remove(u, id);
  }
}
