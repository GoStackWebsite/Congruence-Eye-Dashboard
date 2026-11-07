import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { EdgeDevicesService } from '../../modules/edge-devices/edge-devices.service';
import { isManagerPlus } from '../roles';
import { AuthGuard } from './auth.guard';

/** Used on POST /api/pos/transactions: X-Api-Key (edge/POS connector) or JWT with STORE_MANAGER+. */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly devices: EdgeDevicesService,
    private readonly auth: AuthGuard,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers?.['x-api-key'];
    if (key && typeof key === 'string') {
      const dev = await this.devices.authenticate(key);
      if (!dev) throw new UnauthorizedException('Invalid API key');
      req.edge = { deviceId: dev.id, storeId: dev.storeId };
      return true;
    }
    const header: string = req.headers?.authorization || '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Missing credentials');
    req.user = await this.auth.userFromToken(header.slice(7));
    if (!isManagerPlus(req.user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
