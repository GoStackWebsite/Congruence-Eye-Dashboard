import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { parseIds } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { InfraService } from './infra.service';

@ApiTags('infra')
@ApiBearerAuth()
@Controller('infra')
export class InfraController {
  constructor(
    private readonly infra: InfraService,
    private readonly scope: StoreScopeService,
  ) {}
  @Get('health') async health(@CurrentUser() u: AuthUser, @Query('storeIds') storeIds?: string) {
    return this.infra.health(await this.scope.resolve(u, parseIds(storeIds)));
  }
}
