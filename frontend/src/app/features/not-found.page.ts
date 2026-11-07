import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { EmptyStateComponent } from '../shared/ui/ui.components';

@Component({
  selector: 'ce-not-found',
  imports: [EmptyStateComponent, MatButtonModule, RouterLink],
  template: `
    <section class="page" data-testid="page-not-found">
      <ce-empty-state icon="explore_off" title="Page not found" message="The page you are looking for does not exist or you do not have access.">
        <a mat-flat-button [routerLink]="home" data-testid="btn-home">Go home</a>
      </ce-empty-state>
    </section>
  `,
})
export class NotFoundPage {
  readonly home = inject(AuthService).homeRoute();
}
