import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  isDevMode,
} from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';
import { routes } from './app.routes';
import { authInterceptor, errorInterceptor } from './core/auth/interceptors';
import { ThemeService } from './core/services/theme.service';
import { CHART_THEME, echartsTheme } from './shared/charts/chart-theme';
import { provideServiceWorker } from '@angular/service-worker';
import { MAT_BUTTON_TOGGLE_DEFAULT_OPTIONS } from '@angular/material/button-toggle';
import { environment } from '../environments/environment';
import { DEMO_INTERCEPTORS, DEMO_PROVIDERS } from './demo/demo.providers';

/** ECharts is lazy-loaded on first chart render; our light/dark themes are registered once. */
export function loadEcharts() {
  return Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.BarChart,
      charts.LineChart,
      charts.PieChart,
      charts.FunnelChart,
      charts.SankeyChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.TitleComponent,
      components.AxisPointerComponent,
      renderers.CanvasRenderer,
    ]);
    core.registerTheme(CHART_THEME.light, echartsTheme(false));
    core.registerTheme(CHART_THEME.dark, echartsTheme(true));
    return core;
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // DS: segmented toggles without check marks
    { provide: MAT_BUTTON_TOGGLE_DEFAULT_OPTIONS, useValue: { hideSingleSelectionIndicator: true, hideMultipleSelectionIndicator: true } },
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    // DEMO_INTERCEPTORS is empty except in the `demo` build (in-browser backend, see src/app/demo)
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor, ...DEMO_INTERCEPTORS])),
    provideEchartsCore({ echarts: loadEcharts }),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { duration: 4000, horizontalPosition: 'center', verticalPosition: 'bottom' },
    },
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
      inject(ThemeService); // applies persisted theme before first paint
    }),
    provideServiceWorker('ngsw-worker.js', {
      // no service worker in the online demo (static artifact host)
      enabled: !isDevMode() && !environment.demo,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    ...DEMO_PROVIDERS,
  ],
};
