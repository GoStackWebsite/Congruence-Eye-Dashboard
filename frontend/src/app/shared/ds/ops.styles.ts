import { DOCUMENT, inject } from '@angular/core';

/**
 * Styles for the Store Ops, AI Manager, Reports and Admin screens (phase B). Built only on the DS tokens
 * (`--c-*`, radii, shadow) — no new colours. Injected once into <head> by `useOpsStyles()` (a component style this
 * size would exceed the per-component style budget and be duplicated into every lazy chunk). Every class is
 * prefixed `ops-` so nothing leaks into other screens.
 */
export const OPS_CSS = `
/* ---------- layout helpers ---------- */
.ops-stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ops-row { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.ops-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.ops-grid-2-1 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.ops-grid-1-2 { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 2fr); gap: 16px; align-items: start; }
.ops-muted { color: var(--c-text-3); }
.ops-strong { font-weight: 600; }
.ops-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.ops-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ops-spacer { flex: 1; }
.ops-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ops-sep { color: var(--c-text-3); padding: 0 2px; }
.w-100 { width: 100%; }

/* tabs that scroll sideways on phones instead of widening the page */
.ce-tabs.ops-scroll-tabs { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; flex-wrap: nowrap; max-width: 100%; }
.ce-tabs.ops-scroll-tabs::-webkit-scrollbar { display: none; }
.ce-tabs.ops-scroll-tabs .ce-tab { flex: none; white-space: nowrap; }
.ops-min0 { min-width: 0; }

/* ---------- toolbar: filters as dropdown chips ---------- */
.ops-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--c-border); }
.ops-toolbar.plain { padding: 0; border: 0; }
.ops-toolbar .ops-count { margin-left: auto; }
.ops-chip-select.mat-mdc-select {
  display: inline-flex; align-items: center; width: auto; max-width: 260px; height: 32px; padding: 0 10px 0 12px;
  border: 1px solid var(--c-border-strong); border-radius: 999px; background: var(--c-surface); font-size: 12px; font-weight: 500;
  color: var(--c-text-2); cursor: pointer; transition: border-color .12s ease, background .12s ease;
}
.ops-chip-select.mat-mdc-select:hover { border-color: var(--c-primary); }
.ops-chip-select.mat-mdc-select:focus-visible { outline: none; box-shadow: var(--c-focus-ring); }
.ops-chip-select.is-set.mat-mdc-select { border-color: var(--c-primary); background: var(--c-primary-soft); color: var(--c-primary-ink); }
.ops-chip-select .mat-mdc-select-trigger { gap: 6px; height: 100%; }
.ops-chip-select .mat-mdc-select-value { max-width: 220px; }
.ops-chip-select .mat-mdc-select-placeholder { color: var(--c-text-2); }
.ops-chip-select .ops-chip-label { color: var(--c-text-3); font-weight: 400; margin-right: 4px; }
.ops-chip-select.is-set .ops-chip-label { color: inherit; }
.ops-chip-select .mat-mdc-select-arrow-wrapper { transform: none; }
.ops-chip-input { height: 32px; padding: 0 12px; border: 1px solid var(--c-border-strong); border-radius: 999px; background: var(--c-surface); color: var(--c-text); font: inherit; font-size: 12px; min-width: 0; }
.ops-chip-input:focus { outline: none; border-color: var(--c-primary); box-shadow: var(--c-focus-ring); }
.ops-clear { font-size: 12px; }

/* ---------- forms ---------- */
.ops-form { display: flex; flex-direction: column; gap: 16px; }
.ops-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 14px; }
.ops-form-grid .full { grid-column: 1 / -1; }
.ops-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ops-field .ce-field-label { margin: 0; }
.ops-req { color: var(--c-danger-text); margin-left: 2px; }
.ops-form-group { margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--c-border); font-size: 12px; font-weight: 600; color: var(--c-text-2); text-transform: none; }
.ops-form-group:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.ops-check { display: flex; flex-direction: column; gap: 2px; }
.ops-inline-error { color: var(--c-danger-text); font-size: 12px; line-height: 16px; }
.ops-help { font-size: 12px; line-height: 18px; color: var(--c-text-3); }
.ops-url-preview { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px dashed var(--c-border-strong); border-radius: 8px; background: var(--c-surface-2); min-width: 0; }
.ops-url-preview code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; color: var(--c-text); }
.ops-url-preview .material-symbols-outlined { font-size: 18px; color: var(--c-text-3); }

/* ---------- status stripe rows (alerts) ---------- */
.ops-sev-cell { position: relative; width: 44px; padding: 0 0 0 14px !important; }
.ops-sev-cell::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 0 3px 3px 0; background: var(--ops-sev, var(--c-border-strong)); }
.ops-sev-LOW { --ops-sev: var(--c-info); }
.ops-sev-MEDIUM { --ops-sev: var(--c-warning); }
.ops-sev-HIGH { --ops-sev: var(--ce-serious); }
.ops-sev-CRITICAL { --ops-sev: var(--c-danger); }
.ops-dtable td { vertical-align: middle; }
.ops-dtable tr.ops-highlight td { background: color-mix(in srgb, var(--c-primary) 8%, transparent); }
tr.ops-highlight .cell-sub { color: var(--c-text-2); }
.ops-dtable tr.ops-dim td { color: var(--c-text-2); }
.ops-alert-main { display: flex; flex-direction: column; gap: 2px; min-width: 220px; max-width: 460px; white-space: normal; }
.ops-alert-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--c-text); }
.ops-alert-msg { font-size: 12px; line-height: 17px; color: var(--c-text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ops-row-actions { display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end; }
.ops-pager { display: flex; justify-content: flex-end; border-top: 1px solid var(--c-border); }
.ops-pager .mat-mdc-paginator { background: transparent; }

/* ---------- detail list (drawers, side panels) ---------- */
.ops-dl { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px 12px; margin: 0; font-size: 13px; }
.ops-dl dt { color: var(--c-text-3); font-size: 12px; }
.ops-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--c-text); }
.ops-section-title { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--c-text); }
.ops-drawer-section { padding: 16px 0; border-bottom: 1px solid var(--c-border); }
.ops-drawer-section:first-child { padding-top: 0; }
.ops-drawer-section:last-child { border-bottom: 0; }
.ops-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.ops-timeline li { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; font-size: 12px; color: var(--c-text-2); }
.ops-timeline .material-symbols-outlined { font-size: 18px; color: var(--c-text-3); }
.ops-timeline li.done .material-symbols-outlined { color: var(--c-success); }

/* ---------- evidence media ---------- */
.ops-media { position: relative; display: block; aspect-ratio: 16 / 9; background: #1d2939; border-radius: 8px; overflow: hidden; }
.ops-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.ops-media-empty { display: grid; place-items: center; align-content: center; gap: 4px; height: 100%; color: #b9c0cc; /* on the fixed dark media background */ font-size: 12px; text-align: center; padding: 8px; }
.ops-media-empty .material-symbols-outlined { font-size: 28px; color: #667085; }
.ops-evidence-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.ops-evidence-strip a { display: block; }

/* detection gallery cards (ref 09) */
.ops-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px; }
.ops-det-card { display: flex; flex-direction: column; border: 1px solid var(--c-border); border-radius: 10px; overflow: hidden; background: var(--c-surface); min-width: 0; transition: border-color .12s ease, box-shadow .12s ease; }
.ops-det-card:hover { border-color: var(--c-border-strong); }
.ops-det-card.highlight { border-color: var(--c-primary); box-shadow: 0 0 0 2px var(--c-primary-soft); }
.ops-det-open { all: unset; display: block; cursor: zoom-in; position: relative; }
.ops-det-open:focus-visible { outline: 2px solid var(--c-primary); outline-offset: -2px; }
.ops-det-open .ops-media { border-radius: 0; }
.ops-det-overlay { position: absolute; left: 8px; top: 8px; right: 8px; display: flex; align-items: center; gap: 6px; pointer-events: none; }
.ops-det-status { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 10px; border-radius: 6px; background: rgba(255, 255, 255, .94); color: #344054; font-size: 11px; font-weight: 500; box-shadow: 0 1px 2px rgba(16, 24, 40, .12); }
.ops-det-status .ce-pill { height: 18px; }
/* the status chip sits on a white plate over the photo in both themes: resolve its tones as light */
.ops-det-status { color-scheme: light; }
.ops-det-time { position: absolute; left: 8px; bottom: 8px; padding: 2px 7px; border-radius: 4px; background: rgba(16, 24, 40, .72); color: #fff; font-size: 11px; font-variant-numeric: tabular-nums; }
.ops-media.no-snap { background: var(--c-surface-2); box-shadow: inset 0 -1px 0 var(--c-border); }
.ops-media.no-snap .ops-media-empty { color: var(--c-text-2); }
.ops-media.no-snap .ops-media-empty .material-symbols-outlined { font-size: 30px; color: var(--c-text-3); }
.ops-det-code { position: absolute; right: 8px; bottom: 8px; padding: 2px 7px; border-radius: 4px; background: rgba(16, 24, 40, .72); color: #fff; font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.ops-det-body { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; min-width: 0; }
.ops-det-type { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; min-width: 0; }
.ops-det-type .material-symbols-outlined { font-size: 18px; color: var(--c-primary-ink); }
.ops-det-meta { font-size: 12px; color: var(--c-text-3); }
.ops-det-details { font-size: 12px; color: var(--c-text-2); line-height: 17px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ops-det-foot { display: flex; align-items: center; gap: 6px; margin-top: 2px; min-height: 28px; flex-wrap: wrap; }
.ops-review-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.ops-review-btn.on-valid { border-color: var(--c-success); color: var(--c-success-text); background: var(--c-success-bg); }
.ops-review-btn.on-false { border-color: var(--c-border-strong); color: var(--c-neutral-text); background: var(--c-neutral-bg); }
.ops-gallery-skel { display: flex; flex-direction: column; gap: 8px; }
.ops-gallery-skel .ce-skel:first-child { height: auto; aspect-ratio: 16 / 9; border-radius: 8px; }
.ops-thumb { width: 96px; aspect-ratio: 16 / 9; border-radius: 6px; object-fit: cover; display: block; background: #1d2939; cursor: zoom-in; }
.ops-thumb.empty { display: grid; place-items: center; color: var(--c-text-3); font-size: 10px; cursor: default; }

/* lightbox side panel (reuses .lightbox / .lb-stage / .lb-meta from the DS screens) */
.ops-lb-status { display: flex; align-items: center; gap: 8px; }
.ops-lb-review { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ops-lb-review .ce-btn.active-valid { border-color: var(--c-success); color: var(--c-success-text); background: var(--c-success-bg); }
.ops-lb-review .ce-btn.active-false { border-color: var(--c-border-strong); background: var(--c-neutral-bg); }

/* ---------- open / close (ref 10) ---------- */
.ops-oc-list { display: flex; flex-direction: column; gap: 16px; }
.ops-oc-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 16px 20px 18px; }
.ops-oc-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px 20px; align-items: center; margin-bottom: 14px; }
.ops-oc-kv { display: grid; grid-template-columns: 128px minmax(0, 1fr); align-items: center; gap: 4px 12px; font-size: 13px; }
.ops-oc-kv dt { color: var(--c-text-2); font-weight: 500; }
.ops-oc-kv dt::after { content: ' :'; }
.ops-oc-kv dd { margin: 0; font-weight: 500; min-width: 0; }
.ops-oc-date { display: flex; gap: 12px; align-items: baseline; font-size: 13px; }
.ops-oc-date span:first-child { color: var(--c-text-2); font-weight: 500; }
.ops-oc-snaps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.ops-oc-snap { margin: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ops-oc-snap button.ops-media { all: unset; position: relative; display: block; aspect-ratio: 16 / 9; background: #1d2939; border-radius: 8px; overflow: hidden; cursor: zoom-in; }
.ops-oc-snap button.ops-media:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
.ops-oc-snap button.ops-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.ops-oc-stamp { position: absolute; left: 8px; top: 8px; padding: 2px 7px; border-radius: 4px; background: rgba(16, 24, 40, .65); color: #fff; font-size: 11px; letter-spacing: .04em; font-variant-numeric: tabular-nums; }
.ops-oc-missing { aspect-ratio: 16 / 9; border-radius: 8px; border: 1px dashed var(--c-border-strong); background: var(--c-surface-2); display: grid; place-items: center; align-content: center; gap: 6px; color: var(--c-text-3); font-size: 12px; text-align: center; padding: 12px; }
.ops-oc-missing .material-symbols-outlined { font-size: 26px; }
.ops-oc-cap { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ops-oc-cap-title { font-weight: 600; font-size: 13px; }
.ops-oc-cap-time { font-size: 12px; color: var(--c-text-2); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ops-oc-delta { color: var(--c-danger-text); }
.ops-oc-delta.good { color: var(--c-success-text); }
.ops-oc-sched { color: var(--c-text-3); }

/* ---------- AI summary type tiles ---------- */
.ops-type-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.ops-type-tile { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--c-border); border-radius: 10px; background: var(--c-surface); min-width: 0; text-decoration: none; color: inherit; transition: border-color .12s ease; }
.ops-type-tile:hover { border-color: var(--c-primary); }
.ops-type-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ops-type-icon { width: 32px; height: 32px; flex: none; border-radius: 8px; display: grid; place-items: center; background: var(--c-tile-band-flat); color: var(--c-primary-ink); }
.ops-type-icon .material-symbols-outlined { font-size: 18px; }
.ops-type-name { font-weight: 600; font-size: 13px; }
.ops-type-nums { display: flex; align-items: baseline; gap: 14px; font-variant-numeric: tabular-nums; }
.ops-type-big { font-size: 22px; line-height: 30px; font-weight: 600; color: var(--c-text); }
.ops-type-big.bad { color: var(--c-danger-text); }
.ops-type-lbl { font-size: 11px; color: var(--c-text-3); }
.ops-bar { display: flex; align-items: center; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--c-text-2); }
.ops-bar-track { display: block; flex: 1; height: 6px; border-radius: 999px; background: var(--c-surface-3); overflow: hidden; min-width: 48px; }
.ops-bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--c-success); }
.ops-bar-fill.warn { background: var(--c-warning); }
.ops-bar-fill.bad { background: var(--c-danger); }

/* ---------- NOC board (infra) ---------- */
.ops-noc { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.ops-noc-card { position: relative; display: flex; flex-direction: column; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; overflow: hidden; min-width: 0; }
.ops-noc-card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--ops-h, var(--c-border)); }
.ops-noc-card[data-health='GOOD'] { --ops-h: var(--c-success); }
.ops-noc-card[data-health='DEGRADED'] { --ops-h: var(--c-warning); }
.ops-noc-card[data-health='DOWN'] { --ops-h: var(--c-danger); border-color: color-mix(in srgb, var(--c-danger) 35%, var(--c-border)); }
.ops-noc-head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 14px 10px 16px; }
.ops-noc-name { font-weight: 600; font-size: 14px; line-height: 20px; min-width: 0; }
.ops-noc-sub { font-size: 12px; color: var(--c-text-3); }
.ops-noc-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--c-border); border-bottom: 1px solid var(--c-border); }
.ops-noc-metric { padding: 10px 12px 10px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ops-noc-metric + .ops-noc-metric { border-left: 1px solid var(--c-border); }
.ops-noc-label { font-size: 11px; color: var(--c-text-3); display: flex; align-items: center; gap: 4px; }
.ops-noc-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 6px; min-width: 0; }
.ops-noc-value.bad { color: var(--c-danger-text); }
.ops-noc-value.warn { color: var(--c-warning-text); }
.ops-cam-bar { display: flex; gap: 2px; height: 6px; }
.ops-cam-bar span { flex: 1; border-radius: 2px; background: var(--c-success); }
.ops-cam-bar span.off { background: var(--c-danger); }
.ops-cam-bar span.na { background: var(--c-surface-3); }
.ops-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--c-text-3); }
.ops-dot.good { background: var(--c-success); box-shadow: 0 0 0 3px var(--c-success-bg); }
.ops-dot.bad { background: var(--c-danger); box-shadow: 0 0 0 3px var(--c-danger-bg); }
.ops-dot.warn { background: var(--c-warning); box-shadow: 0 0 0 3px var(--c-warning-bg); }
.ops-noc-issues { list-style: none; margin: 0; padding: 10px 16px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--c-text-2); flex: 1; }
.ops-noc-issues li[hidden] { display: none; }
.ops-noc-issues li { display: flex; gap: 6px; align-items: flex-start; line-height: 17px; }
.ops-noc-issues .material-symbols-outlined { font-size: 16px; color: var(--c-warning); flex: none; }
.ops-noc-issues li.none { color: var(--c-text-3); }
.ops-noc-issues li.none .material-symbols-outlined { color: var(--c-success); }
.ops-noc-foot { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 16px; border-top: 1px solid var(--c-border); background: var(--c-surface-2); }
.ops-noc-foot .ce-num-link { font-size: 12px; }

/* ---------- report catalogue ---------- */
.ops-cat-group { display: flex; flex-direction: column; gap: 10px; }
.ops-cat-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--c-text-2); }
.ops-cat-title .material-symbols-outlined { font-size: 18px; color: var(--c-text-3); }
.ops-cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ops-report { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; min-width: 0; }
.ops-report-head { display: flex; gap: 12px; align-items: flex-start; }
.ops-report-icon { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; flex: none; background: var(--c-tile-band); color: var(--c-primary-ink); }
.ops-report-icon .material-symbols-outlined { font-size: 20px; }
.ops-report-name { font-weight: 600; font-size: 14px; }
.ops-report-desc { font-size: 12px; color: var(--c-text-2); line-height: 17px; }
.ops-report-cols { font-size: 11px; color: var(--c-text-3); line-height: 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ops-report-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }

/* ---------- secure key panel ---------- */
.ops-key-panel { display: flex; flex-direction: column; gap: 12px; }
.ops-key-box { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-radius: 8px; border: 1px solid var(--c-border-strong); background: var(--c-surface-2); min-width: 0; }
.ops-key-box code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; letter-spacing: .02em; color: var(--c-text); }
.ops-key-steps { margin: 0; padding-left: 18px; font-size: 12px; color: var(--c-text-2); line-height: 20px; }
.ops-key-steps code { font-size: 12px; background: var(--c-surface-3); padding: 0 4px; border-radius: 4px; }

/* ---------- tabs page header bits ---------- */
.ops-store-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 12px; color: var(--c-text-2); }
.ops-store-meta span { display: inline-flex; align-items: center; gap: 4px; }
.ops-store-meta .material-symbols-outlined { font-size: 16px; color: var(--c-text-3); }
.ops-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }

/* ---------- people ---------- */
.ops-user { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ops-user-text { display: flex; flex-direction: column; min-width: 0; }
.ops-user-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.ops-user-mail { font-size: 12px; color: var(--c-text-3); overflow: hidden; text-overflow: ellipsis; }
.ops-chips { position: relative; display: inline-flex; flex-wrap: nowrap; overflow: hidden; gap: 4px; max-width: 360px; white-space: normal; }
.ops-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px; background: var(--c-surface-3); color: var(--c-text-2); font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-chip.more { flex: none; }
.ops-chip.all { background: var(--c-primary-soft); color: var(--c-primary-ink); }

/* ---------- audit diff ---------- */
.ops-diff { width: 100%; border-collapse: collapse; font-size: 12px; }
.ops-diff th { text-align: left; font-weight: 500; color: var(--c-text-3); padding: 6px 8px; border-bottom: 1px solid var(--c-border); }
.ops-diff td { padding: 6px 8px; border-bottom: 1px solid var(--c-border); vertical-align: top; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.ops-diff td.k { font-family: inherit; font-weight: 500; color: var(--c-text-2); width: 30%; }
.ops-diff .del { background: var(--c-danger-bg); color: var(--c-danger-text); text-decoration: line-through; text-decoration-thickness: 1px; }
.ops-diff .add { background: var(--c-success-bg); color: var(--c-success-text); }
.ops-diff .same { color: var(--c-text-3); }
.ops-code { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--c-surface-2); border: 1px solid var(--c-border); font-size: 12px; max-height: 280px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.ops-action-pill { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }

/* ---------- settings ---------- */
.ops-settings { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; align-items: start; }
.ops-settings-nav { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 2px; }
.ops-settings-nav a { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; font-size: 13px; color: var(--c-text-2); text-decoration: none; }
.ops-settings-nav a:hover { background: var(--c-hover); color: var(--c-text); }
.ops-settings-nav a.invalid { color: var(--c-danger-text); }
.ops-settings-nav .material-symbols-outlined { font-size: 18px; }
.ops-settings-sections { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.ops-savebar { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 12px 16px; margin-top: 4px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; box-shadow: var(--shadow-overlay); }

/* ---------- recorders ---------- */
.ops-channels { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.ops-ch { position: relative; display: flex; flex-direction: column; border: 1px solid var(--c-border); border-radius: 10px; background: var(--c-surface); overflow: hidden; min-width: 0; transition: border-color .12s ease, box-shadow .12s ease; }
.ops-ch.selected { border-color: var(--c-primary); box-shadow: 0 0 0 2px var(--c-primary-soft); }
.ops-ch.ok { --ops-ch: var(--c-success); }
.ops-ch.failed { --ops-ch: var(--c-danger); }
.ops-ch-media { position: relative; aspect-ratio: 16 / 9; background: #1d2939; }
.ops-ch-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ops-ch-media .ops-media-empty { position: absolute; inset: 0; }
.ops-ch-num { position: absolute; left: 6px; top: 6px; padding: 1px 7px; border-radius: 4px; background: rgba(16, 24, 40, .72); color: #fff; font-size: 11px; font-weight: 600; }
.ops-ch-sel { position: absolute; right: 6px; top: 6px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: rgba(255, 255, 255, .92); color: var(--c-text-2); cursor: pointer; }
.ops-ch-sel .material-symbols-outlined { font-size: 20px; }
.ops-ch-sel[aria-checked='true'] { color: var(--c-primary); }
.ops-ch-sel:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 1px; }
.ops-ch-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; min-width: 0; }
.ops-ch-name { font-size: 12px; font-weight: 600; min-width: 0; }
.ops-ch-name.none { color: var(--c-text-3); font-weight: 400; }
.ops-ch-result { font-size: 11px; line-height: 15px; color: var(--c-text-2); min-height: 15px; }
.ops-ch-result.err { color: var(--c-danger-text); }
.ops-ch-running { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--c-info-text); }
.ops-rec-layout { grid-template-columns: minmax(0, 1fr) 300px; }
.ops-guide { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.ops-guide li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; font-size: 12px; line-height: 17px; color: var(--c-text-2); }
.ops-guide li b { display: block; color: var(--c-text); font-size: 13px; font-weight: 600; margin-bottom: 1px; }
.ops-guide .ops-guide-ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--c-tile-band-flat); color: var(--c-primary-ink); }
.ops-guide .ops-guide-ic .material-symbols-outlined { font-size: 16px; }
.ops-disc { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.ops-disc li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--c-border); font-size: 12px; min-width: 0; }
.ops-disc li:last-child { border-bottom: 0; }
.ops-brand-hint { font-size: 12px; color: var(--c-text-3); line-height: 17px; }

/* ---------- zone editor ---------- */
.ops-ze { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.ops-ze-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 6px; border: 1px solid var(--c-border); border-bottom: 0; border-radius: 10px 10px 0 0; background: var(--c-surface-2); }
.ops-ze-toolbar .ops-tb-sep { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--c-border); }
.ops-tb-btn { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--c-text-2); font: inherit; font-size: 12px; cursor: pointer; }
.ops-tb-btn:hover:not(:disabled) { background: var(--c-surface); border-color: var(--c-border); color: var(--c-text); }
.ops-tb-btn.on { background: var(--c-primary-soft); color: var(--c-primary-ink); }
.ops-tb-btn:disabled { opacity: .45; cursor: default; }
.ops-tb-btn .material-symbols-outlined, .ops-tb-btn .mat-icon { font-size: 18px; width: 18px; height: 18px; }
.ops-ze .media-stage { border-radius: 0 0 10px 10px; }
.ops-ze-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-top: 10px; font-size: 12px; color: var(--c-text-2); }
.ops-ze-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ops-ze-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.ops-layers { list-style: none; margin: 0; padding: 0; border: 1px solid var(--c-border); border-radius: 10px; overflow: hidden; }
.ops-layers li { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border-bottom: 1px solid var(--c-border); font-size: 13px; min-width: 0; background: var(--c-surface); }
.ops-layers li:last-child { border-bottom: 0; }
.ops-layers li.active { background: var(--c-primary-soft); }
.ops-layers li.hidden-layer .ops-layer-name { opacity: .5; }
.ops-layer-swatch { width: 12px; height: 12px; border-radius: 3px; flex: none; }
.ops-layer-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ops-layer-name small { font-size: 11px; color: var(--c-text-3); }
.ops-layers li.empty { color: var(--c-text-3); justify-content: center; padding: 18px; }
.ops-ze-form { border: 1px solid var(--c-border); border-radius: 10px; padding: 14px; background: var(--c-surface); display: flex; flex-direction: column; gap: 12px; }
.ops-ze-form-foot { display: flex; align-items: center; gap: 6px; }

/* ---------- responsive ---------- */
@media (max-width: 1279.98px) {
  .ops-grid-2-1, .ops-grid-1-2 { grid-template-columns: minmax(0, 1fr); }
  .ops-ze { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1023.98px) {
  .ops-settings { grid-template-columns: minmax(0, 1fr); }
  .ops-settings-nav { position: static; flex-direction: row; overflow-x: auto; }
  .ops-settings-nav a { white-space: nowrap; }
  .ops-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767.98px) {
  .ops-grid-2 { grid-template-columns: minmax(0, 1fr); }
  .ops-form-grid { grid-template-columns: minmax(0, 1fr); }
  .ops-gallery { grid-template-columns: minmax(0, 1fr); padding: 12px; gap: 12px; }
  .ops-oc-snaps { grid-template-columns: minmax(0, 1fr); }
  .ops-oc-head { grid-template-columns: minmax(0, 1fr); }
  .ops-oc-card { padding: 14px; }
  .ops-oc-kv { grid-template-columns: 112px minmax(0, 1fr); }
  .ops-noc { grid-template-columns: minmax(0, 1fr); }
  .ops-cat-grid { grid-template-columns: minmax(0, 1fr); }
  .ops-channels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ops-toolbar { padding: 10px 12px; }
  .ops-chip-select.mat-mdc-select { max-width: 100%; }
  .ops-dl { grid-template-columns: 96px minmax(0, 1fr); }
  .ops-type-tiles { grid-template-columns: minmax(0, 1fr); }
  .ops-savebar { margin: 0 -4px; }
}
`;

/** Adds the ops stylesheet to the document once. Call from a component field initializer. */
export function useOpsStyles(): true {
  const doc = inject(DOCUMENT);
  if (!doc.getElementById('ce-ops-css')) {
    const el = doc.createElement('style');
    el.id = 'ce-ops-css';
    el.textContent = OPS_CSS;
    doc.head.appendChild(el);
  }
  return true;
}

/** "05 Oct 2026" for an ISO timestamp or date (null → null, shown as --). */
export function isoDay(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
