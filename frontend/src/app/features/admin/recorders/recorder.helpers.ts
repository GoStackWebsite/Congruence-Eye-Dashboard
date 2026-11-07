import { ProbeErrorCode, ProbeStatus, RecorderBrand, RecorderBrandInfo, RecorderKind, RecorderStatus, RecorderStream } from '../../../core/models/api.models';
import { Tone, toneOf } from '../../../shared/ds';

/**
 * Recorder (DVR / NVR) helpers for docs/API_CONTRACT_V3_RECORDERS.md: RTSP URL templating with a masked preview,
 * field validation and the plain-language fixes for failed connection tests. Pure functions (unit-tested).
 */

const CP = 'rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0';
const CP_SUB = 'rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=1';

/** The contract's brand table; used when the API omits a template and in unit tests. The API list wins. */
export const DEFAULT_BRANDS: RecorderBrandInfo[] = [
  { brand: 'HIKVISION', label: 'Hikvision / Prama / HiLook', defaultRtspPort: 554, mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}01', subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}02', notes: null },
  { brand: 'CP_PLUS', label: 'CP Plus', defaultRtspPort: 554, mainTemplate: CP, subTemplate: CP_SUB, notes: null },
  { brand: 'DAHUA', label: 'Dahua', defaultRtspPort: 554, mainTemplate: CP, subTemplate: CP_SUB, notes: null },
  { brand: 'UNIVIEW', label: 'Uniview', defaultRtspPort: 554, mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/unicast/c{channel}/s0/live', subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/unicast/c{channel}/s1/live', notes: null },
  { brand: 'GODREJ', label: 'Godrej', defaultRtspPort: 554, mainTemplate: CP, subTemplate: CP_SUB, notes: null },
  { brand: 'HONEYWELL', label: 'Honeywell', defaultRtspPort: 554, mainTemplate: CP, subTemplate: CP_SUB, notes: null },
  { brand: 'TIANDY', label: 'Tiandy', defaultRtspPort: 554, mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/{channel}/1', subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/{channel}/2', notes: null },
  {
    brand: 'GENERIC_ONVIF',
    label: 'Other (ONVIF)',
    defaultRtspPort: 554,
    mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/ch{channel}/main',
    subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/ch{channel}/sub',
    notes: 'The store box asks the recorder for the stream address over ONVIF; this is the fallback.',
  },
  { brand: 'CUSTOM', label: 'Custom URL pattern', defaultRtspPort: 554, mainTemplate: null, subTemplate: null, notes: 'Type the URL pattern from the recorder manual.' },
];

/** Plain help text shown under the brand picker (logo-less label + hint). */
export const BRAND_HELP: Partial<Record<RecorderBrand, string>> = {
  HIKVISION: 'Also covers Prama and HiLook. Channel 3 main stream is …/Channels/301.',
  CP_PLUS: 'Most CP Plus DVRs ship with RTSP on port 554.',
  DAHUA: 'Same URL pattern as CP Plus.',
  UNIVIEW: 'Enable "RTSP" under Network › Port on the NVR.',
  GODREJ: 'Uses the Dahua-style URL pattern.',
  HONEYWELL: 'Uses the Dahua-style URL pattern.',
  TIANDY: 'Channel and stream are part of the path.',
  GENERIC_ONVIF: 'Any recorder with ONVIF turned on. The store box looks the stream up for you.',
  CUSTOM: 'Use {user}, {pass}, {host}, {port} and {channel}. The pattern must start with rtsp://.',
};

export interface UrlParts {
  user: string;
  pass: string;
  host: string;
  port: number | string;
  channel: number;
}

export const MASK = '****';

/** IPv6 literals go in brackets inside a URL authority. */
export function urlHost(host: string): string {
  const h = host.trim();
  return h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
}

/**
 * Fills a template. `{user}` and `{pass}` are URL-encoded, `{channel}` is 1-based without padding (Hikvision
 * `{channel}01` → channel 3 = `301`). With `maskPassword` the password becomes `****` (for previews).
 */
export function fillTemplate(template: string, p: UrlParts, maskPassword = false): string {
  const pass = maskPassword ? (p.pass ? MASK : '') : encodeURIComponent(p.pass ?? '');
  return template
    .replace(/\{user\}/g, encodeURIComponent(p.user ?? ''))
    .replace(/\{pass\}/g, pass)
    .replace(/\{host\}/g, urlHost(p.host ?? ''))
    .replace(/\{port\}/g, String(p.port ?? ''))
    .replace(/\{channel\}/g, String(p.channel));
}

/** The template for a brand + stream (CUSTOM uses the recorder's own pattern). */
export function templateFor(brand: RecorderBrand, stream: RecorderStream, brands: RecorderBrandInfo[], custom: string | null | undefined): string | null {
  if (brand === 'CUSTOM') return custom?.trim() || null;
  const b = brands.find((x) => x.brand === brand) ?? DEFAULT_BRANDS.find((x) => x.brand === brand);
  const fallback = DEFAULT_BRANDS.find((x) => x.brand === brand);
  const t = stream === 'SUB' ? (b?.subTemplate ?? fallback?.subTemplate) : (b?.mainTemplate ?? fallback?.mainTemplate);
  return t ?? null;
}

/** Live preview of a channel URL with the password masked; null when a part is still missing. */
export function previewUrl(
  brand: RecorderBrand,
  stream: RecorderStream,
  brands: RecorderBrandInfo[],
  v: { username: string; password: string; host: string; rtspPort: number | string | null; urlTemplate?: string | null; hasPassword?: boolean },
  channel = 1,
): string | null {
  const t = templateFor(brand, stream, brands, v.urlTemplate);
  if (!t) return null;
  // an existing recorder keeps its stored password: preview it masked even when the field is blank
  const pass = v.password || (v.hasPassword ? 'x' : '');
  return fillTemplate(t, { user: v.username || 'admin', pass, host: v.host.trim() || '<ip>', port: v.rtspPort ?? 554, channel }, true);
}

export function defaultPortFor(brand: RecorderBrand, brands: RecorderBrandInfo[]): number {
  return brands.find((b) => b.brand === brand)?.defaultRtspPort ?? DEFAULT_BRANDS.find((b) => b.brand === brand)?.defaultRtspPort ?? 554;
}

// ---------------------------------------------------------------- validation

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isIpv6(h: string): boolean {
  const s = h.replace(/^\[|\]$/g, '');
  if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return false;
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((x) => (x ? x.split(':') : []));
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (i === groups.length - 1 && g.includes('.')) {
      if (!IPV4.test(g)) return false;
      count += 2;
    } else if (/^[0-9a-fA-F]{1,4}$/.test(g)) count++;
    else return false;
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

/** IPv4, IPv6 or a hostname. A dotted all-numeric string must be a valid IPv4. */
export function isValidHost(host: string | null | undefined): boolean {
  const h = (host ?? '').trim();
  if (!h) return false;
  if (IPV4.test(h)) return true;
  if (/^[\d.]+$/.test(h)) return false;
  if (h.includes(':')) return isIpv6(h);
  return HOSTNAME.test(h);
}

export function isValidPort(p: unknown): boolean {
  const n = Number(p);
  return p !== '' && p !== null && p !== undefined && Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function isValidChannels(n: unknown): boolean {
  const v = Number(n);
  return n !== '' && n !== null && n !== undefined && Number.isInteger(v) && v >= 1 && v <= 64;
}

/** CUSTOM pattern: must start with rtsp:// and contain {channel}. Returns an error message or null. */
export function customTemplateError(t: string | null | undefined): string | null {
  const s = (t ?? '').trim();
  if (!s) return 'Enter the URL pattern from the recorder manual';
  if (!/^rtsp:\/\//i.test(s)) return 'The pattern must start with rtsp://';
  if (!s.includes('{channel}')) return 'Add {channel} where the channel number goes';
  const unknown = (s.match(/\{[^}]*\}/g) ?? []).filter((x) => !['{user}', '{pass}', '{host}', '{port}', '{channel}'].includes(x));
  if (unknown.length) return `Unknown placeholder ${unknown[0]}. Use {user}, {pass}, {host}, {port} or {channel}`;
  return null;
}

export interface RecorderFormValue {
  name: string;
  brand: RecorderBrand | null;
  kind: RecorderKind;
  host: string;
  rtspPort: number | string | null;
  httpPort: number | string | null;
  username: string;
  password: string;
  channels: number | string | null;
  stream: RecorderStream;
  urlTemplate: string | null;
}

/** Field → message for an add/edit recorder form. `requirePassword` on create. */
export function validateRecorder(v: RecorderFormValue, requirePassword: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.name.trim()) e['name'] = 'Name is required';
  if (!v.brand) e['brand'] = 'Choose the recorder brand';
  if (!v.host.trim()) e['host'] = 'IP address or hostname is required';
  else if (!isValidHost(v.host)) e['host'] = 'Enter a valid IP address (e.g. 192.168.1.64) or hostname';
  if (!isValidPort(v.rtspPort)) e['rtspPort'] = 'Port must be a whole number from 1 to 65535';
  if (v.httpPort !== null && v.httpPort !== '' && !isValidPort(v.httpPort)) e['httpPort'] = 'Port must be a whole number from 1 to 65535';
  if (!v.username.trim()) e['username'] = 'Username is required';
  if (requirePassword && !v.password) e['password'] = 'Password is required';
  if (!isValidChannels(v.channels)) e['channels'] = 'Channels must be from 1 to 64';
  if (v.brand === 'CUSTOM') {
    const t = customTemplateError(v.urlTemplate);
    if (t) e['urlTemplate'] = t;
  }
  return e;
}

// ---------------------------------------------------------------- probes

export const TERMINAL_PROBE: ProbeStatus[] = ['OK', 'FAILED', 'EXPIRED'];
export function isTerminal(s: ProbeStatus | null | undefined): boolean {
  return !!s && TERMINAL_PROBE.includes(s);
}
/** Client-side cap on live polling (the server expires a probe after 60 s too). */
export const PROBE_POLL_MS = 1000;
export const PROBE_CAP_MS = 60_000;

/** The contract's plain-language fix for a failed test. */
export function probeErrorMessage(code: ProbeErrorCode | null | undefined, ctx: { host?: string | null; port?: number | string | null; channel?: number | null; status?: ProbeStatus } = {}): string {
  const where = ctx.host ? `${ctx.host}${ctx.port ? ':' + ctx.port : ''}` : 'the camera';
  if (ctx.status === 'EXPIRED') return "The store's AI box did not answer within a minute. Check it is switched on and online.";
  switch (code) {
    case 'AUTH':
      return 'Wrong username or password for the DVR.';
    case 'TIMEOUT':
    case 'UNREACHABLE':
      return `The store PC cannot reach ${where}. Check the DVR is on the same network and RTSP is enabled.`;
    case 'NOT_FOUND':
      return `Channel ${ctx.channel ?? '?'} has no camera or the URL pattern is wrong.`;
    case 'UNSUPPORTED_CODEC':
      return 'Switch the DVR channel to H.264.';
    case 'EDGE_OFFLINE':
      return "The store's AI box is offline.";
    default:
      return 'The test failed. Check the recorder settings and try again.';
  }
}

/** Probe tone from the DS map; a queued probe (PENDING) is "in progress" (info), not the checklist "pending" warning. */
export function probeTone(s: ProbeStatus | null | undefined): Tone {
  return s === 'PENDING' ? 'info' : s ? toneOf(s) : 'neutral';
}

export function recorderTone(s: RecorderStatus): Tone {
  return toneOf(s);
}

export function resolutionLabel(w: number | null | undefined, h: number | null | undefined): string | null {
  if (!w || !h) return null;
  const mp = (w * h) / 1e6;
  const tag = h >= 2160 ? '4K' : h >= 1944 ? '5MP' : h >= 1440 ? '4MP' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${h}p`;
  return `${w}×${h} · ${tag}${mp >= 1.9 ? '' : ' (low)'}`;
}

/** "DVR ch 3" / "NVR ch 12" for a recorder-linked camera. */
export function channelLabel(kind: RecorderKind | null | undefined, channel: number | null | undefined): string | null {
  if (!channel) return null;
  return `${kind === 'NVR' ? 'NVR' : kind === 'HYBRID' ? 'XVR' : 'DVR'} ch ${channel}`;
}

export { apiErrorText, httpStatus } from '../../../core/utils/http-errors';
