# Congruence Eye — Design System v2 ("store-ready")

The client rejected v1 as looking like a college project. The benchmark is the Tango Eye product UI (`docs/ui-reference/*.png`): a dense, calm, enterprise SaaS look used daily by store managers, area managers and HQ. Match that level of polish and information density, with Congruence's own branding. Never copy Tango's name or logo.

## Principles
1. **Data first, chrome quiet.** Light grey canvas, white cards, hairline borders, almost no shadows. Colour is reserved for data and status.
2. **Dense but breathable.** 13 px base text, 4 px spacing grid, 16–20 px card padding, 44–48 px table rows. Never giant hero numbers or oversized paddings.
3. **Every number is explorable.** Numbers in tables are link-blue and underlined when they drill down (e.g. Submitted → submissions filtered). Empty values render as `--`.
4. **Consistent page anatomy.** Breadcrumb → title + one-line description + "Last refreshed at 11:37 AM" → toolbar (search, filters, Export, primary action) → content.
5. **Status is a pill.** Soft-tinted background, coloured text, optional leading dot or icon: On time, Early close, Breached, Complied, Open, Overdue, etc.
6. **Works on the shop floor.** Staff use phones. Below 768 px, the app switches to a mobile layout with bottom tabs (Home, Checklists, Tasks, Alerts, More), large tap targets (44 px) and full-width forms.

## Tokens (light; dark mode mirrors them via `light-dark()`)
| Token | Value | Use |
|---|---|---|
| `--c-rail` | `#0E1A33` | Left icon rail |
| `--c-rail-active` | `#1D2B4A` | Active rail item background |
| `--c-rail-icon` | `#8C96AB` | Inactive rail icon |
| `--c-bg` | `#F4F6FA` | Page canvas |
| `--c-surface` | `#FFFFFF` | Cards, tables, panels |
| `--c-surface-2` | `#F8FAFC` | Table header row, inset panels |
| `--c-border` | `#E4E7EC` | Hairlines |
| `--c-text` | `#101828` | Primary text |
| `--c-text-2` | `#475467` | Secondary text, labels |
| `--c-text-3` | `#667085` | Placeholder, meta, captions (was `#98A2B3`: 2.5:1, failed WCAG AA) |
| `--c-primary` | `#0077B6` | Primary buttons, active tab underline, toggles (was `#0BA5EC`: white text only 2.8:1) |
| `--c-primary-hover` | `#026AA2` | Hover |
| `--c-primary-bright` | `#0BA5EC` | Decorative accents only (never under or as text) |
| `--c-link` | `#026AA2` | Drill-down numbers and links (5.9:1) |
| `--c-tile-band` | `linear-gradient(180deg,#E8F3FD 0%,#F3F8FE 100%)` | KPI tile header band (Tango style) |
| `--c-brand-grad` | `linear-gradient(135deg,#2563EB 0%,#7C3AED 100%)` | Logo mark only |
| success | text `#027A48`, bg `#ECFDF3`, solid `#12B76A` | |
| warning | text `#B54708`, bg `#FFFAEB`, solid `#F79009` | |
| danger | text `#B42318`, bg `#FEF3F2`, solid `#F04438` | |
| info | text `#175CD3`, bg `#EFF8FF`, solid `#2E90FA` | |
| neutral | text `#344054`, bg `#F2F4F7` | |
| Chart categorical | `#2E90FA #7A5AF8 #36BFFA #EE46BC #12B76A #F79009 #6172F3` | Series in this order |
| Chart sequential (density) | `#EFF8FF → #B2DDFF → #53B1FD → #1570EF → #194185` | Traffic density table |
| Heatmap | `#7A5AF8 → #2E90FA → #36BFFA → #FDE047 → #F97316 → #DC2626` (transparent below threshold) | Concentration heatmap |

Radius: 8 px controls, 10 px cards, 999 px pills. Shadow only on overlays (menus, dialogs, drawers): `0 12px 24px -4px rgba(16,24,40,.12)`.

## Typography
Inter (bundled). Text sizes: page title 18/26 semibold, section title 15/22 semibold, body 13/20, label 12/18 medium `--c-text-2`, caption 11/16 `--c-text-3`, KPI value 22/30 semibold (tabular numerals), big hero KPI 28/36 (dashboard only). Uppercase only for tiny group labels in navigation (11 px, +0.06em).

## Shell
- **Icon rail** (64 px, `--c-rail`): logo mark at the top; module icons with tooltip labels: Home, Traffic, Zone, Revenue (Conversion/Queue), Trax, AI Manager, Store Ops (Live, Infra health, Alerts, Tickets), Reports, Admin. The user avatar sits at the bottom. The active item has a 3 px `--c-primary` left indicator.
- **Module panel** (224 px, white, collapsible to 0): module name, then that module's pages grouped, with counts badges (e.g. Alerts 17, Overdue checklists 4).
- **Top bar** (56 px, white, bottom hairline): breadcrumbs on the left (`Trax › Manage › Checklists`). On the right: global store selector (searchable, multi-select with clusters: All stores / Region / Format / individual stores, shows "6 stores" or a store code), date range (presets + calendar), Compare toggle, refresh, notifications bell with count, help, user menu.
- **Page header** inside the content: title, description and the right-aligned primary/secondary actions. Below it, an optional underline tab bar.

## Core components (`src/app/shared/ds/`)
| Component | Notes |
|---|---|
| `ce-page` | Page frame: breadcrumbs (from route data), title, description, `lastRefreshed`, actions slot, tabs slot |
| `ce-card` | Title + info tooltip + subtitle + header actions; `flush` variant for tables |
| `ce-stat-tile` | Variants: `band` (Tango: tinted band with big value + label, body below for detail) and `compact` (icon, label, value, delta chip vs previous). Clickable when `link` is set |
| `ce-stat-strip` | Row of compact stats separated by dividers inside one card (e.g. Active 38 · Instances 48,186 · Not submitted 35,135) |
| `ce-table` | Declarative columns (`text`, `number`, `link-number`, `pill`, `date`, `avatar+name`, `actions`); sorting with ↓ indicators; search; Export; column chooser; pagination (10/25/50/100); sticky header; loading skeleton rows; empty state; row click; selection checkboxes for bulk actions; `--` for null |
| `ce-tabs` | Underline tabs synced to the route or query param |
| `ce-segmented` | Two to four options (Checklist / Task, Daily / Weekly / Monthly) |
| `ce-pill` | Status → tone mapping in one place (`STATUS_TONES`) |
| `ce-chip-list` | Removable chips (selected stores, recipients) with "+N more" overflow |
| `ce-form-section` | Card section with title, info, body; supports sentence inputs (`If store opens later than [5] minutes`) |
| `ce-toggle-row` | Label + helper + switch |
| `ce-info-banner` | Info/warning/success banners, light tinted |
| `ce-empty-state` | Icon, title, explanation, action. Different copy for "no data yet", "no results for filters" and "no permission" |
| `ce-skeleton` | Shimmer blocks for tiles, charts and tables |
| `ce-drawer` | Right side panel (480/640 px) for details and edit forms; full screen on mobile |
| `ce-metric-list` | Icon + label + value rows (zone side panel) |
| `ce-date-strip` | Horizontal day tabs (Nov 28 · Nov 29 · …) |
| `ce-progress` | Thin bar with an optional gradient (Engagers rate) |
| `ce-gradient-legend` | Heatmap legend |
| `ce-avatar` | Initials avatar with a deterministic colour |
| `ce-chart` | ECharts wrapper with the registered `congruence` theme: hairline grid, 11 px axis labels in `--c-text-3`, tooltip as a white card with shadow, legend at the top-left with square markers, no chart borders |

## Page patterns
- **Analytics page:** KPI strip (5–6 tiles), then a two-column grid of chart cards (2/3 and 1/3 widths), then a detail table. Each chart card has a title, an info tooltip giving the metric definition, a granularity segmented control (Hourly / Daily / Weekly) where relevant, and a Download menu (PNG/CSV).
- **Management list** (checklists, tasks, tickets, rules): stat strip → tabs → toolbar (search, filters as dropdown chips, Export, Create) → `ce-table` → row opens a `ce-drawer` or detail page.
- **Editor** (checklist builder, AI Manager rule, schedule): left 260 px outline panel (sections/steps), right stacked `ce-form-section` cards, sticky footer with Save as draft / Publish.
- **Evidence gallery** (detections, image directory, open/close): image cards (16:9, timestamp overlay, store code, status pill), lightbox with previous/next and metadata side panel.
- **Mobile staff:** a "My day" home with due checklists and tasks. Checklist filling is one question per card with sticky progress, camera-first photo capture and a big Submit.

Accessibility: every text token pair meets WCAG 2.1 AA (4.5:1) in both themes; `e2e/tests/edge-a11y.spec.ts` runs axe on
every route in light and dark and fails on any serious / critical violation.

## States every screen must handle
Loading (skeleton), empty (no data yet), empty (filtered), error (retry), no permission, offline (banner), partial data (e.g. a camera offline, shown as an inline warning), very long names (ellipsis with tooltip), large numbers (en-IN grouping, ₹ lakh/crore compact), zero denominators (show `--`, never NaN or Infinity), timezone (store-local labels).
