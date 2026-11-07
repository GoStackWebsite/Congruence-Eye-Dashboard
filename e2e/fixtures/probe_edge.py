"""E2E stand-in for a store's DVR + edge box (contract v3 connection tests).

Starts the repo's real RTSP test server (ai-service/tests/rtsp_test_server.py: RTSP over TCP, Digest auth, H.264
test pattern) as a CP Plus / Dahua style recorder (``/cam/realmonitor?channel=N&subtype=0``), prints
``{"port": <port>}`` on stdout, then runs the real edge prober (``congruence_eye_ai.recorders.poller.ProbePoller``)
against the backend with the store's edge key until ``--expect`` probes were handled or ``--timeout`` passes.

    python probe_edge.py --backend http://127.0.0.1:3000 --key dev-edge-key-store-1 --user admin --password 'p@ss' \
        --expect 2 --ffmpeg /path/to/ffmpeg
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

AI_DIR = Path(__file__).resolve().parents[2] / "ai-service"
sys.path.insert(0, str(AI_DIR))
sys.path.insert(0, str(AI_DIR / "tests"))

from congruence_eye_ai.backend_client import BackendClient  # noqa: E402
from congruence_eye_ai.recorders.poller import ProbePoller  # noqa: E402
from rtsp_test_server import RtspTestServer, encode_test_pattern  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", required=True)
    ap.add_argument("--expect", type=int, default=1, help="probes to handle before exiting")
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--ffmpeg", default=None)
    a = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="e2e-dvr-"))
    annexb = encode_test_pattern(tmp / "pattern.h264", width=640, height=360, fps=10, seconds=3, ffmpeg=a.ffmpeg)
    srv = RtspTestServer(user=a.user, password=a.password)
    srv.add_stream("/cam/realmonitor", annexb, fps=10)
    srv.start()
    print(json.dumps({"port": srv.port}), flush=True)

    client = BackendClient(a.backend, a.key, spool_dir=tmp / "spool", retries=1)
    poller = ProbePoller(client, concurrency=4)
    handled = 0
    deadline = time.monotonic() + a.timeout
    try:
        while handled < a.expect and time.monotonic() < deadline:
            handled += poller.poll_once()
            time.sleep(0.5)
    finally:
        srv.stop()
    print(json.dumps({"handled": handled}), flush=True)
    return 0 if handled >= a.expect else 1


if __name__ == "__main__":
    sys.exit(main())
