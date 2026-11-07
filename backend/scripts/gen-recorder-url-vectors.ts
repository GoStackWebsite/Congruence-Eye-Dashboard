/**
 * Regenerates src/modules/recorders/recorder-url.vectors.json — the RTSP URL templating vectors shared by the
 * backend unit tests and the ai-service mirror (tests/test_recorder_urls.py).
 * Usage: npx ts-node -T scripts/gen-recorder-url-vectors.ts
 * The expected values are reviewed by hand in recorder-url.spec.ts (explicit literal assertions), so a
 * regression in the helper cannot silently rewrite them.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildRtspUrl, maskedRtspUrl, RECORDER_BRANDS, RecorderUrlInput } from '../src/modules/recorders/recorder-url';

interface Case { name: string; input: RecorderUrlInput; channel: number; stream: string; password: string | null; expected?: string; expectedMasked?: string }

const cases: Case[] = [];
const base = { host: '10.0.0.20', rtspPort: 554, username: 'admin' };
for (const brand of RECORDER_BRANDS) {
  const urlTemplate = brand === 'CUSTOM' ? 'rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}?token=1' : null;
  for (const stream of ['MAIN', 'SUB']) {
    for (const channel of [1, 3, 12]) cases.push({ name: `${brand} ${stream} ch${channel}`, input: { ...base, brand, urlTemplate }, channel, stream, password: 'p@ss:w/rd#1' });
  }
}
cases.push({ name: 'IPv6 host', input: { brand: 'HIKVISION', host: 'fe80::1', rtspPort: 8554, username: 'admin' }, channel: 2, stream: 'MAIN', password: 'secret' });
cases.push({ name: 'hostname, no password', input: { brand: 'DAHUA', host: 'dvr-tnagar.local', rtspPort: 554, username: 'viewer' }, channel: 4, stream: 'SUB', password: null });
cases.push({ name: 'no user, no password', input: { brand: 'TIANDY', host: '192.168.1.64', rtspPort: 554, username: '' }, channel: 1, stream: 'MAIN', password: '' });
cases.push({ name: 'special user and unicode password', input: { brand: 'UNIVIEW', host: '10.1.2.3', rtspPort: 10554, username: 'ops user@store' }, channel: 7, stream: 'SUB', password: "Ünï!*'()~ %+&=" });
cases.push({ name: 'custom without credentials', input: { brand: 'CUSTOM', host: '10.9.9.9', rtspPort: 554, username: 'admin', urlTemplate: 'rtsp://{host}:{port}/stream{channel}' }, channel: 5, stream: 'MAIN', password: 'x' });
for (const c of cases) {
  c.expected = buildRtspUrl(c.input, c.channel, c.stream, c.password);
  c.expectedMasked = maskedRtspUrl(c.input, c.channel, c.stream, !!c.password);
}
const out = path.resolve(__dirname, '../src/modules/recorders/recorder-url.vectors.json');
fs.writeFileSync(
  out,
  JSON.stringify({ description: 'Shared RTSP URL templating vectors (contract v3). Checked by backend recorder-url.spec.ts and ai-service tests/test_recorder_urls.py.', cases }, null, 2) + '\n',
);
console.log(`${cases.length} vectors → ${out}`);
