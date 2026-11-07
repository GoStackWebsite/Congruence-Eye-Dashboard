# Contract v3 — DVR / NVR recorders, analog cameras, connection tests

This contract is binding, in addition to v1 and v2.

Why: most Congruence stores run analog (HD-CVI/AHD/TVI) cameras behind a DVR, or IP cameras behind an NVR. The AI service reads each recorder channel as an RTSP stream. Store teams must be able to add a recorder by brand, IP, login and channel count, without typing URLs, and test every channel from the web app. The backend lives in the cloud and cannot reach the store LAN, so the store's edge box runs all tests.

## Recorder brands
`GET /api/recorders/brands` (any authenticated user) →
`{ brand, label, defaultRtspPort, mainTemplate, subTemplate, notes }[]`

| brand | label | main / sub template |
|---|---|---|
| `HIKVISION` | Hikvision / Prama / HiLook | `rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}01` / `…/{channel}02` |
| `CP_PLUS` | CP Plus | `rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0` / `subtype=1` |
| `DAHUA` | Dahua | same as CP_PLUS |
| `UNIVIEW` | Uniview | `rtsp://{user}:{pass}@{host}:{port}/unicast/c{channel}/s0/live` / `s1` |
| `GODREJ` | Godrej | `rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0` / `subtype=1` |
| `HONEYWELL` | Honeywell | `rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0` / `subtype=1` |
| `TIANDY` | Tiandy | `rtsp://{user}:{pass}@{host}:{port}/{channel}/1` / `/{channel}/2` |
| `GENERIC_ONVIF` | Other (ONVIF) | resolved on the edge via ONVIF GetStreamUri; fallback `rtsp://{user}:{pass}@{host}:{port}/ch{channel}/main` |
| `CUSTOM` | Custom URL pattern | the recorder's own `urlTemplate` |

The placeholders are `{user}`, `{pass}` (URL-encoded), `{host}`, `{port}` and `{channel}` (1-based, no padding). Hikvision `{channel}01` means channel 3 → `301`.

## Recorders
```ts
Recorder = { id, storeId, storeName, name, kind: "DVR"|"NVR"|"HYBRID", brand, host, rtspPort, httpPort, username,
             hasPassword: boolean, channels: number /*1..64*/, stream: "MAIN"|"SUB", urlTemplate: string|null,
             status: "ONLINE"|"PARTIAL"|"OFFLINE"|"UNKNOWN", lastCheckedAt: string|null,
             camerasLinked: number, createdAt }
```
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/recorders?storeId=` | POST body: the Recorder fields plus `password`, which is write-only. ADMIN+, or STORE_MANAGER for their own store |
| GET/PATCH/DELETE | `/api/recorders/:id` | PATCH may omit `password` to keep it. DELETE is refused with 409 while cameras are linked, unless `?unlinkCameras=true` |
| POST | `/api/recorders/:id/generate-cameras` | `{ channels: number[], type?: CameraType, namePrefix?: string }` → `Camera[]`. Idempotent per channel: an already-linked channel is returned, not duplicated |
| POST | `/api/recorders/:id/test` | Starts a probe of every channel (or `{ channels }`) → `Probe[]` |

Passwords are encrypted at rest with AES-256-GCM, using the key from env `RECORDER_SECRET` (a dev default plus a warning at boot). They are never returned to the browser.

`Camera` adds `recorderId: number|null`, `channel: number|null`, `streamProfile: "MAIN"|"SUB"|null`. For a recorder-linked camera, `rtspUrl` in browser responses is the masked URL (`rtsp://admin:****@10.0.0.20:554/...`). `GET /api/ingest/config` (edge only) returns the real URL with the password, built from the template.

Validation:

- host: IPv4, IPv6 or hostname
- ports: 1–65535
- channels: 1–64
- CUSTOM requires a `urlTemplate` containing `{channel}` and starting with `rtsp://`
- channel numbers must be ≤ `channels`
- a store cannot have two recorders with the same host and port (409)

## Connection tests (probes)
```ts
Probe = { id, storeId, cameraId: number|null, recorderId: number|null, channel: number|null, status: "PENDING"|"RUNNING"|"OK"|"FAILED"|"EXPIRED",
          requestedAt, completedAt: string|null, width: number|null, height: number|null, fps: number|null, codec: string|null,
          latencyMs: number|null, error: string|null, errorCode: "AUTH"|"TIMEOUT"|"UNREACHABLE"|"NOT_FOUND"|"UNSUPPORTED_CODEC"|"EDGE_OFFLINE"|"OTHER"|null,
          snapshotUrl: string|null }
```
| Method | Path | Notes |
|---|---|---|
| POST | `/api/cameras/:id/test` | → `Probe`. If the store's edge has not been seen within `CAMERA_STALE_SEC`, the probe is returned FAILED with errorCode EDGE_OFFLINE |
| GET | `/api/probes/:id` | → `Probe`. A probe still PENDING or RUNNING after 60 s becomes EXPIRED |
| GET | `/api/probes?storeId&recorderId&cameraId` | Newest 50 |
| GET | `/api/ingest/probes` | Edge: pending probes for its store, which it marks RUNNING. Each comes with `{ id, rtspUrl (real), cameraId, recorderId, channel }` |
| POST | `/api/ingest/probes/:id` | Edge: multipart with `result` (a JSON string of the Probe result fields) and an optional `file` (JPEG snapshot). Recorder status then becomes ONLINE (all channels OK), PARTIAL or OFFLINE |

### Edge (ai-service) behaviour
- The edge polls `/api/ingest/probes` every 5 s; it polls every 1 s for 30 s after it finds one.
- To test a stream it opens it with OpenCV/FFmpeg over RTSP/TCP with a 10 s timeout, reads one frame, and reports width, height, fps and codec. Errors map to errorCode: an RTSP 401 is AUTH, a 404 is NOT_FOUND, no route is UNREACHABLE, a timeout is TIMEOUT, an undecodable stream is UNSUPPORTED_CODEC.
- `GENERIC_ONVIF` URLs are resolved with ONVIF (`onvif-zeep` or plain SOAP over HTTP to `httpPort`).
- Optional LAN discovery: `POST /ai/discover` on the edge API (WS-Discovery multicast plus RTSP port scan of the local /24, limited to 10 s) → `{ host, port, brandGuess, onvif }[]`. The edge reports results with `POST /api/ingest/discovered`, and they are listed by `GET /api/recorders/discovered?storeId` → `{ host, rtspPort, httpPort, brandGuess, onvif, seenAt }[]`.

## UI (Admin › Cameras & recorders)
- **Store page tab "Recorders":** a table showing name, brand, kind, IP:port, channels, linked cameras, status pill and last checked, plus "Add recorder".
- **Add recorder:** a drawer with fields for brand (with a logo-less label and help text), kind, name, IP/host, RTSP port (auto from brand), HTTP port, username, password, channel count and main/sub stream. For CUSTOM it shows a URL pattern field, and in every case a live preview of the channel-1 URL with the password masked. Then a "Discovered on store network" list from the edge.
- **Channels grid:** 1..N cards, each showing its linked camera name or "Not added", plus last probe status, resolution, fps and a snapshot thumbnail. You can select channels and then use "Add as cameras" (type and name prefix) and "Test selected". Tests run live with a spinner per card, then show OK (resolution, fps, snapshot) or the error with a plain-language fix:
  - AUTH: "Wrong username or password for the DVR."
  - TIMEOUT / UNREACHABLE: "The store PC cannot reach 10.0.0.20:554. Check the DVR is on the same network and RTSP is enabled."
  - NOT_FOUND: "Channel 5 has no camera or the URL pattern is wrong."
  - UNSUPPORTED_CODEC: "Switch the DVR channel to H.264."
  - EDGE_OFFLINE: "The store's AI box is offline."
- **Camera list:** each recorder-linked camera shows "DVR ch 3", and its edit drawer has a "Test connection" button.
- **Setup guidance panel:** enable RTSP on the DVR, use H.264, a 2 MP minimum (5 MP recommended for demographics), entrance camera angle, and keep the same network as the store PC.
