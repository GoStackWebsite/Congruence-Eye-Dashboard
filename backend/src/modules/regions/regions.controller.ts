import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { RegionDto } from './dto/region.dto';
import { RegionsService } from './regions.service';

@ApiTags('regions')
@ApiBearerAuth()
@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.regions.list(u);
  }
  @Post() @Roles(...ADMINS) create(@Body() dto: RegionDto) {
    return this.regions.create(dto.name);
  }
  @Patch(':id') @Roles(...ADMINS) update(@Param('id', ParseIdPipe) id: number, @Body() dto: RegionDto) {
    return this.regions.update(id, dto.name);
  }
  @Delete(':id') @Roles(...ADMINS) remove(@Param('id', ParseIdPipe) id: number) {
    return this.regions.remove(id);
  }
}
