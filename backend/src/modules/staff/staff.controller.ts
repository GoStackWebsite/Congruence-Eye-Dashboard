import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('storeId') storeId?: string) {
    return this.staff.list(u, storeId);
  }
  @Post() @Roles(...MANAGER_PLUS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(u, dto);
  }
  @Patch(':id') @Roles(...MANAGER_PLUS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateStaffDto) {
    return this.staff.update(u, id, dto);
  }
  @Delete(':id') @Roles(...MANAGER_PLUS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.staff.remove(u, id);
  }
}
