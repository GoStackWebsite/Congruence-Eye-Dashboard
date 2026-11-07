import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { AppNotification } from '../core/models/api.models';
import { NotificationService } from '../core/services/notification.service';
import { DateTimePipe } from '../shared/pipes';
import { NOTIFICATION_ICON, NotificationKind, notificationKind, resolveNotificationLink } from '../core/utils/v2-helpers';

@Component({
  selector: 'ce-notification-bell',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatBadgeModule, MatTooltipModule, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="menu"
      data-testid="notif-bell"
      [attr.aria-label]="'Notifications, ' + svc.unreadCount() + ' unread'"
      matTooltip="Notifications"
      (menuOpened)="svc.load()"
    >
      <mat-icon>notifications</mat-icon>
      @if (svc.unreadCount() > 0) {
        <span class="notif-count" data-testid="notif-count">{{ svc.unreadCount() > 99 ? '99+' : svc.unreadCount() }}</span>
      }
    </button>
    <mat-menu #menu="matMenu" class="notif-menu" xPosition="before">
      <div class="notif-head" (click)="$event.stopPropagation()">
        <strong>Notifications</strong>
        <span class="muted small">{{ svc.state() === 'sse' ? 'Live' : svc.state() === 'polling' ? 'Polling' : '' }}</span>
        <span class="spacer"></span>
        <button mat-button (click)="svc.markAllRead()" [disabled]="!svc.unreadCount()" data-testid="notif-read-all">Mark all read</button>
      </div>
      <div class="notif-list" data-testid="notif-list">
        @for (n of svc.items(); track n.id) {
          <button mat-menu-item class="notif-item" [class.unread]="!n.isRead" (click)="open(n)" [attr.data-testid]="'notif-item-' + n.id" [attr.data-kind]="kind(n)">
            <div class="notif-title"><span class="material-symbols-outlined notif-kind" aria-hidden="true">{{ icon(n) }}</span>{{ n.title }}</div>
            <div class="notif-body">{{ n.body }}</div>
            <div class="notif-time">{{ n.createdAt | dt: 'relative' }}</div>
          </button>
        } @empty {
          <div class="notif-empty" data-testid="notif-empty">You're all caught up</div>
        }
      </div>
    </mat-menu>
  `,
})
export class NotificationBellComponent {
  protected readonly svc = inject(NotificationService);
  private readonly router = inject(Router);

  kind(n: AppNotification): NotificationKind {
    return notificationKind(n);
  }
  icon(n: AppNotification): string {
    return NOTIFICATION_ICON[notificationKind(n)];
  }

  open(n: AppNotification): void {
    this.svc.markRead(n);
    const link = resolveNotificationLink(n.link);
    if (link) void this.router.navigateByUrl(link);
  }
}
