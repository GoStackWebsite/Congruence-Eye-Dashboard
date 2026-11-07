import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { bulkInsert, chunks } from '../../common/bulk';
import { parseCsv } from '../../common/csv';
import { toIso } from '../../common/db-types';
import { Paged, parseIds, parsePaging } from '../../common/paging';
import { AuthUser, EdgeContext } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { isDateStr, localParts, todayLocal, addDays, zonedToUtc } from '../../common/time.util';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { AggregationService } from '../pipeline/aggregation.service';
import { addAffected, AffectedHours } from '../pipeline/visit-builder.service';
import { Store } from '../stores/entities/store.entity';
import { PosTransactionDto } from './dto/pos.dto';
import { PosTransaction } from './entities/pos-transaction.entity';

export interface PosCaller {
  user?: AuthUser;
  edge?: EdgeContext;
}

@Injectable()
export class PosService {
  private readonly log = new Logger(PosService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly aggregation: AggregationService,
    private readonly alerts: AlertEngineService,
  ) {}

  private allowed(caller: PosCaller, storeId: number) {
    if (caller.edge) return caller.edge.storeId === storeId;
    return !!caller.user && this.scope.canAccess(caller.user, storeId);
  }

  async ingest(caller: PosCaller, txs: PosTransactionDto[], source = 'API', opts: { evaluate?: boolean } = {}) {
    const stores = new Map((await this.ds.getRepository(Store).find()).map((s) => [s.id, s]));
    for (const t of txs) {
      if (!stores.has(t.storeId)) throw new BadRequestException(`Unknown storeId ${t.storeId}`);
      if (!this.allowed(caller, t.storeId)) throw new ForbiddenException(`Store ${t.storeId} is outside your scope`);
    }
    return this.insert(txs, stores, source, opts);
  }

  private async insert(txs: PosTransactionDto[], stores: Map<number, Store>, source: string, opts: { evaluate?: boolean } = {}) {
    const repo = this.ds.getRepository(PosTransaction);
    const byStore = new Map<number, PosTransactionDto[]>();
    for (const t of txs) {
      if (!byStore.has(t.storeId)) byStore.set(t.storeId, []);
      byStore.get(t.storeId).push(t);
    }
    let accepted = 0;
    let duplicates = 0;
    for (const [storeId, list] of byStore) {
      const store = stores.get(storeId);
      const existing = new Set<string>();
      for (const bills of chunks([...new Set(list.map((t) => t.billNo))], 800)) {
        const rows = await repo.find({ select: { billNo: true }, where: { storeId, billNo: In(bills) } });
        rows.forEach((r) => existing.add(r.billNo));
      }
      const rows: Partial<PosTransaction>[] = [];
      const affected: AffectedHours = new Map();
      for (const t of list) {
        if (existing.has(t.billNo)) {
          duplicates++;
          continue;
        }
        existing.add(t.billNo);
        const ts = new Date(t.ts);
        if (isNaN(ts.getTime())) throw new BadRequestException(`Invalid ts for bill ${t.billNo}`);
        const p = localParts(ts, store.timezone);
        rows.push({ storeId, billNo: t.billNo, ts, date: p.date, hour: p.hour, amount: Math.round(t.amount * 100) / 100, itemsCount: t.itemsCount, staffCode: t.staffCode ?? null, source });
        addAffected(affected, p.date, p.hour);
      }
      if (rows.length) {
        await this.aggregation.lock.run(this.aggregation.lockKey(storeId), async () => {
          await bulkInsert(this.ds.manager, PosTransaction, rows);
          await this.aggregation.recomputeAffected(storeId, affected);
        });
        accepted += rows.length;
        if (opts.evaluate !== false) await this.alerts.evaluate([storeId]).catch((e: Error) => this.log.warn(e.message));
      }
    }
    return { accepted, duplicates };
  }

  async importCsv(user: AuthUser, buffer?: Buffer) {
    if (!buffer?.length) throw new BadRequestException('file is required');
    const rows = parseCsv(buffer.toString('utf8'));
    if (!rows.length) throw new BadRequestException('empty file');
    const header = rows[0].map((h) => h.trim());
    const need = ['storeCode', 'billNo', 'ts', 'amount', 'itemsCount'];
    const missing = need.filter((n) => !header.includes(n));
    if (missing.length) throw new BadRequestException(`missing columns: ${missing.join(', ')}`);
    const idx = (n: string) => header.indexOf(n);
    const stores = await this.ds.getRepository(Store).find();
    const byCode = new Map(stores.map((s) => [s.code.toUpperCase(), s]));
    const storeMap = new Map(stores.map((s) => [s.id, s]));
    const errors: string[] = [];
    const txs: PosTransactionDto[] = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const code = (r[idx('storeCode')] ?? '').trim().toUpperCase();
      const store = byCode.get(code);
      const billNo = (r[idx('billNo')] ?? '').trim();
      const ts = (r[idx('ts')] ?? '').trim();
      const amount = Number((r[idx('amount')] ?? '').trim());
      const items = Number((r[idx('itemsCount')] ?? '').trim());
      const staffCode = idx('staffCode') >= 0 ? (r[idx('staffCode')] ?? '').trim() : '';
      if (!store) return errors.push(`line ${line}: unknown storeCode '${code}'`);
      if (!this.scope.canAccess(user, store.id)) return errors.push(`line ${line}: store '${code}' outside your scope`);
      if (!billNo) return errors.push(`line ${line}: billNo is required`);
      if (!ts || isNaN(new Date(ts).getTime())) return errors.push(`line ${line}: invalid ts '${ts}'`);
      if (!isFinite(amount) || amount < 0) return errors.push(`line ${line}: invalid amount`);
      if (!Number.isInteger(items) || items < 0) return errors.push(`line ${line}: invalid itemsCount`);
      // timestamps without offset are interpreted as store-local time
      const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(ts);
      const iso = hasZone ? new Date(ts).toISOString() : zonedToUtc(ts.slice(0, 10), ts.slice(11, 19) || '00:00', store.timezone).toISOString();
      txs.push({ storeId: store.id, billNo, ts: iso, amount, itemsCount: items, staffCode: staffCode || undefined });
    });
    const res = await this.insert(txs, storeMap, 'CSV');
    return { ...res, errors };
  }

  async list(user: AuthUser, q: Record<string, unknown>): Promise<Paged<unknown>> {
    const { page, pageSize, skip, take } = parsePaging(q);
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return { items: [], total: 0, page, pageSize };
    const to = isDateStr(q.to) ? q.to : todayLocal();
    const from = isDateStr(q.from) ? q.from : addDays(to, -6);
    const qb = this.ds
      .getRepository(PosTransaction)
      .createQueryBuilder('p')
      .where('p.storeId IN (:...ids)', { ids })
      .andWhere('p.date >= :from AND p.date <= :to', { from, to })
      .orderBy('p.ts', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .skip(skip)
      .take(take);
    const [rows, total] = await qb.getManyAndCount();
    const names = new Map((await this.ds.getRepository(Store).find({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        storeName: names.get(r.storeId) ?? '',
        billNo: r.billNo,
        ts: toIso(r.ts),
        amount: r.amount,
        itemsCount: r.itemsCount,
        staffCode: r.staffCode ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }
}
