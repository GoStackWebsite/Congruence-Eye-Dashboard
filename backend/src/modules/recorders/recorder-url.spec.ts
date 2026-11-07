import { decryptSecret, encryptSecret, tryDecryptSecret } from './recorder-crypto';
import { BRANDS, buildRtspUrl, customTemplateError, isValidHost, maskedRtspUrl, RECORDER_BRANDS } from './recorder-url';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vectors = require('./recorder-url.vectors.json');

const rec = (brand: string, extra: Record<string, unknown> = {}) => ({ brand, host: '10.0.0.20', rtspPort: 554, username: 'admin', ...extra });
const PW = 'p@ss:w/rd#1';
const ENC = 'p%40ss%3Aw%2Frd%231';

describe('recorder URL templating', () => {
  it('has a template for every brand in the contract', () => {
    expect(BRANDS.map((b) => b.brand)).toEqual([...RECORDER_BRANDS]);
    for (const b of BRANDS) {
      expect(b.defaultRtspPort).toBe(554);
      expect(b.label).toBeTruthy();
      if (b.brand !== 'CUSTOM') {
        expect(b.mainTemplate).toMatch(/^rtsp:\/\/\{user\}:\{pass\}@\{host\}:\{port\}\//);
        expect(b.mainTemplate).toContain('{channel}');
        expect(b.subTemplate).toContain('{channel}');
      }
    }
  });

  it.each([
    ['HIKVISION', 'MAIN', 3, `rtsp://admin:${ENC}@10.0.0.20:554/Streaming/Channels/301`],
    ['HIKVISION', 'SUB', 3, `rtsp://admin:${ENC}@10.0.0.20:554/Streaming/Channels/302`],
    ['HIKVISION', 'MAIN', 12, `rtsp://admin:${ENC}@10.0.0.20:554/Streaming/Channels/1201`],
    ['CP_PLUS', 'MAIN', 3, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=3&subtype=0`],
    ['CP_PLUS', 'SUB', 3, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=3&subtype=1`],
    ['DAHUA', 'MAIN', 1, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=1&subtype=0`],
    ['DAHUA', 'SUB', 16, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=16&subtype=1`],
    ['UNIVIEW', 'MAIN', 3, `rtsp://admin:${ENC}@10.0.0.20:554/unicast/c3/s0/live`],
    ['UNIVIEW', 'SUB', 3, `rtsp://admin:${ENC}@10.0.0.20:554/unicast/c3/s1/live`],
    ['GODREJ', 'MAIN', 2, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=2&subtype=0`],
    ['HONEYWELL', 'SUB', 2, `rtsp://admin:${ENC}@10.0.0.20:554/cam/realmonitor?channel=2&subtype=1`],
    ['TIANDY', 'MAIN', 3, `rtsp://admin:${ENC}@10.0.0.20:554/3/1`],
    ['TIANDY', 'SUB', 3, `rtsp://admin:${ENC}@10.0.0.20:554/3/2`],
    ['GENERIC_ONVIF', 'MAIN', 3, `rtsp://admin:${ENC}@10.0.0.20:554/ch3/main`],
    ['GENERIC_ONVIF', 'SUB', 3, `rtsp://admin:${ENC}@10.0.0.20:554/ch3/sub`],
  ])('%s %s channel %d', (brand, stream, channel, url) => {
    expect(buildRtspUrl(rec(brand), channel, stream, PW)).toBe(url);
    expect(maskedRtspUrl(rec(brand), channel, stream, true)).toBe(url.replace(ENC, '****'));
  });

  it('CUSTOM uses the recorder template, every placeholder, every occurrence', () => {
    const r = rec('CUSTOM', { urlTemplate: 'rtsp://{user}:{pass}@{host}:{port}/c{channel}/x?ch={channel}', rtspPort: 8554 });
    expect(buildRtspUrl(r, 4, 'MAIN', PW)).toBe(`rtsp://admin:${ENC}@10.0.0.20:8554/c4/x?ch=4`);
    expect(buildRtspUrl(r, 4, 'SUB', PW)).toBe(`rtsp://admin:${ENC}@10.0.0.20:8554/c4/x?ch=4`);
    expect(maskedRtspUrl(r, 4, 'MAIN', true)).toBe('rtsp://admin:****@10.0.0.20:8554/c4/x?ch=4');
  });

  it('URL-encodes credentials and brackets IPv6 hosts; drops empty credentials', () => {
    expect(buildRtspUrl(rec('HIKVISION', { username: 'a b@c' }), 1, 'MAIN', 'x/y')).toBe('rtsp://a%20b%40c:x%2Fy@10.0.0.20:554/Streaming/Channels/101');
    expect(buildRtspUrl(rec('HIKVISION', { host: '2001:db8::20' }), 1, 'MAIN', 'pw')).toBe('rtsp://admin:pw@[2001:db8::20]:554/Streaming/Channels/101');
    expect(buildRtspUrl(rec('DAHUA'), 1, 'MAIN', null)).toBe('rtsp://admin@10.0.0.20:554/cam/realmonitor?channel=1&subtype=0');
    expect(maskedRtspUrl(rec('DAHUA'), 1, 'MAIN', false)).toBe('rtsp://admin@10.0.0.20:554/cam/realmonitor?channel=1&subtype=0');
    expect(buildRtspUrl(rec('TIANDY', { username: '' }), 1, 'MAIN', '')).toBe('rtsp://10.0.0.20:554/1/1');
    // the masked URL never contains the password in any form
    const masked = maskedRtspUrl(rec('HIKVISION'), 1, 'MAIN', true);
    expect(masked).not.toContain(ENC);
    expect(masked).not.toContain(PW);
  });

  it('matches the shared vectors used by the ai-service mirror', () => {
    expect(vectors.cases.length).toBeGreaterThan(50);
    for (const c of vectors.cases) {
      expect([c.name, buildRtspUrl(c.input, c.channel, c.stream, c.password)]).toEqual([c.name, c.expected]);
      expect([c.name, maskedRtspUrl(c.input, c.channel, c.stream, !!c.password)]).toEqual([c.name, c.expectedMasked]);
    }
  });
});

describe('recorder validation helpers', () => {
  it.each(['10.0.0.20', '192.168.1.1', '0.0.0.0', 'fe80::1', '2001:db8::20', '::1', '::ffff:10.0.0.1', '[fe80::1]', 'fe80::1%eth0', 'dvr', 'dvr-tnagar.local', 'nvr1.store.congruence.in'])(
    'host %s is valid',
    (h) => expect(isValidHost(h)).toBe(true),
  );
  it.each(['', ' ', '10.0.0.300', '10.0.0', '1.2.3.4.5', 'fe80:::1', 'gggg::1', '-dvr', 'dvr_1', 'dvr..local', 'http://10.0.0.1', '10.0.0.1:554', 'a b', 'x'.repeat(254)])(
    'host %p is invalid',
    (h) => expect(isValidHost(h)).toBe(false),
  );
  it('CUSTOM template rules', () => {
    expect(customTemplateError('rtsp://{host}/ch{channel}')).toBeNull();
    expect(customTemplateError('RTSP://{host}/ch{channel}')).toBeNull();
    expect(customTemplateError('')).toMatch(/required/);
    expect(customTemplateError(null)).toMatch(/required/);
    expect(customTemplateError('http://{host}/ch{channel}')).toMatch(/rtsp:\/\//);
    expect(customTemplateError('rtsp://{host}/ch1')).toMatch(/\{channel\}/);
  });
});

describe('recorder password encryption (AES-256-GCM)', () => {
  const saved = process.env.RECORDER_SECRET;
  afterEach(() => (saved === undefined ? delete process.env.RECORDER_SECRET : (process.env.RECORDER_SECRET = saved)));

  it('round-trips, uses a random IV and never stores the plaintext', () => {
    const a = encryptSecret(PW);
    const b = encryptSecret(PW);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PW);
    expect(decryptSecret(a)).toBe(PW);
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('fails with another RECORDER_SECRET or a tampered value', () => {
    process.env.RECORDER_SECRET = 'one';
    const enc = encryptSecret('hunter2');
    process.env.RECORDER_SECRET = 'two';
    expect(() => decryptSecret(enc)).toThrow();
    expect(tryDecryptSecret(enc)).toBeNull();
    process.env.RECORDER_SECRET = 'one';
    expect(decryptSecret(enc)).toBe('hunter2');
    const raw = Buffer.from(enc.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret('v1:' + raw.toString('base64'))).toThrow();
    expect(tryDecryptSecret(null)).toBeNull();
  });
});
