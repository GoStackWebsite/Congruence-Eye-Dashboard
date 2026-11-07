import { BadRequestException } from '@nestjs/common';
import { parseBool, parseIds, parseIntOpt } from '../../common/paging';
import { addDays, daysInclusive, DEFAULT_TZ, isDateStr, todayLocal } from '../../common/time.util';

export interface Range {
  from: string;
  to: string;
}
export interface AnalyticsParams extends Range {
  storeIds?: number[];
  compare: boolean;
  storeId?: number;
  cameraId?: number;
}

export function parseAnalytics(q: Record<string, unknown>, tz = DEFAULT_TZ): AnalyticsParams {
  const to = q.to === undefined || q.to === '' ? todayLocal(tz) : String(q.to);
  if (!isDateStr(to)) throw new BadRequestException('to must be YYYY-MM-DD');
  const from = q.from === undefined || q.from === '' ? addDays(to, -6) : String(q.from);
  if (!isDateStr(from)) throw new BadRequestException('from must be YYYY-MM-DD');
  if (from > to) throw new BadRequestException('from must be <= to');
  if (daysInclusive(from, to) > 800) throw new BadRequestException('range too large (max 800 days)');
  const storeId = parseIntOpt(q.storeId);
  const storeIds = parseIds(q.storeIds) ?? (storeId ? [storeId] : undefined);
  return { from, to, storeIds, compare: parseBool(q.compare), storeId, cameraId: parseIntOpt(q.cameraId) };
}

/** Same-length period immediately before `from`. */
export function previousRange(r: Range): Range {
  const n = daysInclusive(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}
