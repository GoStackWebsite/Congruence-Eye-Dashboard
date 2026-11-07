import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { CheckOutDto, CreateVendorDto, CreateVendorVisitDto, UpdateVendorDto, UpdateVendorVisitDto } from './dto/vendor.dto';
import { VendorsService } from './vendors.service';

@ApiTags('vendors')
@ApiBearerAuth()
@Controller()
export class VendorsController {
  constructor(private readonly svc: VendorsService) {}
  @Get('vendors') list() {
    return this.svc.list();
  }
  @Post('vendors') @Roles(...MANAGER_PLUS) create(@Body() dto: CreateVendorDto) {
    return this.svc.create(dto);
  }
  @Patch('vendors/:id') @Roles(...MANAGER_PLUS) update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateVendorDto) {
    return this.svc.update(id, dto);
  }
  @Delete('vendors/:id') @Roles(...MANAGER_PLUS) remove(@Param('id', ParseIdPipe) id: number) {
    return this.svc.remove(id);
  }

  @Get('vendor-visits') visits(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.svc.listVisits(u, q);
  }
  @Post('vendor-visits') @Roles(...MANAGER_PLUS) createVisit(@CurrentUser() u: AuthUser, @Body() dto: CreateVendorVisitDto) {
    return this.svc.createVisit(u, dto);
  }
  @Patch('vendor-visits/:id/check-in') @Roles(...MANAGER_PLUS) checkIn(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.svc.checkIn(u, id);
  }
  @Patch('vendor-visits/:id/check-out') @Roles(...MANAGER_PLUS) checkOut(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: CheckOutDto) {
    return this.svc.checkOut(u, id, dto);
  }
  @Patch('vendor-visits/:id') @Roles(...MANAGER_PLUS) updateVisit(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateVendorVisitDto) {
    return this.svc.updateVisit(u, id, dto);
  }
}
