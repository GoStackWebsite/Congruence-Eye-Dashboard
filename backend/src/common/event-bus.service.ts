import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type BusEventType = 'alert' | 'notification' | 'live';
export interface BusEvent {
  type: BusEventType;
  storeId?: number;
  userId?: number;
  data: unknown;
}

/** In-process event bus (RxJS Subject) feeding the SSE stream. */
@Injectable()
export class EventBusService {
  private readonly subject = new Subject<BusEvent>();
  emit(e: BusEvent) {
    this.subject.next(e);
  }
  get events$(): Observable<BusEvent> {
    return this.subject.asObservable();
  }
}
