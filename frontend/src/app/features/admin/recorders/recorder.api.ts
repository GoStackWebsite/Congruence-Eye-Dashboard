import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, concat, defer, exhaustMap, forkJoin, interval, map, of, takeUntil, takeWhile, timer } from 'rxjs';
import { Camera, CameraType, DiscoveredDevice, Probe, Recorder, RecorderBrandInfo, RecorderInput } from '../../../core/models/api.models';
import { ApiService, silent } from '../../../core/services/api.service';
import { PROBE_CAP_MS, PROBE_POLL_MS, isTerminal } from './recorder.helpers';

/**
 * Client for docs/API_CONTRACT_V3_RECORDERS.md (recorders, connection probes, LAN discovery). Every call is
 * "silent" (no global error toast): screens show their own inline errors, and a 404 from these routes means the
 * backend does not have recorder support yet.
 */
@Injectable({ providedIn: 'root' })
export class RecorderApi {
  private readonly api = inject(ApiService);

  brands(): Observable<RecorderBrandInfo[]> {
    return this.api.get<RecorderBrandInfo[]>('/recorders/brands', null, silent());
  }
  list(storeId: number): Observable<Recorder[]> {
    return this.api.get<Recorder[]>('/recorders', { storeId }, silent());
  }
  get(id: number): Observable<Recorder> {
    return this.api.get<Recorder>(`/recorders/${id}`, null, silent());
  }
  create(body: RecorderInput): Observable<Recorder> {
    return this.api.post<Recorder>('/recorders', body, null, silent());
  }
  update(id: number, body: Partial<RecorderInput>): Observable<Recorder> {
    return this.api.patch<Recorder>(`/recorders/${id}`, body, silent());
  }
  remove(id: number, unlinkCameras = false): Observable<unknown> {
    return this.api.delete(`/recorders/${id}${unlinkCameras ? '?unlinkCameras=true' : ''}`, silent());
  }
  generateCameras(id: number, body: { channels: number[]; type?: CameraType; namePrefix?: string }): Observable<Camera[]> {
    return this.api.post<Camera[]>(`/recorders/${id}/generate-cameras`, body, null, silent());
  }
  test(id: number, channels?: number[]): Observable<Probe[]> {
    return this.api.post<Probe[]>(`/recorders/${id}/test`, channels?.length ? { channels } : {}, null, silent());
  }
  testCamera(cameraId: number): Observable<Probe> {
    return this.api.post<Probe>(`/cameras/${cameraId}/test`, {}, null, silent());
  }
  probe(id: number): Observable<Probe> {
    return this.api.get<Probe>(`/probes/${id}`, null, silent());
  }
  probes(q: { storeId?: number; recorderId?: number; cameraId?: number }): Observable<Probe[]> {
    return this.api.get<Probe[]>('/probes', q, silent());
  }
  discovered(storeId: number): Observable<DiscoveredDevice[]> {
    return this.api.get<DiscoveredDevice[]>('/recorders/discovered', { storeId }, silent());
  }

  /**
   * Live probe polling: GET /api/probes/:id every second for the probes still PENDING/RUNNING, until all are
   * terminal or 60 s have passed (the open ones are then reported EXPIRED). Emits the whole list on every change.
   */
  watch(initial: Probe[]): Observable<Probe[]> {
    let current = initial;
    const open = () => current.filter((p) => !isTerminal(p.status));
    if (!open().length) return of(current);
    const poll = interval(PROBE_POLL_MS).pipe(
      exhaustMap(() => forkJoin(open().map((p) => this.probe(p.id).pipe(catchError(() => of(p)))))),
      map((fresh) => {
        const byId = new Map(fresh.map((f) => [f.id, f]));
        current = current.map((p) => byId.get(p.id) ?? p);
        return current;
      }),
      takeWhile(() => open().length > 0, true),
      takeUntil(timer(PROBE_CAP_MS)),
    );
    const expire = defer(() => {
      if (!open().length) return EMPTY;
      current = current.map((p) => (isTerminal(p.status) ? p : { ...p, status: 'EXPIRED' as const, completedAt: new Date().toISOString() }));
      return of(current);
    });
    return concat(of(current), poll, expire);
  }
}
