import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';

@ApiTags('stores')
@ApiBearerAuth()
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.stores.list(u);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.stores.get(u, id);
  }
  @Post() @Roles(...ADMINS) create(@Body() dto: CreateStoreDto) {
    return this.stores.create(dto);
  }
  @Patch(':id') @Roles(...ADMINS) update(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateStoreDto) {
    return this.stores.update(id, dto);
  }
  @Delete(':id') @Roles(...ADMINS) remove(@Param('id', ParseIdPipe) id: number) {
    return this.stores.remove(id);
  }
}
