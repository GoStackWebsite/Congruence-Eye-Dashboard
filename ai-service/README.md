# Congruence Eye — AI vision service

The edge component of Congruence Eye, Congruence's in-store CCTV analytics platform (modelled on Tango Eye).
Each store runs one instance on an edge box or a server. The instance reads the store's CCTV streams, finds
and tracks people (YOLO + ByteTrack), turns their movement into retail events, and pushes those events to the
backend ingestion API (`/api/ingest/*`, see `../docs/API_CONTRACT.md` and `../docs/API_CONTRACT_V2.md`).

Contract v2 adds three things here. The **AI Manager** detectors watch CCTV for checklist rules
(mobile-phone use, unattended customers, store open/close, hygiene, huddles, uniform compliance,
stock-outs and long queues) and post detections with annotated snapshots. **AI-in-Checklist**
endpoints compare checklist photos with a reference image and check staff grooming. **Snapshots**
of every kind feed the Image Directory and the daily recap video.

Contract v3 (`../docs/API_CONTRACT_V3_RECORDERS.md`) adds **DVR / NVR recorders**: the edge runs the web app's
connection tests on the store LAN (RTSP open, one decoded frame, snapshot, error codes), resolves ONVIF stream
URLs and discovers recorders on the network (section 6).

```
 RTSP / file ─► CameraWorker (1 thread per camera)
                  capture → frame skip (TARGET_FPS) → YoloDetector.track (ByteTrack: person, + cell phone if a MOBILE_USAGE rule exists)
                  └► CameraProcessor (pure logic, unit tested)
                       LineCounter ─ ENTRY/EXIT (+ store dwell via StoreDwellTracker)
                       ZoneTracker ─ ZONE_ENTER/ZONE_EXIT (+ dwell)
                       QueueMonitor ─ QueueSnapshot every 30 s, COUNTER_UNATTENDED
                       GroupDetector ─ groupId for people entering together
                       StaffClassifier ─ uniform colour / staff-only zone → isStaff
                       ReIdGallery ─ visitorId shared across the store's cameras
                       DemographicsVoter ─ gender + age band (optional plugin)
                       HeatmapAccumulator ─ 32×18 grid every HEATMAP_SEC
                       CameraAiManager ─ AI Manager detectors driven by config.aiManagerRules
                  StoreAiManager (store-wide) ─ window rules (huddle, hygiene), open/close detections
                  StoreOpsMonitor (store-wide) ─ STORE_OPENED/CLOSED, LIGHTS_OFF, CAMERA_TAMPER, STAFF_ABSENT, SOP_BREACH
                  CameraHealth ─ ONLINE/OFFLINE + fps → heartbeat
            └► BackendSink → SQLite spool (write-ahead) → BackendClient sender thread → backend
                  (snapshot bundles: upload JPEG → snapshotId → storeops / detections)
 ProbePoller ─ GET /api/ingest/probes (5 s, 1 s bursts) → RtspProber (ffmpeg, RTSP/TCP, 10 s) → POST /api/ingest/probes/:id
 FastAPI :8000  /health  /status  /cameras/{id}/preview.jpg  /reload-config
                /ai/checklist/reference-match  /ai/checklist/uniform  /ai/shelves/{zoneId}/reference  /ai/discover
```

## Contents

| Path | Purpose |
|---|---|
| `congruence_eye_ai/config.py` | All settings (env vars / `.env`) |
| `congruence_eye_ai/schemas.py` | Pydantic copies of the ingestion contract (camelCase payloads) |
| `congruence_eye_ai/backend_client.py`, `spool.py` | HTTP client with retries, durable SQLite outbox, ordered replay, batching up to 5000; every batch carries a stable `X-Batch-Id` (persisted with the rows, reused on retry/restart) so the backend drops replays instead of double counting |
| `congruence_eye_ai/detector.py` | `Detector` protocol, `YoloDetector`, `FakeDetector`, `ScriptedDetector` |
| `congruence_eye_ai/geometry.py` | Normalised coordinates, point in polygon, segment intersection, side of line |
| `congruence_eye_ai/analytics/` | Line counter, zones, queue, groups, staff, re-ID, demographics, heatmap, store ops, camera health |
| `congruence_eye_ai/processor.py` | Per-camera analytics that turn tracks into contract payloads |
| `congruence_eye_ai/camera_worker.py`, `store_runner.py` | Capture threads, reconnection, config refresh, heartbeats |
| `congruence_eye_ai/main.py` | FastAPI app and the `run` entry point |
| `congruence_eye_ai/aimanager/` | AI Manager: rule schedules (`rules.py`), per-camera detectors (`detectors.py`), store-level window rules and open/close (`store.py`), shelf emptiness (`shelf.py`) |
| `congruence_eye_ai/recorders/` | Contract v3 DVR / NVR support: URL templates (`urls.py`, mirror of the backend), ONVIF GetStreamUri (`onvif.py`), RTSP connection tests (`prober.py`), the probe poller (`poller.py`) and LAN discovery (`discovery.py`) |
| `congruence_eye_ai/checklist/` | AI-in-Checklist: `reference_match.py`, `uniform_check.py`, FastAPI router `api.py` |
| `congruence_eye_ai/simulate.py`, `sim_render.py` | Synthetic store simulator (scenario + CCTV-like renderer) used for demos and E2E tests |
| `scripts/download_models.sh` | Downloads the YOLO weights and the optional demographics models into `models/` |
| `tests/` | pytest suite (needs no network). The YOLO and demographics tests are skipped when their weights are missing |

## 1. Set up cameras and zones in the web app

All camera and zone configuration lives in the backend. Each edge box downloads it with `GET /api/ingest/config`,
refreshes it every 5 minutes, and also reloads it on `POST /reload-config` or `SIGHUP`. When a configuration
changes, the box restarts only the cameras whose settings or zones changed.

1. **Admin → Stores**: set the store's opening/closing times and timezone. The open/close detection and the
   business-hours rules use them.
2. **Admin → Cameras**: add each camera with its RTSP URL (see section 6) and its type (ENTRANCE / ZONE / BILLING / GENERAL).
3. **Admin → Zones**: draw zones on the camera snapshot. All coordinates are normalised to 0..1, with (0,0) at the top-left.
   - **ENTRY_LINE**: exactly 2 points, drawn across the doorway on the floor. `inDirection` is the screen direction
     (UP/DOWN/LEFT/RIGHT) a person moves in when they *enter* the store. The service uses the person's foot point
     (the bottom-centre of the box), so draw the line where feet cross it, not at head height.
   - **SECTION**: a floor polygon for a department or fixture. It produces ZONE_ENTER/ZONE_EXIT with dwell.
     `engagedDwellSec` is the dwell the backend counts as "engaged".
   - **QUEUE**: the floor area where customers wait at a billing counter.
   - **STAFF_ONLY**: the area behind the counter. If anyone stands there, the counter counts as staffed. In
     `mark_staff` mode (the default), a person who stays there for 5 s becomes staff. In `breach` mode, a person
     there who is not wearing the uniform raises an SOP_BREACH. Positions inside a QUEUE polygon are ignored for
     this, so polygons that overlap do not turn customers into staff.
   - **SHELF**: the shelf face to watch for stock-outs. Draw it tightly around the products, and keep people
     out of the view if you can.
4. **Admin → Edge devices**: create a device for the store and copy its API key into `EDGE_API_KEY`. The dev seed key is
   `dev-edge-key-store-<storeId>`, for example `dev-edge-key-store-1` for T Nagar.

5. **AI Manager → Rules**: choose the rule type, stores, detection areas (zones), time window, days and
   params. Edge boxes pick up changes on the next config refresh, which happens every 5 minutes or on
   `POST /reload-config`.

## 2. Install

```bash
cd ai-service
python3 -m venv .venv && . .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # CPU wheels (small)
pip install -r requirements.txt
scripts/download_models.sh            # models/yolo11n.pt + optional age/gender models
cp .env.example .env                  # set BACKEND_URL, EDGE_API_KEY, MODEL_PATH=models/yolo11n.pt
```

If `download.pytorch.org` is blocked, use `pip install torch torchvision` from PyPI instead. That build is larger
because it includes CUDA, but it works on CPU. OpenCV is pinned to `<5` because OpenCV 5 removed the Caffe importer
that the demographics models need.

**Model download.** The weights are not in git. Run `scripts/download_models.sh` when you deploy; the Dockerfile
also runs it during `docker build`. The script fetches `yolo11n.pt` from the Ultralytics GitHub releases. Use
`--yolo yolo11s.pt` for higher accuracy on a GPU, or `--no-demographics` to skip the age/gender models. If
`MODEL_PATH` points to a file that doesn't exist, Ultralytics tries to download that model name itself.

## 3. Run

```bash
python -m congruence_eye_ai run          # store runner + API on :8000
curl localhost:8000/status               # per-camera status, fps, counts, queue state, spool backlog
open http://localhost:8000/cameras/1/preview.jpg   # latest frame with lines, zones and tracks drawn
curl -X POST localhost:8000/reload-config
python -m congruence_eye_ai api          # API only (AI-in-Checklist endpoints), no cameras
```

The backend calls the AI-in-Checklist endpoints at `settings.aiServiceUrl`, which defaults to
`http://localhost:8000`. They work on any instance, `run` or `api`. A single central `api` instance
can serve every store.

`Ctrl-C` or `SIGTERM` shuts down cleanly. Camera threads stop, open zone visits are closed, entries still
waiting for group detection are released, the last heatmap window is flushed, everything is written to the spool,
and the service makes a final attempt to deliver it.

To test without cameras, point camera ids at video files:
`CAMERA_SOURCE_OVERRIDES='{"1":"/videos/entrance.mp4"}'`. The file plays in real time and loops.

### Docker

```bash
docker build -t congruence-eye-ai .
docker run -d --restart unless-stopped --name ce-ai -p 8000:8000 \
  -e BACKEND_URL=https://eye.congruence.in -e EDGE_API_KEY=... -v ce-spool:/data congruence-eye-ai
```

Keep `/data` on a persistent volume; it holds the offline spool.

## 4. Edge hardware

| Box | Guidance |
|---|---|
| **Intel NUC / mini PC (i5/i7, 16 GB)** | `yolo11n` at `IMGSZ=640` runs at roughly 15–25 inferences/s on CPU. That covers about 4–6 cameras at `TARGET_FPS=4`. For more speed, export to OpenVINO (`yolo export model=models/yolo11n.pt format=openvino`) and set `MODEL_PATH=models/yolo11n_openvino_model/`. Use the cameras' **sub-stream** (720p or D1). |
| **NVIDIA Jetson Orin Nano/NX** | Install JetPack's torch wheels, then `pip install ultralytics`. Export to TensorRT (`format=engine half=True`) and set `DEVICE=0`. A box handles 8–16 cameras. |
| **Server with an NVIDIA GPU** | Build with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124`, run with `--gpus all -e DEVICE=0`, and consider `yolo11s.pt`. One instance per store (one API key per store); several instances can share a GPU. |

Ways to lower the load: reduce `TARGET_FPS` (3–5 is enough for counting), reduce `IMGSZ` (480), and use sub-streams.

## 4a. AI Manager (CCTV-driven checklists)

Rules come from `GET /api/ingest/config` → `aiManagerRules`. Each rule has a type, `windowStart`–`windowEnd`
(store-local time; a window that crosses midnight is supported), `daysOfWeek` (0 = Sunday; empty = every
day), `zoneIds` and `params`. `zoneIds` are the detection areas: an empty list means the whole frame on every
camera, and a camera with none of the listed zones skips the rule. Params default to the contract values.

- **Instant rules** report one BREACHED detection per incident.
- **Window rules** (huddle, hygiene) report exactly one COMPLIED or BREACHED per store per window.
- **Cooldown.** After a breach, the same rule on the same camera stays quiet for `AI_COOLDOWN_SEC` (600 s).
- **Evidence.** Every detection uploads an annotated JPEG (`kind=AI_MANAGER`, with red/green boxes, cell
  overlays and a caption) through `/api/ingest/snapshot`. It then posts `/api/ingest/detections` with the
  returned `snapshotId`.
- **Delivery.** Snapshots and detections are spooled together as one bundle. Progress is saved after each
  step, so a retry never uploads a snapshot twice.

| Type | Logic (all thresholds are params, defaults in brackets) |
|---|---|
| `MOBILE_USAGE` | A YOLO *cell phone* box (COCO 67, conf ≥ `PHONE_CONF` 0.25) covers at least 50 % of a person's upper-body/hands region: the box widened by 15 % on each side, top 75 % of its height. The phone must be held for ≥ `minDurationSec` [20], with detection gaps of up to 3 s allowed. With `staffOnly` [true], only staff count. |
| `UNATTENDED_CUSTOMER` | A non-staff person inside the area has no staff member within `staffRadius` [0.15, normalised foot distance] for ≥ `minDurationSec` [120]. People standing in QUEUE zones are excluded. |
| `STORE_OPEN_CLOSE` | Built on the store-ops monitor. STORE_OPENED/STORE_CLOSED are sent with an OPENING/CLOSING snapshot (`snapshotId` set on the store-ops event). A detection is posted too: COMPLIED when the time is within `toleranceMin` [10] of the scheduled time, otherwise BREACHED (late or early). |
| `HYGIENE_CLEANING` | The area is split into a 16×9 grid of cells. During the window, each cell a staff member's foot passes through counts as covered. At window end the detection is COMPLIED if coverage ≥ `minCoveragePct` [60] across all cameras, else BREACHED. The snapshot shows covered cells in green and missed cells in red. |
| `HUDDLE_MEETING` | ≥ `minPeople` [3] staff stand within `radius` [0.2] of one member for ≥ `minDurationMin` [5], with gaps of up to 5 s allowed. That reports COMPLIED immediately. If it never happens, BREACHED is reported at window end. |
| `UNIFORM_COMPLIANCE` | Someone in a STAFF_ONLY zone (or the rule's areas) whose torso does not match the uniform colour (at least 3 frames seen, < 50 % of them positive) for ≥ `minNonCompliantSec` [60]. Brief steps outside the area don't reset the timer. |
| `STOCK_OUT` | SHELF zones are checked every `SHELF_CHECK_SEC` [30 s] while the lights are on. The polygon is split into 8×2 cells, and each cell's vertical-edge density is compared with a "full shelf" reference. A cell counts as empty below 35 % of its reference density. Cells hidden by people are skipped, and at least 50 % of the shelf must be visible. Two consecutive checks with emptiness ≥ `emptyPct` [70] report BREACHED. The rule re-arms after restocking (emptiness more than 15 points below `emptyPct`). |
| `QUEUE_BREACH` | Queue length in a QUEUE zone stays > `maxQueue` [5] for ≥ `minDurationSec` [10]. Re-arms once the queue drops back. |

**Shelf references.** The edge cannot download snapshots, so it captures its own "full shelf" reference.
It takes the first clear, lit view of each SHELF zone, uploads it as a `REFERENCE` snapshot and stores the
cell densities in `SPOOL_DIR/shelf_references.json`. A new reference is captured automatically when the
polygon or `referenceSnapshotId` changes. Run `POST /ai/shelves/{zoneId}/reference` to re-capture after a
planogram change.

**Snapshots.**

| Kind | When it is sent |
|---|---|
| `PERIODIC` | Every `SNAPSHOT_SEC` per camera. These feed the Image Directory and the recap video. |
| `OPENING` / `CLOSING` | With the STORE_OPENED / STORE_CLOSED events. |
| `AI_MANAGER` | Evidence for a detection. |
| `REFERENCE` | When a shelf reference is captured. |

Periodic snapshots are spooled, with their own cap (`SPOOL_MAX_SNAPSHOTS`).

## 4b. AI-in-Checklist endpoints

Both endpoints take multipart form data and return the contract's `AiCheckResult`:
`{ status: PASS|FAIL, score 0..1, message, issues[], annotatedJpegBase64 }`. They accept JPEG, PNG and WebP.
An unreadable image returns 422. Results are deterministic, because RANSAC uses a fixed seed.

**`POST /ai/checklist/reference-match`** (`image`, `reference`). Both images are resized to 800 px, then
checked in this order:

1. **Clarity.** If the Laplacian variance is < 60, or < 25 % of the reference's, the result is FAIL
   "Submitted image is not clear".
2. **Alignment.** ORB features are matched (AKAZE as fallback) with a ratio test of 0.75, followed by a RANSAC
   homography. Fewer than 15 inliers gives FAIL "Submitted image does not match the reference".
3. **Framing.** The photo must show ≥ 60 % of the reference area; otherwise it is zoomed in or cropped. The
   reference must fill ≥ 20 % of the photo; otherwise it was taken from too far. Both fail as "not clear".
4. **Comparison.**
   - The photo is warped onto the reference and its exposure is normalised.
   - A difference map is built from SSIM and Lab chroma, blurred over 15 px and thresholded at 0.25.
   - Regions covering ≥ 1 % of the image are drawn as red boxes on the photo.
   - A region where the reference had clearly more edges is labelled **"Element not found as per reference"**
     (for example, a poster that is not displayed). Any other region is labelled "Element changed vs
     reference".
   - A photo with any such region fails, with its score capped at 0.6.

**`POST /ai/checklist/uniform`** (`image`, optional `uniformHsv` JSON such as
`[[80,120,60],[95,255,255]]` or a list of ranges; defaults to `STAFF_UNIFORM_HSV`).

1. **People.** YOLO finds person boxes (conf ≥ 0.4 and ≥ 25 % of the photo's height). With no model, or when
   nobody is found, the whole photo is treated as one person.
2. **Uniform colour.** At least 35 % of the torso must be in the uniform colour range. Otherwise the issue is
   "Uniform colour not matched".
3. **ID card / lanyard.** The service looks at the chest for things that aren't the shirt colour:
   - an *ID card*: a compact, rectangular, contrasting blob covering 0.8–15 % of the chest, with an aspect
     ratio of 0.45–1.9 and a fill of ≥ 60 %;
   - a *lanyard*: a thin strap at least 30 % of the chest's height.

   If it finds neither, the issue is "ID card not detected".
4. **Verdict.** The photo is "Groomed" (PASS) only when every person passes both checks; otherwise "Not
   Groomed" (FAIL). Score = mean of 0.6 × min(1, ratio ÷ 0.35) + 0.4 × (1 if an ID card or lanyard is found,
   else 0).

## 5. Settings (env vars)

Every field in `config.py` can be overridden; see `.env.example`. The most important:

| Var | Default | Meaning |
|---|---|---|
| `BACKEND_URL`, `EDGE_API_KEY` | `http://localhost:3000`, `dev-edge-key-store-1` | Backend and store key |
| `MODEL_PATH`, `CONF`, `DEVICE`, `IMGSZ` | `yolo11n.pt`, 0.35, cpu, 640 | Detector |
| `TARGET_FPS` | 5 | Frames analysed per second per camera |
| `HEARTBEAT_SEC` / `FLUSH_SEC` / `SNAPSHOT_SEC` / `HEATMAP_SEC` / `QUEUE_SNAPSHOT_SEC` | 30 / 5 / 60 / 300 / 30 | Periodic outputs |
| `SPOOL_DIR`, `SPOOL_MAX_ROWS` | `./spool`, 200000 | Offline outbox |
| `STAFF_UNIFORM_HSV` | `[[[80,120,60],[95,255,255]]]` (teal) | Congruence uniform colour as OpenCV HSV ranges (H 0–179). Several ranges are allowed. |
| `STAFF_ZONE_MODE` | `mark_staff` | `mark_staff` or `breach` (see section 1) |
| `ENABLE_DEMOGRAPHICS`, `MODELS_DIR` | true, `./models` | Age/gender plugin. If its models are missing, it reports `U` |
| `COUNTER_UNATTENDED_SEC`, `STAFF_ABSENT_SEC` | 60, 900 | Store-ops rules |
| `CAMERA_SOURCE_OVERRIDES` | – | `{"<cameraId>": "<file or rtsp>"}` or `1=/a.mp4,2=rtsp://…` |
| `AI_COOLDOWN_SEC`, `SHELF_CHECK_SEC`, `PHONE_CONF` | 600, 30, 0.25 | AI Manager tuning |
| `SPOOL_MAX_SNAPSHOTS`, `CHECKLIST_USE_YOLO` | 2000, true | Snapshot spool cap; YOLO person boxes for the uniform check |
| `PROBE_ENABLED`, `PROBE_POLL_SEC`, `PROBE_BURST_POLL_SEC`, `PROBE_BURST_WINDOW_SEC` | true, 5, 1, 30 | Connection-test polling (contract v3) |
| `PROBE_TIMEOUT_SEC`, `PROBE_CONCURRENCY`, `FFMPEG_PATH`, `ONVIF_TIMEOUT_SEC` | 10, 4, ffmpeg on PATH, 5 | Connection tests |
| `DISCOVERY_ENABLED`, `DISCOVERY_TIMEOUT_SEC`, `DISCOVERY_INTERVAL_SEC`, `DISCOVERY_SUBNET`, `DISCOVERY_PORTS`, `DISCOVERY_WS_ENABLED` | true, 10, 3600, own /24, `[554]`, true | LAN discovery |

**Calibrating the uniform colour.** Grab a preview frame with a staff member in it. Read the HSV values of the
shirt with OpenCV (`cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)`), then set a range of about ±8 on H and generous S/V
bounds. A track becomes staff once at least 3 frames show ≥35 % uniform pixels on the torso. After that it stays
staff ("sticky").

## 6. DVR / NVR recorders and RTSP URLs (contract v3)

Most stores run analog HD-CVI / AHD / TVI cameras behind a **DVR**, or IP cameras behind an **NVR**. You do not
type URLs: in the web app (**Admin › Cameras & recorders › Recorders**) add the recorder by brand, IP, login and
channel count, then "Add as cameras" for the channels you need. The backend builds each channel's URL from the
brand template, keeps the password encrypted, shows browsers a masked URL and sends the real one only to this edge
box (`GET /api/ingest/config`). The backend cannot reach the store LAN, so **this edge box runs every connection
test** the web app asks for.

### Brands and URL templates

`{user}` and `{pass}` are URL-encoded (`p@ss:w/rd#1` → `p%40ss%3Aw%2Frd%231`), `{channel}` is 1-based with no padding.

| Brand | Main stream | Sub stream | Example: channel 3 |
|---|---|---|---|
| `HIKVISION` (Hikvision / Prama / HiLook) | `rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}01` | `…/{channel}02` | `rtsp://admin:****@10.0.0.20:554/Streaming/Channels/301` |
| `CP_PLUS`, `DAHUA`, `GODREJ`, `HONEYWELL` | `rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0` | `subtype=1` | `…/cam/realmonitor?channel=3&subtype=0` |
| `UNIVIEW` | `rtsp://{user}:{pass}@{host}:{port}/unicast/c{channel}/s0/live` | `s1` | `…/unicast/c3/s0/live` |
| `TIANDY` | `rtsp://{user}:{pass}@{host}:{port}/{channel}/1` | `/{channel}/2` | `…/3/1` |
| `GENERIC_ONVIF` | ONVIF `GetStreamUri` on the recorder's HTTP port (WS-Security digest login); fallback `…/ch{channel}/main` | `…/ch{channel}/sub` | channel 3 = the 3rd video source; MAIN = its 1st profile, SUB = its 2nd |
| `CUSTOM` | the recorder's own pattern, e.g. `rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}` | same | |

`congruence_eye_ai/recorders/urls.py` mirrors `backend/src/modules/recorders/recorder-url.ts`. The tests check both
against the same vectors and a randomised cross-check (unicode and URL-special characters).

### Enabling RTSP on the recorder

- **Hikvision / Prama / HiLook DVR or NVR:** RTSP is on by default on port 554 (*Configuration › Network › Basic
  Settings › Port*, "RTSP Port"). On newer firmware also check *Configuration › Network › Advanced Settings ›
  Integration Protocol*: enable ONVIF if you want discovery to see the recorder, and set *RTSP Authentication* to
  "digest/basic". Use an operator or a dedicated viewer user rather than `admin` if you can.
- **CP Plus (and Dahua-based Godrej / Honeywell):** the local menu *Main Menu › Network › TCP/IP › Port* (or the web
  UI *Setup › Network › Connection*) shows RTSP port 554. Enable *Main Menu › Network › Platform Access › ONVIF* for
  discovery. Some firmware also needs *System › Safety › Enable RTSP* ticked.
- **Same network:** the edge box must be on the recorder's LAN (or routed to it). The web app's error "The store
  PC cannot reach 10.0.0.20:554" means TCP to that port failed (wrong IP, another VLAN, or RTSP disabled).

### Codec, resolution and bandwidth

- **H.264 vs H.265.** Use **H.264** on every channel you analyse (*Configuration › Video/Audio* on Hikvision,
  *Main Menu › Camera › Encode* on CP Plus). H.265/H.265+ and "Smart Codec" save disk, but they decode 2–3× slower on
  a CPU edge box, and some firmware sends streams FFmpeg cannot decode. Such a channel tests as
  **UNSUPPORTED_CODEC**. Turn off H.264+ / Smart Codec on the analysed channels as well.
- **Analog (HD-CVI / AHD / TVI) cameras:** a **2 MP** (1080p) camera is the minimum; **5 MP** is recommended for
  demographics on the entrance camera. Older 720p / 960H analog cameras give too few pixels per face. Set the DVR
  channel to the camera's native resolution, not the "Auto" or "lite" modes that halve the width.
- **Sub-stream for bandwidth.** The edge only needs 4–5 analysed fps. Choose stream **SUB** for floor, billing and
  queue cameras (D1 / 720p, 10–15 fps, 512–1024 kbps), and **MAIN** only for the entrance camera when you use
  demographics. A 16-channel NVR on main streams can saturate the recorder's uplink and the edge CPU.
- **Entrance angle:** mount the camera inside, facing the door, at 2.4–3 m, tilted down 30–45°, so the door line
  sits in the lower half of the frame.

### Connection tests (probes)

- `ProbePoller` polls `GET /api/ingest/probes` every `PROBE_POLL_SEC` (5 s). After it finds work it polls every
  1 s for 30 s. Up to `PROBE_CONCURRENCY` (4) channels are tested at once.
- `RtspProber` runs `ffmpeg -rtsp_transport tcp -timeout 10000000 -i <url> -frames:v 1 …` (10 s), so a test proves
  the stream **decodes**, not just that the port is open. It reports width, height, fps, codec, latency (from
  opening the stream to the first decoded frame) and a JPEG snapshot (at most 1280 px wide). Without ffmpeg it
  falls back to OpenCV (`CAP_PROP_OPEN_TIMEOUT_MSEC` / `CAP_PROP_READ_TIMEOUT_MSEC`) with a TCP pre-check.
- Error codes come from ffmpeg's output (`-loglevel verbose` also prints the RTSP SDP):

  | ffmpeg says | errorCode |
  |---|---|
  | `401 Unauthorized`, `403 Forbidden` | `AUTH` |
  | `404 Not Found`, `400 Bad Request`, `Stream not found` | `NOT_FOUND` |
  | `Connection refused`, `No route to host`, `Network is unreachable`, name resolution errors | `UNREACHABLE` |
  | `Connection timed out`, no answer within the timeout | `TIMEOUT` |
  | `Decoder (codec …) not found`, decode errors, an SDP codec other than H.264/H.265/JPEG/MP4V | `UNSUPPORTED_CODEC` |
  | anything else | `OTHER` |

  Credentials are redacted from every error message and log line.
- `GENERIC_ONVIF` channels are resolved with ONVIF before the test (and before analytics). If ONVIF fails, the
  backend's template URL is used.

### LAN discovery

`POST /ai/discover` sends an ONVIF WS-Discovery probe (multicast 239.255.255.250:3702) and scans port 554
(`DISCOVERY_PORTS`) on the edge's /24 (`DISCOVERY_SUBNET` overrides it), all within `DISCOVERY_TIMEOUT_SEC`
(10 s). It also runs 30 s after start and then every `DISCOVERY_INTERVAL_SEC`. It returns
`[{ host, port, brandGuess, onvif }]`, with the brand guessed from the ONVIF scopes or the RTSP `Server:` header,
and reports the list to `POST /api/ingest/discovered`. That list feeds "Discovered on store network" in the
Add-recorder drawer. `DISCOVERY_ENABLED=false` turns discovery off, and `/ai/discover` then answers 503.

### Plain IP cameras

A camera without a recorder keeps its own RTSP URL (Admin › Cameras). Typical URLs:

| Brand | Main stream | Sub-stream |
|---|---|---|
| Hikvision IPC | `rtsp://user:pass@IP:554/Streaming/Channels/101` | `…/102` |
| Dahua / CP Plus IPC | `rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0` | `…&subtype=1` |

Use TCP transport (the default here), H.264, and a 720p sub-stream at 10–15 fps. URL-encode special characters in
passwords (`@` becomes `%40`). Credentials are redacted in the logs.

## 7. Simulator (demo data and E2E tests)

The simulator renders CCTV-like frames from the store's **real** cameras and zones: floor tiles, wall racks,
SHELF units whose stock level changes, the door, the billing counter and POS, people as figures (staff in
the uniform colour with an ID card), phones, mops, and a timestamp/camera overlay. Lights go off when the store
is closed. Everything runs through the same `CameraProcessor`, AI Manager, spool and client as live video.
It posts visitor events, queues, heatmaps, store ops, **PERIODIC snapshots** (enough for the Image Directory
and a recap video) and **AI Manager detections** with annotated snapshots.

A scenario is made of segments:

- **Traffic block.** Shoppers, groups, and a billing queue with a cashier break. It also stages one incident
  for every AI Manager rule:
  - a staff member mops the floor (hygiene COMPLIED);
  - a 3-person staff huddle (COMPLIED);
  - a staff member on the phone for 45 s;
  - a customer unattended for 160 s;
  - a helper without uniform behind the counter;
  - a shelf emptied to 10 %;
  - a queue of 6 or more.
- **Opening.** A dark store, lights on, staff arrive → STORE_OPENED with an OPENING snapshot and an
  on-time STORE_OPEN_CLOSE detection.
- **Closing.** A partial mop sweep (hygiene BREACHED), staff leave, lights off → STORE_CLOSED with a CLOSING
  snapshot.

If a configured rule doesn't cover a staged incident, the simulator adds an implicit default rule (with
`ruleId` omitted) so that every type is exercised. Configured rules (with their `ruleId`) are evaluated
as well.

```bash
# backend at http://localhost:3000, store 1 (T Nagar)
python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --once
python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --once --date 2026-10-04
python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --minutes 120 --speed 60
python -m congruence_eye_ai.simulate --dry-run --once --print-events          # no backend needed
```

Then build that day's recap with `POST /api/recaps/generate {"storeId":1,"date":"2026-10-04"}`.

- **`--once`** runs a deterministic, scripted scenario as fast as possible, in under ~15 s.
  - Without `--date`, the traffic block ends *now*, preceded by today's opening when that is already over.
    After closing time it becomes today's full day.
  - **`--date YYYY-MM-DD`** gives a full store day: opening, a traffic block at 13:00, and closing. Only
    segments that are already in the past are included. A future date exits with code 2.
- **`--minutes N --speed X`** runs a random traffic block with the same incidents. `--speed 0` runs as fast as
  possible; `--speed 1` runs live, starting now.
- Other flags:

  | Flag | Effect |
  |---|---|
  | `--no-incidents` | Turns the staged incidents off |
  | `--snapshot-sec` | Sets the PERIODIC snapshot interval |
  | `--arrivals` | Shoppers per hour |
  | `--seed` | Makes runs repeatable |
  | `--start` | Back-fills a specific window |

- The simulator prints a JSON summary covering segments, generated counts and detections by type and status.
  It exits with code 3 if anything is left undelivered in `--spool-dir`; those items are replayed on the
  next run.

## 8. Data-loss guarantees

- **Write-ahead outbox.** Every event, queue snapshot, store-ops event and heatmap is written to a SQLite outbox
  in WAL mode (`SPOOL_DIR/spool.db`) before it is sent. A row is deleted only after the backend answers 2xx, so
  delivery is *at least once*.
- **Outages.** Network errors, 5xx, 429, 401/403 and 404 keep the data and are retried with exponential backoff
  (1 s, doubling up to 60 s). Each kind of payload is replayed oldest first. Consecutive rows are merged into
  requests of up to 5000 items. A kind that is failing does not block the others.
- **Restarts.** The outbox survives process restarts and power loss, apart from the last `FLUSH_SEC` (5 s) of
  events still in memory. Store-ops events skip that buffer. The last good config is cached in
  `SPOOL_DIR/config.json`, so a box can restart and keep counting while the backend is down.
- **Bad batches.** A 400/413/422 response moves that batch to a `dead` table, where you can inspect it. It is
  never resent, and it never blocks the queue.
- **Disk cap.** If the outbox exceeds `SPOOL_MAX_ROWS`, the oldest rows are dropped and an error is logged.
  The default holds several days of a busy store's traffic.
- **Snapshots with detections and store ops.** A snapshot (OPENING/CLOSING/AI_MANAGER) is spooled together
  with the detections and store-ops events that reference it, as one bundle row. Progress is saved after
  each step, so a retry never uploads a snapshot twice or posts a detection twice. PERIODIC snapshots are
  spooled under their own cap.
- **What is not spooled.** Heartbeats go directly and are not spooled, because stale health data is useless.
- **Duplicates.** If a request succeeded but the response was lost, the batch is sent again. The contract has no
  idempotency key, so the backend may store such a batch twice. These cases are rare and short (one batch).

## 9. How the metrics are produced

- **ENTRY/EXIT.** The foot point has to be more than `LINE_MARGIN` (0.015) from the line before it counts as
  being on a side. A change of side counts only after `LINE_MIN_FRAMES` frames on the new side, and only if the
  path passes within the line segment. Jitter at the line therefore produces no events.
- **Groups.** A non-staff ENTRY is held for `GROUP_WINDOW_SEC` (3 s). Entries within that time and within 0.2
  (normalised) of each other share a `groupId`. The EXIT carries the same `groupId`.
- **Store dwell.** The service keeps a store-wide `visitorId → entry time` map. An EXIT carries
  `dwellSec = exit − entry` when re-ID links the exit track to the entry.
- **Re-ID.** The service builds a 128-dim HSV histogram of the torso and of the legs. It matches people by cosine
  similarity (≥ 0.86) within 2 h. An identity that is visible on a camera can't be claimed by a second track on
  that same camera. After an EXIT, an identity can be matched again for only 5 minutes. Staff get per-track ids
  with an `s-` prefix (their identical uniforms would merge them). When no appearance is available, the id is a
  stable hash of camera, session and track.
- **Queue.** Queue length counts non-staff people who have been in the QUEUE polygon for at least 1 s. The
  reported `avgWaitSec` is the larger of (a) the average of completed waits in the last 15 minutes and (b) the
  longest current wait; it is 0 when the queue is empty. `counterStaffed` means someone is in the camera's
  STAFF_ONLY zone. If the camera has no STAFF_ONLY zone, it means any staff member is visible.
- **Demographics.** OpenCV DNN: an SSD face detector on the top 45 % of the person box, followed by the
  Levi-Hassner age and gender nets. Up to 5 samples per track are combined by majority vote, and age buckets are
  mapped to the contract's age bands. To use your own model, implement the `AgeGenderEstimator` protocol and
  pass it to `StoreRunner(estimator_factory=...)`.
- **Store ops** (store-local time):
  - STORE_OPENED: once a day, at the first person activity while the lights are on, no earlier than 3 h before opening time.
  - STORE_CLOSED: once a day, when the lights have been off or there has been no activity for 30 minutes, no earlier than 4 h before closing time. Its timestamp is the last activity.
  - LIGHTS_OFF: the median brightness across cameras stays below 40 for 60 s during business hours.
  - CAMERA_TAMPER: one camera's view is uniform, has lost more than 85 % of its sharpness compared with its baseline, or is dark while the other cameras are lit, for 5 s.
  - STAFF_ABSENT: no staff seen for 15 minutes during business hours.
  - SOP_BREACH: in `breach` mode, a person who is not staff spends 10 s in a staff-only area. Deduplicated for 5 minutes.

## 10. Tests

```bash
pytest -q
```

The suite covers geometry; line crossing in all 4 directions with jitter and debounce; zone dwell; queue length,
wait time and unattended counters; groups; uniform staff detection on synthetic painted frames; re-ID; the
demographics voter; heatmap; store ops on synthetic frames (brightness, cover, blur); camera health; spooling,
replay, batching and dead-lettering in the backend client (httpx `MockTransport`); payload conformance with the
contract; an exact-event pipeline test using `FakeDetector`; the simulator (deterministic run plus validation of
everything it posts); the camera worker reading a real cv2-written video; the store runner with the FastAPI
endpoints; and real-model tests. The real-model tests are YOLO detection and ByteTrack on Ultralytics' bundled
`bus.jpg`, plus OpenCV age/gender; they are skipped when the weights are absent.

Contract v2 adds these tests:

- **`test_aimanager.py`** covers every detector with scripted tracks and frames: breach and compliance,
  window boundaries and days, overnight windows, cooldown, shelf reference capture and occlusion, and
  open/close tolerance.
- **`test_checklist_ai.py`** covers reference matching on synthetic shelf scenes: an identical or re-framed
  photo passes; a photo with the poster removed fails with a box over that region (IoU > 0.6); blurred,
  zoomed and far photos fail as "not clear". It also covers uniform checks: the right colour with an ID
  card passes, the wrong colour or a missing ID fails. Both are tested through the HTTP endpoints too.
- Snapshot/detection bundles in the client, and AI Manager output through the processor.
- A deterministic full simulated day that exercises all eight rule types.
- **`test_backend_integration.py`** boots a scratch copy of `../backend` (SQLite and its e2e seed, in a temp
  dir) and runs a full simulated day against it. It checks detections of every type with snapshots, the
  open/close view with opening and closing snapshots, the Image Directory, and a **READY recap mp4** from
  `POST /api/recaps/generate`. It is skipped without Node.js, or when `CE_SKIP_BACKEND_IT=1`.

Contract v3 adds these tests:

- **`test_recorder_urls.py`** covers every brand, CUSTOM, IPv6, empty credentials and `encodeURIComponent`
  parity. It checks the shared vectors in `backend/src/modules/recorders/recorder-url.vectors.json`, and runs 300
  random inputs through both the TypeScript helper (with `ts-node`) and the Python mirror.
- **`test_onvif.py`** runs GetCapabilities → GetProfiles → GetStreamUri against a mocked device that verifies the
  WS-Security password digest. It covers the channel and MAIN / SUB profile choice, auth failure, the fallbacks,
  and the poller's use of ONVIF.
- **`test_prober.py`** checks error classification over captured ffmpeg stderr
  (`tests/fixtures/ffmpeg_stderr/captured_*`, recorded from real runs) and field-style samples (`field_*`). It
  also runs **real probes** against a local RTSP server: OK (640×360 H.264 at 10 fps, with a decodable JPEG),
  AUTH, NOT_FOUND, UNREACHABLE, TIMEOUT, UNSUPPORTED_CODEC, and the OpenCV fallback.
- **`test_probe_poller_discovery.py`** covers the 5 s / 1 s-burst scheduling, concurrency, the client endpoints,
  WS-Discovery parsing, the port scan and `POST /ai/discover`.
- **`test_rtsp_integration.py`** is the real end-to-end test. It starts a scratch backend on port 3300
  (`CE_IT_PORT`) and a local RTSP server that plays a Hikvision DVR. It creates the recorder and cameras through
  the API, lets the edge poller probe the real streams, and checks OK with resolution and snapshot, NOT_FOUND,
  AUTH after a password change, UNREACHABLE on a closed port, and the recorder status.

  `tests/rtsp_test_server.py` is a small RTSP 1.0 server (Digest auth, RTP/H.264 interleaved over TCP, RFC 6184
  FU-A) that needs only the `ffmpeg` binary. It stands in for `mediamtx`, whose release binaries could not be
  downloaded in the build sandbox (GitHub releases, the Go module proxy and Docker Hub are blocked there).


## 11. Assumptions about the contract

- `trackId` is `c<cameraId>-<sessionId>-<trackerId>`. The session id is derived from the process start time, so
  tracker ids reused after a restart stay unique.
- `visitorId` uses `v-<16 hex>` for customers and `s-<16 hex>` for staff.
- `groupId` is `g-<10 hex>`. It is sent on ENTRY and on the matching EXIT.
- `gender` and `ageBand` are always sent; the value is `"U"` when unknown. `isStaff` is always sent.
- ZONE_ENTER timestamps are back-dated to the first frame inside the zone. ZONE_EXIT and EXIT carry `dwellSec`
  rounded to 0.1 s. EXIT omits `dwellSec` when it can't be linked to an ENTRY.
- Store-ops events for counters and tampering carry `cameraId`. Store-level events (STORE_OPENED/CLOSED,
  LIGHTS_OFF, STAFF_ABSENT) may omit it, except STORE_OPENED, which carries the camera that saw the first activity.
- Heatmap grids hold person-seconds per cell (each track is sampled at most once per second). They are row-major
  with row 0 at the top, staff are excluded, and grids that are entirely zero are not sent.
- Detections that come from the simulator's implicit default rules omit `ruleId`; their `type` is set.
  Virtual zones the simulator creates (a shelf when the store has no SHELF zone) are never sent as
  `zoneId`.
- The edge cannot fetch the reference image behind `Zone.referenceSnapshotId` (`/api/cameras/:id/snapshot`
  needs a user JWT). The edge therefore captures its own shelf reference and uploads it as a `REFERENCE`
  snapshot (see section 4a).
- Window rules (HUDDLE_MEETING, HYGIENE_CLEANING) send their result with the window end as `ts`. The backend
  keeps one result per rule, store and date.
- Contract v3: a probe's `latencyMs` is the time from opening the stream to the first decoded frame. A stream that
  connects but decodes nothing within the timeout is `TIMEOUT` unless ffmpeg names a codec problem
  (`UNSUPPORTED_CODEC`). `POST /api/ingest/discovered` is sent as `{ devices: [{ host, port, brandGuess, onvif,
  httpPort? }] }`.
