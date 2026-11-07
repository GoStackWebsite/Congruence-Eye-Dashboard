import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AnalyticsQuery,
  BenchmarkRow,
  ComplianceRow,
  Conversion,
  Demographics,
  Heatmap,
  Journey,
  LiveData,
  Overview,
  QueueAnalytics,
  StoreOps,
  Traffic,
  ZoneAnalytics,
} from '../models/api.models';
import { QueryObject } from '../utils/query-params';
import { ApiService } from './api.service';

const q = (p: AnalyticsQuery): QueryObject => ({ storeIds: p.storeIds, from: p.from, to: p.to, compare: p.compare });

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly api = inject(ApiService);

  overview(p: AnalyticsQuery): Observable<Overview> {
    return this.api.get('/analytics/overview', q(p));
  }
  traffic(p: AnalyticsQuery): Observable<Traffic> {
    return this.api.get('/analytics/traffic', q(p));
  }
  demographics(p: AnalyticsQuery): Observable<Demographics> {
    return this.api.get('/analytics/demographics', q(p));
  }
  zones(p: AnalyticsQuery): Observable<ZoneAnalytics[]> {
    return this.api.get('/analytics/zones', q(p));
  }
  heatmap(storeId: number, cameraId: number, p: AnalyticsQuery): Observable<Heatmap> {
    return this.api.get('/analytics/heatmap', { storeId, cameraId, from: p.from, to: p.to });
  }
  journey(storeId: number, p: AnalyticsQuery): Observable<Journey> {
    return this.api.get('/analytics/journey', { storeId, from: p.from, to: p.to });
  }
  /** v2: several stores, zones merged by name. */
  journeyMulti(storeIds: number[], p: AnalyticsQuery): Observable<Journey> {
    return this.api.get('/analytics/journey', { storeIds, from: p.from, to: p.to });
  }
  conversion(p: AnalyticsQuery): Observable<Conversion> {
    return this.api.get('/analytics/conversion', q(p));
  }
  queue(p: AnalyticsQuery): Observable<QueueAnalytics> {
    return this.api.get('/analytics/queue', q(p));
  }
  storeOps(p: AnalyticsQuery): Observable<StoreOps> {
    return this.api.get('/analytics/storeops', q(p));
  }
  benchmark(p: AnalyticsQuery): Observable<BenchmarkRow[]> {
    return this.api.get('/analytics/benchmark', q(p));
  }
  live(storeId: number): Observable<LiveData> {
    return this.api.get('/analytics/live', { storeId });
  }
  compliance(p: AnalyticsQuery): Observable<ComplianceRow[]> {
    return this.api.get('/checklists/compliance', { storeIds: p.storeIds, from: p.from, to: p.to });
  }
}
