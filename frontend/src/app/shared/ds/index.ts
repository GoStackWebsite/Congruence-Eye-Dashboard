/**
 * Congruence Eye design system (docs/DESIGN_SYSTEM.md, usage in docs/STYLE_GUIDE.md).
 * Import `DS` into a standalone component to get every building block.
 */
import { ChartComponent } from '../charts/chart.component';
import { EmptyStateComponent } from '../ui/ui.components';
import { AvatarComponent } from './avatar.component';
import { CardComponent } from './card.component';
import { ChartCardComponent } from './chart-card.component';
import {
  ChipListComponent,
  DateStripComponent,
  DrawerComponent,
  FormSectionComponent,
  GradientLegendComponent,
  InfoBannerComponent,
  MetricListComponent,
  ProgressComponent,
  SegmentedComponent,
  SkeletonComponent,
  StatStripComponent,
  TabsComponent,
  ToggleRowComponent,
} from './layout.components';
import { PageComponent } from './page.component';
import { PillComponent } from './pill.component';
import { StatTileComponent } from './stat-tile.component';
import { TableCellDirective, TableComponent } from './table.component';

export * from './avatar.component';
export * from './card.component';
export * from './chart-card.component';
export * from './layout.components';
export * from './page.component';
export * from './pill.component';
export * from './stat-tile.component';
export * from './status-tones';
export * from './table.component';
// forms, list toolbars and editor guards (promoted from features/admin/_ui and features/checklists/_ui)
export * from './entity-drawer.component';
export * from './store-chip-filter.component';
export * from './unsaved-changes.guard';
export { useOpsStyles } from './ops.styles';
export { ChartComponent } from '../charts/chart.component';
export { EmptyStateComponent, EMPTY_KINDS } from '../ui/ui.components';

export const DS = [
  PageComponent,
  CardComponent,
  StatTileComponent,
  StatStripComponent,
  TableComponent,
  TableCellDirective,
  TabsComponent,
  SegmentedComponent,
  PillComponent,
  ChipListComponent,
  FormSectionComponent,
  ToggleRowComponent,
  InfoBannerComponent,
  EmptyStateComponent,
  SkeletonComponent,
  DrawerComponent,
  MetricListComponent,
  DateStripComponent,
  ProgressComponent,
  GradientLegendComponent,
  AvatarComponent,
  ChartComponent,
  ChartCardComponent,
] as const;
