/**
 * DVR / NVR RTSP URL templating (contract v3). Pure functions, shared by the recorders module, the cameras
 * module and the edge config. The ai-service has a byte-for-byte mirror in
 * `congruence_eye_ai/recorders/urls.py`; `recorder-url.spec.ts` and the Python tests pin the same vectors.
 *
 * Placeholders: {user}, {pass} (URL-encoded), {host}, {port}, {channel} (1-based, no padding).
 */

export const RECORDER_BRANDS = ['HIKVISION', 'CP_PLUS', 'DAHUA', 'UNIVIEW', 'GODREJ', 'HONEYWELL', 'TIANDY', 'GENERIC_ONVIF', 'CUSTOM'] as const;
export type RecorderBrand = (typeof RECORDER_BRANDS)[number];
export const RECORDER_KINDS = ['DVR', 'NVR', 'HYBRID'] as const;
export const STREAM_PROFILES = ['MAIN', 'SUB'] as const;
export type StreamProfile = (typeof STREAM_PROFILES)[number];
export const RECORDER_STATUSES = ['ONLINE', 'PARTIAL', 'OFFLINE', 'UNKNOWN'] as const;

/** Shown instead of the password in every browser-facing URL. */
export const PASSWORD_MASK = '****';

export interface BrandInfo {
  brand: RecorderBrand;
  label: string;
  defaultRtspPort: number;
  mainTemplate: string;
  subTemplate: string;
  notes: string;
}

const AUTH = 'rtsp://{user}:{pass}@{host}:{port}';
const REALMONITOR = (sub: 0 | 1) => `${AUTH}/cam/realmonitor?channel={channel}&subtype=${sub}`;

export const BRANDS: BrandInfo[] = [
  {
    brand: 'HIKVISION', label: 'Hikvision / Prama / HiLook', defaultRtspPort: 554,
    mainTemplate: `${AUTH}/Streaming/Channels/{channel}01`, subTemplate: `${AUTH}/Streaming/Channels/{channel}02`,
    notes: 'Channel 3 main stream is /Streaming/Channels/301, sub stream 302. RTSP is on by default (Configuration › Network › Advanced Settings › Integration Protocol for ONVIF). Use H.264 under Configuration › Video › Video Type / Encoding.',
  },
  {
    brand: 'CP_PLUS', label: 'CP Plus', defaultRtspPort: 554, mainTemplate: REALMONITOR(0), subTemplate: REALMONITOR(1),
    notes: 'Dahua-based. Main stream subtype=0, sub stream subtype=1. Check Main Menu › Network › Connection › RTSP port (554) and set the channel to H.264 under Encode.',
  },
  {
    brand: 'DAHUA', label: 'Dahua', defaultRtspPort: 554, mainTemplate: REALMONITOR(0), subTemplate: REALMONITOR(1),
    notes: 'Main stream subtype=0, sub stream subtype=1. RTSP port is under Setting › Network › Port.',
  },
  {
    brand: 'UNIVIEW', label: 'Uniview', defaultRtspPort: 554,
    mainTemplate: `${AUTH}/unicast/c{channel}/s0/live`, subTemplate: `${AUTH}/unicast/c{channel}/s1/live`,
    notes: 'Main stream s0, sub stream s1.',
  },
  {
    brand: 'GODREJ', label: 'Godrej', defaultRtspPort: 554, mainTemplate: REALMONITOR(0), subTemplate: REALMONITOR(1),
    notes: 'Most Godrej recorders use the Dahua-style realmonitor URL.',
  },
  {
    brand: 'HONEYWELL', label: 'Honeywell', defaultRtspPort: 554, mainTemplate: REALMONITOR(0), subTemplate: REALMONITOR(1),
    notes: 'Honeywell Performance-series recorders use the Dahua-style realmonitor URL.',
  },
  {
    brand: 'TIANDY', label: 'Tiandy', defaultRtspPort: 554,
    mainTemplate: `${AUTH}/{channel}/1`, subTemplate: `${AUTH}/{channel}/2`,
    notes: 'Main stream /<channel>/1, sub stream /<channel>/2.',
  },
  {
    brand: 'GENERIC_ONVIF', label: 'Other (ONVIF)', defaultRtspPort: 554,
    mainTemplate: `${AUTH}/ch{channel}/main`, subTemplate: `${AUTH}/ch{channel}/sub`,
    notes: 'The store AI box asks the recorder for the stream URL over ONVIF (GetStreamUri on the HTTP port). The template is only a fallback. Enable ONVIF and create an ONVIF user on the recorder.',
  },
  {
    brand: 'CUSTOM', label: 'Custom URL pattern', defaultRtspPort: 554, mainTemplate: '', subTemplate: '',
    notes: 'Type the URL pattern yourself. It must start with rtsp:// and contain {channel}; you can also use {user}, {pass}, {host} and {port}.',
  },
];

export const brandInfo = (brand: string): BrandInfo | undefined => BRANDS.find((b) => b.brand === brand);

export interface RecorderUrlInput {
  brand: string;
  host: string;
  rtspPort: number;
  username?: string | null;
  urlTemplate?: string | null;
}

/** JavaScript's encodeURIComponent; mirrored in Python with quote(s, safe="!'()*"). */
export const encodeCredential = (s: string) => encodeURIComponent(s);

/** IPv6 literals are bracketed inside URLs. */
export const urlHost = (host: string) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);

/** The template for a brand and stream profile (CUSTOM → the recorder's own urlTemplate). */
export function templateFor(r: Pick<RecorderUrlInput, 'brand' | 'urlTemplate'>, stream: StreamProfile | string = 'MAIN'): string {
  if (r.brand === 'CUSTOM') return r.urlTemplate ?? '';
  const b = brandInfo(r.brand) ?? brandInfo('GENERIC_ONVIF')!;
  return stream === 'SUB' ? b.subTemplate : b.mainTemplate;
}

/** Drops an empty password (`user:@` → `user@`) and an empty user-info (`rtsp://@h` → `rtsp://h`). */
function tidyUserInfo(url: string): string {
  return url.replace(/^(rtsp:\/\/)([^/@]*)@/i, (_m, scheme: string, info: string) => {
    let i = info;
    if (i.endsWith(':')) i = i.slice(0, -1);
    return i ? `${scheme}${i}@` : scheme;
  });
}

function fill(template: string, r: RecorderUrlInput, channel: number, pass: string): string {
  const values: Record<string, string> = {
    '{user}': encodeCredential(r.username ?? ''),
    '{pass}': pass,
    '{host}': urlHost(r.host),
    '{port}': String(r.rtspPort),
    '{channel}': String(Math.trunc(channel)),
  };
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.split(k).join(v);
  return tidyUserInfo(out);
}

/** The real URL (password URL-encoded) — only ever sent to the edge. */
export function buildRtspUrl(r: RecorderUrlInput, channel: number, stream: StreamProfile | string, password?: string | null): string {
  return fill(templateFor(r, stream), r, channel, password ? encodeCredential(password) : '');
}

/** The browser URL: same as the real one with the password replaced by ****. */
export function maskedRtspUrl(r: RecorderUrlInput, channel: number, stream: StreamProfile | string, hasPassword: boolean): string {
  return fill(templateFor(r, stream), r, channel, hasPassword ? PASSWORD_MASK : '');
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/;

function isIpv6(s: string): boolean {
  let h = s;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);
  if (!h.includes(':') || !/^[0-9a-fA-F:.]+$/.test(h)) return false;
  // an embedded IPv4 tail (::ffff:10.0.0.1)
  let groups = 8;
  const lastColon = h.lastIndexOf(':');
  const tail = h.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4.test(tail)) return false;
    h = h.slice(0, lastColon + 1) + '0';
    groups = 7;
  }
  const dbl = h.split('::');
  if (dbl.length > 2) return false;
  const part = (p: string) => (p === '' ? [] : p.split(':'));
  const head = part(dbl[0]);
  const rest = dbl.length === 2 ? part(dbl[1]) : [];
  const all = [...head, ...rest];
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return dbl.length === 2 ? all.length < groups : all.length === groups;
}

/** host: IPv4, IPv6 or hostname. */
export function isValidHost(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 253) return false;
  if (IPV4.test(s)) return true;
  if (s.includes(':') || s.startsWith('[')) return isIpv6(s);
  // a dotted all-numeric string that is not a valid IPv4 (e.g. 10.0.0.300) is rejected
  if (/^[\d.]+$/.test(s)) return false;
  return HOSTNAME.test(s);
}

/** CUSTOM urlTemplate: must start with rtsp:// and contain {channel}. Returns an error message or null. */
export function customTemplateError(t: unknown): string | null {
  if (typeof t !== 'string' || !t.trim()) return 'urlTemplate is required for CUSTOM recorders';
  if (!/^rtsp:\/\//i.test(t.trim())) return 'urlTemplate must start with rtsp://';
  if (!t.includes('{channel}')) return 'urlTemplate must contain {channel}';
  return null;
}
