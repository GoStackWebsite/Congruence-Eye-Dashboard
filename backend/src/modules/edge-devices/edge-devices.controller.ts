import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { CreateEdgeDeviceDto } from './dto/edge-device.dto';
import { EdgeDevicesService } from './edge-devices.service';

@ApiTags('edge-devices')
@ApiBearerAuth()
@Controller('edge-devices')
export class EdgeDevicesController {
  constructor(private readonly devices: EdgeDevicesService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.devices.list(u, storeId);
  }
  @Post() @Roles(...ADMINS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateEdgeDeviceDto) {
    return this.devices.create(u, dto);
  }
  @Delete(':id') @Roles(...ADMINS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.devices.remove(u, id);
  }
  @Post(':id/rotate-key') @HttpCode(200) @Roles(...ADMINS) rotate(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.devices.rotate(u, id);
  }
}
