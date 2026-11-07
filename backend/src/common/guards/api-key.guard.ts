import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { EdgeDevicesService } from '../../modules/edge-devices/edge-devices.service';

/** Authenticates edge devices via the X-Api-Key header (sha256 lookup). Sets req.edge. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly devices: EdgeDevicesService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers?.['x-api-key'];
    if (!key || typeof key !== 'string') throw new UnauthorizedException('Missing X-Api-Key');
    const dev = await this.devices.authenticate(key);
    if (!dev) throw new UnauthorizedException('Invalid API key');
    req.edge = { deviceId: dev.id, storeId: dev.storeId };
    return true;
  }
}
