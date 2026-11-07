import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { silent } from '../../core/services/api.service';
import { environment } from '../../../environments/environment';

/**
 * Latest camera snapshot (`GET /api/cameras/:id/snapshot`). Fetched as a blob through
 * HttpClient so the bearer token is attached; falls back to a grey stage on 404.
 * Host is absolutely positioned to fill a `.media-stage`.
 */
@Component({
  selector: 'ce-snapshot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'position:absolute;inset:0;display:block' },
  template: `
    @if (url()) {
      <img class="snapshot" [src]="url()" [alt]="alt()" data-testid="camera-snapshot" />
    } @else if (neverSeen()) {
      <span class="stage-msg top" data-testid="snapshot-missing">No snapshot yet — the camera has not connected</span>
    } @else if (failed()) {
      <span class="stage-msg top" data-testid="snapshot-missing">No snapshot available</span>
    }
  `,
})
export class SnapshotComponent {
  private readonly http = inject(HttpClient);
  readonly cameraId = input.required<number | null>();
  /** Change to force a refetch. */
  readonly refresh = input(0);
  readonly alt = input('Camera snapshot');
  /** The camera never sent a heartbeat: there is no snapshot to ask for (avoids a 404 per camera). */
  readonly neverSeen = input(false);
  readonly loaded = output<boolean>();

  protected readonly url = signal<string | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    effect((onCleanup) => {
      const id = this.cameraId();
      this.refresh();
      if (!id || this.neverSeen()) {
        this.setUrl(null);
        return;
      }
      const sub = this.http
        .get(`${environment.apiBaseUrl}/cameras/${id}/snapshot`, { responseType: 'blob', context: silent(), params: { t: Date.now() } })
        .pipe(catchError(() => of(null)))
        .subscribe((blob) => {
          if (blob && blob.size > 0) {
            this.setUrl(URL.createObjectURL(blob));
            this.failed.set(false);
            this.loaded.emit(true);
          } else {
            this.setUrl(null);
            this.failed.set(true);
            this.loaded.emit(false);
          }
        });
      onCleanup(() => sub.unsubscribe());
    });
    inject(DestroyRef).onDestroy(() => this.setUrl(null));
  }

  private setUrl(u: string | null): void {
    const prev = this.url();
    if (prev) URL.revokeObjectURL(prev);
    this.url.set(u);
  }
}
