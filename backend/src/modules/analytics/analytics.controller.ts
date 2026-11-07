import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { Camera } from '../cameras/entities/camera.entity';
import { AnalyticsParams, parseAnalytics } from './analytics.query';
import { AnalyticsService } from './analytics.service';

type Q = Record<string, unknown>;

@ApiTags('analytics')
@ApiBearerAuth()
@ApiQuery({ name: 'storeIds', required: false, example: '1,2' })
@ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
@ApiQuery({ name: 'to', required: false, example: '2026-09-30' })
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly scope: StoreScopeService,
    private readonly ds: DataSource,
  ) {}

  private async multi(user: AuthUser, q: Q): Promise<{ p: AnalyticsParams; ids: number[] }> {
    const p = parseAnalytics(q);
    return { p, ids: await this.scope.resolve(user, p.storeIds) };
  }

  /** Single-store endpoints: explicit storeId must be in scope (403), otherwise the first store in scope. */
  private async single(user: AuthUser, q: Q): Promise<{ p: AnalyticsParams; storeId: number }> {
    const p = parseAnalytics(q);
    let storeId = p.storeId ?? (p.storeIds?.length === 1 ? p.storeIds[0] : undefined);
    if (storeId) this.scope.assert(user, storeId);
    else {
      storeId = (await this.scope.resolve(user))[0];
      if (!storeId) throw new NotFoundException('No store in scope');
    }
    return { p, storeId };
  }

  @Get('overview') @ApiQuery({ name: 'compare', required: false }) async overview(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.overview(ids, p, p.compare);
  }
  @Get('traffic') async traffic(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.traffic(ids, p);
  }
  @Get('demographics') async demographics(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.demographics(ids, p);
  }
  @Get('zones') async zones(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.zones(ids, p);
  }
  @Get('heatmap') async heatmap(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const p = parseAnalytics(q);
    if (p.cameraId) {
      const cam = await this.ds.getRepository(Camera).findOne({ where: { id: p.cameraId } });
      if (!cam) throw new NotFoundException('Camera not found');
      this.scope.assert(u, cam.storeId);
      if (p.storeId && p.storeId !== cam.storeId) throw new BadRequestException('cameraId does not belong to storeId');
      return this.analytics.heatmap(cam.storeId, cam.id, p);
    }
    const { storeId } = await this.single(u, q);
    return this.analytics.heatmap(storeId, undefined, p);
  }
  /** storeId (single, 403 outside scope) or storeIds (several stores, zones merged by name). */
  @Get('journey') async journey(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const p = parseAnalytics(q);
    if (!p.storeId && p.storeIds && p.storeIds.length > 1) return this.analytics.journey(await this.scope.resolve(u, p.storeIds), p);
    const { storeId } = await this.single(u, q);
    return this.analytics.journey(storeId, p);
  }
  @Get('traffic-density') async density(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.trafficDensity(ids, p);
  }
  @Get('benchmark/groups') @ApiQuery({ name: 'groupBy', enum: ['region', 'format', 'city'] }) async groups(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const groupBy = String(q.groupBy ?? 'region');
    if (!['region', 'format', 'city'].includes(groupBy)) throw new BadRequestException('groupBy must be region, format or city');
    const { p, ids } = await this.multi(u, q);
    return this.analytics.benchmarkGroups(ids, p, groupBy);
  }
  @Get('conversion') async conversion(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.conversion(ids, p);
  }
  @Get('queue') async queue(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.queue(ids, p);
  }
  @Get('storeops') async storeops(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.storeops(ids, p);
  }
  @Get('benchmark') async benchmark(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { p, ids } = await this.multi(u, q);
    return this.analytics.benchmark(ids, p);
  }
  @Get('live') async live(@CurrentUser() u: AuthUser, @Query() q: Q) {
    const { storeId } = await this.single(u, q);
    return this.analytics.live(storeId);
  }
}
