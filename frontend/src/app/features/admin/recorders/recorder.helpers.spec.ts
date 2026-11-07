import {
  DEFAULT_BRANDS,
  channelLabel,
  customTemplateError,
  defaultPortFor,
  fillTemplate,
  isTerminal,
  isValidChannels,
  isValidHost,
  isValidPort,
  previewUrl,
  probeErrorMessage,
  resolutionLabel,
  templateFor,
  validateRecorder,
  RecorderFormValue,
} from './recorder.helpers';

const parts = { user: 'admin', pass: 'p@ss:w/rd', host: '10.0.0.20', port: 554, channel: 3 };

describe('recorder URL templating', () => {
  it('fills the Hikvision {channel}01 pattern without padding (channel 3 → 301)', () => {
    const t = templateFor('HIKVISION', 'MAIN', DEFAULT_BRANDS, null)!;
    expect(fillTemplate(t, { ...parts, pass: 'secret' })).toBe('rtsp://admin:secret@10.0.0.20:554/Streaming/Channels/301');
    expect(fillTemplate(templateFor('HIKVISION', 'SUB', DEFAULT_BRANDS, null)!, { ...parts, pass: 'secret', channel: 12 })).toBe(
      'rtsp://admin:secret@10.0.0.20:554/Streaming/Channels/1202',
    );
  });

  it('URL-encodes the user and password', () => {
    const t = templateFor('CP_PLUS', 'MAIN', DEFAULT_BRANDS, null)!;
    expect(fillTemplate(t, { ...parts, user: 'store user' })).toBe('rtsp://store%20user:p%40ss%3Aw%2Frd@10.0.0.20:554/cam/realmonitor?channel=3&subtype=0');
  });

  it('masks the password in previews and brackets IPv6 hosts', () => {
    const t = templateFor('DAHUA', 'SUB', DEFAULT_BRANDS, null)!;
    expect(fillTemplate(t, { ...parts, host: 'fe80::1' }, true)).toBe('rtsp://admin:****@[fe80::1]:554/cam/realmonitor?channel=3&subtype=1');
  });

  it('covers every brand in the contract (Uniview, Tiandy, ONVIF fallback, CUSTOM)', () => {
    expect(fillTemplate(templateFor('UNIVIEW', 'MAIN', DEFAULT_BRANDS, null)!, parts, true)).toBe('rtsp://admin:****@10.0.0.20:554/unicast/c3/s0/live');
    expect(fillTemplate(templateFor('TIANDY', 'SUB', DEFAULT_BRANDS, null)!, parts, true)).toBe('rtsp://admin:****@10.0.0.20:554/3/2');
    expect(fillTemplate(templateFor('GENERIC_ONVIF', 'MAIN', DEFAULT_BRANDS, null)!, parts, true)).toBe('rtsp://admin:****@10.0.0.20:554/ch3/main');
    expect(templateFor('CUSTOM', 'MAIN', DEFAULT_BRANDS, '  ')).toBeNull();
    expect(fillTemplate(templateFor('CUSTOM', 'MAIN', DEFAULT_BRANDS, 'rtsp://{host}:{port}/live/{channel}')!, parts)).toBe('rtsp://10.0.0.20:554/live/3');
  });

  it('prefers the API brand list over the built-in table', () => {
    const api = [{ ...DEFAULT_BRANDS[0], mainTemplate: 'rtsp://{host}/h{channel}', defaultRtspPort: 8554 }];
    expect(templateFor('HIKVISION', 'MAIN', api, null)).toBe('rtsp://{host}/h{channel}');
    expect(defaultPortFor('HIKVISION', api)).toBe(8554);
    expect(defaultPortFor('CP_PLUS', [])).toBe(554);
  });

  it('previews channel 1 with the stored password masked and placeholders for missing parts', () => {
    const v = { username: 'admin', password: '', host: '', rtspPort: 554, urlTemplate: null };
    expect(previewUrl('HIKVISION', 'MAIN', DEFAULT_BRANDS, v)).toBe('rtsp://admin:@<ip>:554/Streaming/Channels/101');
    expect(previewUrl('HIKVISION', 'MAIN', DEFAULT_BRANDS, { ...v, host: '192.168.1.64', hasPassword: true })).toBe('rtsp://admin:****@192.168.1.64:554/Streaming/Channels/101');
    expect(previewUrl('CUSTOM', 'MAIN', DEFAULT_BRANDS, v)).toBeNull();
  });
});

describe('recorder validation', () => {
  it('accepts IPv4, IPv6 and hostnames; rejects bad ones', () => {
    for (const h of ['10.0.0.20', '192.168.1.64', 'dvr.store.local', 'nvr-01', 'fe80::1', '2001:db8::8a2e:370:7334', '::1', '::ffff:10.0.0.1', '[fe80::1]']) expect(isValidHost(h), h).toBe(true);
    for (const h of ['', ' ', '256.1.1.1', '10.0.0', '10.0.0.1.5', 'bad host', 'dvr_01', '-dvr', 'fe80:::1', '1:2:3:4:5:6:7:8:9', 'http://10.0.0.1']) expect(isValidHost(h), h).toBe(false);
  });
  it('ports are 1–65535 and channels 1–64 (whole numbers)', () => {
    expect([1, 554, 65535, '8000'].every(isValidPort)).toBe(true);
    expect([0, 65536, -1, 5.5, '', null, 'abc'].some(isValidPort)).toBe(false);
    expect([1, 16, 64].every(isValidChannels)).toBe(true);
    expect([0, 65, 2.5, '', null].some(isValidChannels)).toBe(false);
  });
  it('validates the CUSTOM pattern', () => {
    expect(customTemplateError('')).toMatch(/Enter the URL pattern/);
    expect(customTemplateError('http://{host}/{channel}')).toMatch(/start with rtsp/);
    expect(customTemplateError('rtsp://{host}/live')).toMatch(/\{channel\}/);
    expect(customTemplateError('rtsp://{host}/{chan}/{channel}')).toMatch(/Unknown placeholder \{chan\}/);
    expect(customTemplateError('rtsp://{user}:{pass}@{host}:{port}/c{channel}')).toBeNull();
  });
  it('collects field errors for the form', () => {
    const v: RecorderFormValue = { name: '', brand: 'CUSTOM', kind: 'DVR', host: '999.1.1.1', rtspPort: 0, httpPort: 70000, username: '', password: '', channels: 65, stream: 'MAIN', urlTemplate: 'rtsp://x' };
    expect(Object.keys(validateRecorder(v, true)).sort()).toEqual(['channels', 'host', 'httpPort', 'name', 'password', 'rtspPort', 'urlTemplate', 'username']);
    const ok: RecorderFormValue = { ...v, name: 'Main DVR', brand: 'HIKVISION', host: '10.0.0.20', rtspPort: 554, httpPort: null, username: 'admin', channels: 16 };
    expect(validateRecorder(ok, false)).toEqual({});
    expect(validateRecorder(ok, true)).toEqual({ password: 'Password is required' });
  });
});

describe('connection test messages', () => {
  it('maps every error code to the contract wording', () => {
    const ctx = { host: '10.0.0.20', port: 554, channel: 5 };
    expect(probeErrorMessage('AUTH', ctx)).toBe('Wrong username or password for the DVR.');
    expect(probeErrorMessage('TIMEOUT', ctx)).toBe('The store PC cannot reach 10.0.0.20:554. Check the DVR is on the same network and RTSP is enabled.');
    expect(probeErrorMessage('UNREACHABLE', ctx)).toBe(probeErrorMessage('TIMEOUT', ctx));
    expect(probeErrorMessage('NOT_FOUND', ctx)).toBe('Channel 5 has no camera or the URL pattern is wrong.');
    expect(probeErrorMessage('UNSUPPORTED_CODEC', ctx)).toBe('Switch the DVR channel to H.264.');
    expect(probeErrorMessage('EDGE_OFFLINE', ctx)).toBe("The store's AI box is offline.");
    expect(probeErrorMessage('OTHER', ctx)).toMatch(/test failed/);
    expect(probeErrorMessage(null, { ...ctx, status: 'EXPIRED' })).toMatch(/did not answer within a minute/);
  });
  it('knows terminal states, labels resolution and channels', () => {
    expect(['OK', 'FAILED', 'EXPIRED'].every((s) => isTerminal(s as never))).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(isTerminal(null)).toBe(false);
    expect(resolutionLabel(1920, 1080)).toBe('1920×1080 · 1080p');
    expect(resolutionLabel(2592, 1944)).toBe('2592×1944 · 5MP');
    expect(resolutionLabel(1280, 720)).toBe('1280×720 · 720p (low)');
    expect(resolutionLabel(null, 1080)).toBeNull();
    expect(channelLabel('DVR', 3)).toBe('DVR ch 3');
    expect(channelLabel('NVR', 12)).toBe('NVR ch 12');
    expect(channelLabel('DVR', null)).toBeNull();
  });
});
