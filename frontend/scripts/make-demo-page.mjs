#!/usr/bin/env node
/**
 * Post-build step for `npm run build:demo`.
 * Produces dist/demo/page.html: ONLY the inner content of the demo index.html (title, inline critical
 * <style> if any, stylesheet link(s), <app-root>, modulepreload links and the main script) for hosts that
 * wrap the page in their own <!doctype><html><head><body> skeleton. Also verifies the output is
 * host-safe (relative URLs only, no <base>, no service worker / manifest) and prints file stats.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist/demo');
const BROWSER = join(OUT, 'browser');
const html = readFileSync(join(BROWSER, 'index.html'), 'utf8');

const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const stylesheets = pick(/<link[^>]+rel="stylesheet"[^>]*>/g).map((l) => l.replace(/\smedia="print"\s+onload="[^"]*"/, ''));
const preloads = pick(/<link[^>]+rel="modulepreload"[^>]*>/g);
const appRoot = pick(/<app-root[^>]*>[\s\S]*?<\/app-root>/g);
const scripts = pick(/<script[^>]*src="[^"]+"[^>]*><\/script>/g);
if (!appRoot.length || !scripts.length) throw new Error('index.html: <app-root> or main script not found');

const page = [...title, ...styles, ...stylesheets, ...appRoot, ...preloads, ...scripts].join('\n') + '\n';
writeFileSync(join(OUT, 'page.html'), page);

// host-safety checks
const problems = [];
if (/<base\b/i.test(html)) problems.push('index.html contains <base>');
if (/manifest/i.test(page)) problems.push('page.html references a manifest');
for (const m of page.matchAll(/(?:href|src)="([^"]+)"/g)) if (/^(\/|https?:)/.test(m[1])) problems.push(`non-relative URL ${m[1]}`);

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(BROWSER);
if (files.some((f) => /ngsw|manifest\.webmanifest/.test(f))) problems.push('service worker / manifest files present');
const total = files.reduce((s, f) => s + statSync(f).size, 0);
const biggest = files.map((f) => [relative(BROWSER, f), statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`[demo] page.html → ${relative(ROOT, join(OUT, 'page.html'))} (${page.length} bytes)`);
console.log(`[demo] dist/demo/browser: ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log('[demo] largest:', biggest.map(([f, s]) => `${f} ${(s / 1024 / 1024).toFixed(2)} MB`).join(', '));
if (files.length > 240) problems.push(`${files.length} files (> 240)`);
if (biggest[0][1] > 16 * 1024 * 1024) problems.push('a file exceeds 16 MB');
if (problems.length) {
  console.error('[demo] host-safety problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
