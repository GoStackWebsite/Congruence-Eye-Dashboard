import { Controller, MessageEvent, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { filter, interval, map, merge, Observable } from 'rxjs';
import { Public } from '../../common/decorators';
import { EventBusService } from '../../common/event-bus.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Role, isAdmin } from '../../common/roles';

/** Server-Sent Events: `alert`, `notification`, `live` (+ `ping` keep-alive every 25s). JWT via ?token=. */
@ApiTags('stream')
@Controller('stream')
export class StreamController {
  constructor(
    private readonly bus: EventBusService,
    private readonly auth: AuthGuard,
  ) {}

  @Public()
  @Sse()
  async stream(@Query('token') token: string): Promise<Observable<MessageEvent>> {
    if (!token) throw new UnauthorizedException('Missing token');
    const user = await this.auth.userFromToken(token);
    const inScope = (storeId?: number) => storeId === undefined || isAdmin(user.role) || user.storeIds.includes(storeId);
    // STAFF have no access to alerts or the AI Manager: they never get `alert` events (e.g. AI Manager breaches),
    // only their own notifications (checklist reminders …) and live updates.
    const wants = (type: string) => !(type === 'alert' && user.role === Role.STAFF);
    const events$ = this.bus.events$.pipe(
      filter((e) => wants(e.type) && (e.type === 'notification' ? e.userId === user.id : inScope(e.storeId))),
      map((e): MessageEvent => ({ type: e.type, data: e.data as object })),
    );
    const ping$ = interval(25000).pipe(map((): MessageEvent => ({ type: 'ping', data: { t: new Date().toISOString() } })));
    return merge(events$, ping$);
  }
}
