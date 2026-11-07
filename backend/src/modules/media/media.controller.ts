import { ParseIdPipe } from '../../common/parse-id.pipe';
import { IsDateOnly } from '../../common/validators';
import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Matches } from 'class-validator';
import { DataSource, In } from 'typeorm';
import { CurrentUser, Roles } from '../../common/decorators';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { Paged, parseIds, parseIntOpt, parsePaging } from '../../common/paging';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { isDateStr } from '../../common/time.util';
import { Camera } from '../cameras/entities/camera.entity';
import { Snapshot } from './entities/snapshot.entity';
import { RecapsService } from './recaps.service';
import { snapshotUrl } from './snapshots.service';

export class GenerateRecapDto {
  @IsInt() storeId: number;
  @IsDateOnly() date: string;
}

@ApiTags('media')
@ApiBearerAuth()
@Controller()
export class MediaController {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
    private readonly recaps: RecapsService,
  ) {}

  @Get('image-directory')
  async images(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>): Promise<Paged<unknown>> {
    const { page, pageSize, skip, take } = parsePaging(q);
    const ids = await this.scope.resolve(u, parseIds(q.storeIds), false);
    if (!ids.length) return { items: [], total: 0, page, pageSize };
    const qb = this.ds.getRepository(Snapshot).createQueryBuilder('s').where('s.storeId IN (:...ids)', { ids });
    const cam = parseIntOpt(q.cameraId);
    if (cam) qb.andWhere('s.cameraId = :cam', { cam });
    if (q.kind) qb.andWhere('s.kind IN (:...kinds)', { kinds: String(q.kind).split(',') });
    if (isDateStr(q.from)) qb.andWhere('s.date >= :from', { from: q.from });
    if (isDateStr(q.to)) qb.andWhere('s.date <= :to', { to: q.to });
    qb.orderBy('s.ts', 'DESC').addOrderBy('s.id', 'DESC').skip(skip).take(take);
    const [rows, total] = await qb.getManyAndCount();
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const camIds = [...new Set(rows.map((r) => r.cameraId))];
    const cams = new Map((camIds.length ? await this.ds.getRepository(Camera).find({ where: { id: In(camIds) } }) : []).map((c) => [c.id, c.name]));
    return {
      items: rows.map((s) => ({ id: s.id, storeId: s.storeId, storeName: stores.get(s.storeId) ?? '', cameraId: s.cameraId, cameraName: cams.get(s.cameraId) ?? '', ts: toIso(s.ts), kind: s.kind, url: snapshotUrl(s) })),
      total,
      page,
      pageSize,
    };
  }

  @Get('recaps')
  async list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.recaps.list(await this.scope.resolve(u, parseIds(q.storeIds), false), q);
  }

  @Post('recaps/generate')
  @Roles(...MANAGER_PLUS)
  async generate(@CurrentUser() u: AuthUser, @Body() dto: GenerateRecapDto) {
    if (!isDateStr(dto.date)) throw new NotFoundException('Invalid date');
    await this.scope.assertStore(u, dto.storeId);
    return (await this.recaps.views([await this.recaps.generate(dto.storeId, dto.date)]))[0];
  }

  @Get('recaps/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    const r = await this.recaps.get(id);
    this.scope.assert(u, r.storeId);
    return (await this.recaps.views([r]))[0];
  }
}
