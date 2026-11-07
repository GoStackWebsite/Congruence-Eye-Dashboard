import { Camera } from '../cameras/entities/camera.entity';
import { Recorder } from './entities/recorder.entity';
import { tryDecryptSecret } from './recorder-crypto';
import { buildRtspUrl, maskedRtspUrl } from './recorder-url';

/** Stream profile a linked camera uses (its own, else the recorder default). */
export const profileOf = (c: Pick<Camera, 'streamProfile'> | null | undefined, r: Recorder) => c?.streamProfile || r.stream || 'MAIN';

/** The browser-facing (masked) URL of a recorder channel. This is what cameras.rtspUrl stores for linked cameras. */
export const maskedChannelUrl = (r: Recorder, channel: number, profile: string) => maskedRtspUrl(r, channel, profile, !!r.passwordEnc);

/** The real URL with the decrypted password — only for the edge (ingest config and probe claims). */
export const realChannelUrl = (r: Recorder, channel: number, profile: string) => buildRtspUrl(r, channel, profile, tryDecryptSecret(r.passwordEnc));

/** ONVIF connection details the edge needs to resolve GENERIC_ONVIF stream URLs (edge only). */
export function onvifInfo(r: Recorder) {
  if (r.brand !== 'GENERIC_ONVIF') return null;
  return { host: r.host, httpPort: r.httpPort, username: r.username, password: tryDecryptSecret(r.passwordEnc) ?? '' };
}

/** Extra camera fields in GET /api/ingest/config (edge): real rtspUrl + recorder details. */
export function edgeCameraFields(c: Camera, recorders: Map<number, Recorder>) {
  const r = c.recorderId ? recorders.get(c.recorderId) : undefined;
  if (!r || !c.channel) return {};
  const profile = profileOf(c, r);
  return {
    rtspUrl: realChannelUrl(r, c.channel, profile),
    recorder: { id: r.id, brand: r.brand, kind: r.kind, host: r.host, rtspPort: r.rtspPort, httpPort: r.httpPort, stream: profile },
    onvif: onvifInfo(r),
  };
}
