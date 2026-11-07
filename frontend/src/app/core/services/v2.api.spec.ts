import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SILENT_ERRORS } from './api.service';
import { V2Api } from './v2.api';

describe('V2Api', () => {
  let api: V2Api;
  let http: HttpTestingController;
  const p = { storeIds: [1, 2], from: '2026-10-01', to: '2026-10-05' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(V2Api);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('calls traffic density with common params', () => {
    api.trafficDensity(p).subscribe();
    http.expectOne('/api/analytics/traffic-density?storeIds=1,2&from=2026-10-01&to=2026-10-05').flush({ cells: [], max: 0, hours: [] });
  });

  it('pages the image directory with optional filters', () => {
    api.imageDirectory({ ...p, cameraId: 7, kind: null, page: 2, pageSize: 24 }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/image-directory');
    expect(req.request.params.get('cameraId')).toBe('7');
    expect(req.request.params.has('kind')).toBe(false);
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, pageSize: 24 });
  });

  it('groups benchmark', () => {
    api.benchmarkGroups('format', p).subscribe();
    const req = http.expectOne((r) => r.url === '/api/analytics/benchmark/groups');
    expect(req.request.params.get('groupBy')).toBe('format');
    req.flush([]);
  });

  it('posts drafts, bulk tasks and answer tasks', () => {
    api.saveDraft(5, [{ questionId: 1, value: 'YES' }]).subscribe();
    expect(http.expectOne('/api/checklists/assignments/5/draft').request.body).toEqual({ answers: [{ questionId: 1, value: 'YES' }] });
    api.bulkTasks({ storeIds: [1, 2], title: 'Restock' }).subscribe();
    expect(http.expectOne('/api/tasks/bulk').request.body.storeIds).toEqual([1, 2]);
    api.taskFromAnswer(77, { assigneeId: 3, dueAt: '2026-10-06T10:00:00Z' }).subscribe();
    expect(http.expectOne('/api/checklists/answers/77/task').request.method).toBe('POST');
    http.match(() => true).forEach((r) => r.flush({}));
  });

  it('sends the AI check as multipart and silently', () => {
    api.aiCheck(new Blob(['x'], { type: 'image/jpeg' }), 'UNIFORM').subscribe();
    const req = http.expectOne('/api/checklists/ai-check');
    const body = req.request.body as FormData;
    expect(body.get('type')).toBe('UNIFORM');
    expect(body.get('image')).toBeTruthy();
    expect(req.request.context.get(SILENT_ERRORS)).toBe(true);
    req.flush({ status: 'PASS', score: 0.9, message: 'ok', issues: [] });
  });

  it('reviews detections and saves rules (POST vs PATCH)', () => {
    api.reviewDetection(9, 'FALSE_POSITIVE').subscribe();
    expect(http.expectOne('/api/ai-manager/detections/9/review').request.body).toEqual({ reviewStatus: 'FALSE_POSITIVE' });
    const rule = { name: 'x', type: 'STOCK_OUT' as const, storeIds: [], zoneIds: [], windowStart: '10:00', windowEnd: '21:00', daysOfWeek: [1], params: {}, severity: 'LOW' as const, notifyChannels: ['IN_APP' as const], notifyEmails: null, isActive: true };
    api.saveAiRule(rule).subscribe();
    expect(http.expectOne('/api/ai-manager/rules').request.method).toBe('POST');
    api.saveAiRule(rule, 4).subscribe();
    expect(http.expectOne('/api/ai-manager/rules/4').request.method).toBe('PATCH');
    http.match(() => true).forEach((r) => r.flush({}));
  });
});
