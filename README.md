# Congruence Eye

An AI CCTV analytics and store-operations platform for Congruence stores. It covers every module in the Tango Eye module overview and product deck: **Traffic, Zone, RevOp/Conversion, Queue, StoreOps / Infra Health, Trax (checklists, AI-in-Checklist, tasks, tickets, documents, vendors) and the AI Manager CCTV-driven checklists.**

| Layer | Tech | Folder |
|---|---|---|
| Web app (desktop + installable mobile PWA) | Angular 21, Angular Material, ECharts | `frontend/` |
| API | Node 22, NestJS 11, TypeORM | `backend/` |
| Database | **SQL Server 2022** (T-SQL schema + reporting views) | `database/` |
| Vision AI (one per store / edge box) | Python, YOLO11 + ByteTrack, OpenCV, FastAPI | `ai-service/` |
| End-to-end tests | Playwright | `e2e/` |

Design docs:

- `docs/ARCHITECTURE.md`: architecture and metric definitions
- `docs/API_CONTRACT.md` and `docs/API_CONTRACT_V2.md`: the REST contract
- `docs/FEATURE_TEST_MATRIX.md`: every Tango feature mapped to the screen that implements it and the test that proves it

## Windows one-click setup

Double-click `START-HERE.bat` (see `SETUP-WINDOWS.txt`). It creates `.env` with random secrets, asks the staff uniform colour (`ai-service.env`), runs `docker compose up -d --build`, creates the store and its edge device key, and connects the AI service. At the shop, `CHECK-DVR.bat` tests the DVR ports. Do not run `seed:prod` on a real installation.

## Run it (Docker, SQL Server)

```bash
cp .env.example .env            # set SA_PASSWORD and JWT_SECRET
docker compose up -d --build    # sqlserver → db-init (schema) → backend → ai-service → frontend
docker compose run --rm backend npm run seed:prod   # optional: 6 demo stores, 90 days of data
```

Open http://localhost:8080 and sign in as `admin@congruence.in` with the password `Password@123`. Change the password after the first login.

Other seeded logins:

- `regional@`
- `manager.tnagar@`
- `auditor@`
- `staff.tnagar@congruence.in`

## Run it locally without Docker (dev, SQLite)

```bash
cd backend && npm ci && npm run build
DB_TYPE=sqlite DB_PATH=./data/dev.sqlite SEED_RESET=true npm run seed:prod
DB_TYPE=sqlite DB_PATH=./data/dev.sqlite PORT=3000 node dist/main      # API + Swagger at /api/docs

cd frontend && npm ci && npx ng serve --proxy-config proxy.conf.json   # http://localhost:4200

cd ai-service && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python -m congruence_eye_ai api                                         # AI checklist endpoints on :8000
python -m congruence_eye_ai.simulate --backend http://localhost:3000 --key dev-edge-key-store-1 --once
```

## Connecting real stores

1. **Store and cameras:** in **Admin → Stores**, add the store, then add its cameras with their RTSP URLs.
2. **Zones:** in the zone editor, draw the zones on the camera snapshot:
   - entry line
   - sections
   - billing queues
   - staff-only area
   - shelves for stock-out
3. **Edge device:** in **Admin → Edge devices**, create a device for the store and copy its API key. It is shown only once.
4. **Edge box:** on the store's edge box (Windows/Linux PC, i5 + 16 GB or better, or an NVIDIA Jetson), run the `ai-service` container with `BACKEND_URL` and `EDGE_API_KEY`. It pulls the camera and zone setup, then streams events. If the network drops, events are queued on disk and nothing is lost.
5. **POS:** connect POS bills through `POST /api/pos/transactions` (API key) or a CSV upload. Conversion and ATV depend on this.

## Tests

```bash
scripts/run-all-tests.sh      # backend unit + e2e, frontend unit, ai-service pytest, Playwright full stack
```

Last full run:

| Suite | Result |
|---|---|
| Backend unit | 14 passed |
| Backend e2e | 109 passed |
| Frontend unit | 128 passed |
| ai-service | 162 passed |
| Playwright | 92 passed |

## Not verifiable in the build sandbox (verify on site)

- **SQL Server:** the build sandbox could not pull the SQL Server image, so all automated runs used SQLite with the same entities. `database/01_schema.sql` was generated from those entities and parses as valid T-SQL. Run `docker compose up` once against SQL Server to confirm.
- **Real RTSP cameras:** the detection logic is covered with synthetic tracks and the simulator. Real YOLO person detection was also tested on a sample image. Accuracy on your camera angles needs a pilot store. Tango's own requirements (from the deck) apply here too: entrance cameras, not aerial, 5 MP or higher, RTSP.
- **SMTP email and webhooks:** both are configurable in Settings. In-app and live notifications are fully tested.
