import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AiManagerRule,
  AiManagerRuleInput,
  AiManagerSummary,
  AiResult,
  AnalyticsQuery,
  AnswerTaskRequest,
  AssignmentStatus,
  BenchmarkGroup,
  BenchmarkGroupBy,
  BulkTaskRequest,
  ChecklistSchedule,
  ChecklistScheduleInput,
  Detection,
  InfraHealth,
  OpenCloseRow,
  Paged,
  Recap,
  SnapshotImage,
  Task,
  TrafficDensity,
  TraxDashboard,
  AnswerInput,
  Assignment,
} from '../models/api.models';
import { QueryObject } from '../utils/query-params';
import { ApiService, silent } from './api.service';

const range = (p: AnalyticsQuery): QueryObject => ({ storeIds: p.storeIds, from: p.from, to: p.to });

export interface ImageDirectoryQuery extends AnalyticsQuery {
  cameraId?: number | null;
  kind?: string | null;
  page: number;
  pageSize: number;
}

export interface DetectionQuery extends AnalyticsQuery {
  type?: string | null;
  status?: string | null;
  ruleId?: number | null;
  page: number;
  pageSize: number;
}

/** Endpoints added by docs/API_CONTRACT_V2.md. */
@Injectable({ providedIn: 'root' })
export class V2Api {
  private readonly api = inject(ApiService);

  // traffic
  trafficDensity(p: AnalyticsQuery): Observable<TrafficDensity> {
    return this.api.get('/analytics/traffic-density', range(p));
  }
  benchmarkGroups(groupBy: BenchmarkGroupBy, p: AnalyticsQuery): Observable<BenchmarkGroup[]> {
    return this.api.get('/analytics/benchmark/groups', { ...range(p), groupBy });
  }
  imageDirectory(q: ImageDirectoryQuery): Observable<Paged<SnapshotImage>> {
    return this.api.get('/image-directory', { ...range(q), cameraId: q.cameraId, kind: q.kind, page: q.page, pageSize: q.pageSize });
  }
  recaps(p: AnalyticsQuery): Observable<Recap[]> {
    return this.api.get('/recaps', range(p));
  }
  generateRecap(storeId: number, date: string): Observable<Recap> {
    return this.api.post('/recaps/generate', { storeId, date });
  }
  infraHealth(storeIds?: number[]): Observable<InfraHealth> {
    return this.api.get('/infra/health', { storeIds });
  }

  // trax
  schedules(): Observable<ChecklistSchedule[]> {
    return this.api.get('/checklists/schedules');
  }
  saveSchedule(body: ChecklistScheduleInput, id?: number): Observable<ChecklistSchedule> {
    // callers show the server's validation message in the form (silent: no duplicate toast)
    return id ? this.api.patch(`/checklists/schedules/${id}`, body, silent()) : this.api.post('/checklists/schedules', body, null, silent());
  }
  deleteSchedule(id: number): Observable<unknown> {
    return this.api.delete(`/checklists/schedules/${id}`);
  }
  generateSchedule(id: number): Observable<{ created: number }> {
    return this.api.post(`/checklists/schedules/${id}/generate`);
  }
  saveDraft(assignmentId: number, answers: AnswerInput[]): Observable<Assignment | { ok: boolean; status?: AssignmentStatus }> {
    return this.api.post(`/checklists/assignments/${assignmentId}/draft`, { answers });
  }
  traxDashboard(p: AnalyticsQuery): Observable<TraxDashboard> {
    return this.api.get('/checklists/dashboard', range(p));
  }
  taskFromAnswer(answerId: number, body: AnswerTaskRequest): Observable<Task> {
    return this.api.post(`/checklists/answers/${answerId}/task`, body, null, silent());
  }
  bulkTasks(body: BulkTaskRequest): Observable<Task[]> {
    return this.api.post('/tasks/bulk', body, null, silent());
  }
  aiCheck(file: Blob, type: 'REFERENCE_MATCH' | 'UNIFORM', referenceUrl?: string | null): Observable<AiResult> {
    const fd = new FormData();
    fd.append('image', file, (file as File).name ?? 'photo.jpg');
    fd.append('type', type);
    if (referenceUrl) fd.append('referenceUrl', referenceUrl);
    // silent: an unavailable ai-service is shown inline as status ERROR, not as an error snackbar
    return this.api.post('/checklists/ai-check', fd, null, silent());
  }
  runNudges(): Observable<{ reminders: number; overdue: number }> {
    return this.api.post('/checklists/nudges/run');
  }

  // AI manager
  aiRules(): Observable<AiManagerRule[]> {
    return this.api.get('/ai-manager/rules');
  }
  saveAiRule(body: AiManagerRuleInput, id?: number): Observable<AiManagerRule> {
    return id ? this.api.patch(`/ai-manager/rules/${id}`, body) : this.api.post('/ai-manager/rules', body);
  }
  deleteAiRule(id: number): Observable<unknown> {
    return this.api.delete(`/ai-manager/rules/${id}`);
  }
  detections(q: DetectionQuery): Observable<Paged<Detection>> {
    return this.api.get('/ai-manager/detections', { ...range(q), type: q.type, status: q.status, ruleId: q.ruleId, page: q.page, pageSize: q.pageSize });
  }
  reviewDetection(id: number, reviewStatus: 'VALID' | 'FALSE_POSITIVE'): Observable<Detection> {
    return this.api.patch(`/ai-manager/detections/${id}/review`, { reviewStatus });
  }
  aiSummary(p: AnalyticsQuery): Observable<AiManagerSummary> {
    return this.api.get('/ai-manager/summary', range(p));
  }
  openClose(p: AnalyticsQuery): Observable<OpenCloseRow[]> {
    return this.api.get('/ai-manager/open-close', range(p));
  }
}
