import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/*
 * Style hosts for the Trax / store-ops screens. Each is an empty, unencapsulated component whose stylesheet is added
 * to <head> once when it is first rendered (stays under the 10 kB anyComponentStyle budget per part). Pages render the
 * parts they need, e.g. `<ce-ops-base-styles /><ce-ops-fill-styles />`. To be promoted into styles/_screens.scss.
 */
const host = { style: 'display:none', 'aria-hidden': 'true' };

@Component({ selector: 'ce-ops-base-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-base.scss' })
export class OpsBaseStyles {}

@Component({ selector: 'ce-ops-mobile-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-mobile.scss' })
export class OpsMobileStyles {}

@Component({ selector: 'ce-ops-editor-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-editor.scss' })
export class OpsEditorStyles {}

@Component({ selector: 'ce-ops-builder-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-builder.scss' })
export class OpsBuilderStyles {}

@Component({
  selector: 'ce-ops-fill-styles',
  template: '',
  host,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./ops-fill.scss'],
})
export class OpsFillStyles {}

@Component({ selector: 'ce-ops-fill-inputs-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-fill-inputs.scss' })
export class OpsFillInputsStyles {}

@Component({ selector: 'ce-ops-fill-actions-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-fill-actions.scss' })
export class OpsFillActionsStyles {}

@Component({ selector: 'ce-ops-review-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-review.scss' })
export class OpsReviewStyles {}

@Component({ selector: 'ce-ops-tasks-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-tasks.scss' })
export class OpsTasksStyles {}

@Component({ selector: 'ce-ops-service-styles', template: '', host, encapsulation: ViewEncapsulation.None, changeDetection: ChangeDetectionStrategy.OnPush, styleUrl: './ops-service.scss' })
export class OpsServiceStyles {}

/** Everything the checklist fill screen (and the builder's phone preview) needs. */
export const FILL_STYLES = [OpsBaseStyles, OpsMobileStyles, OpsFillStyles, OpsFillInputsStyles, OpsFillActionsStyles] as const;

/** Management lists (scaffolding + stacked-card tables on phones). Template: `<ce-ops-base-styles /><ce-ops-mobile-styles />`. */
export const LIST_STYLES = [OpsBaseStyles, OpsMobileStyles] as const;
