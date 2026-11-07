"""Probe poller scheduling (5 s, 1 s burst for 30 s), backend client probe calls, LAN discovery and POST /ai/discover."""

from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from congruence_eye_ai.backend_client import BackendClient
from congruence_eye_ai.config import Settings
from congruence_eye_ai.main import create_app
from congruence_eye_ai.recorders.discovery import DiscoveredDevice, discover, guess_brand, parse_probe_match, port_scan, subnet_hosts, wsd_probe_message
from congruence_eye_ai.recorders.poller import ProbePoller
from congruence_eye_ai.recorders.prober import ProbeResult
from congruence_eye_ai.store_runner import StoreRunner


class _Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class _Client:
    def __init__(self) -> None:
        self.queue: list[list[dict]] = []
        self.posted: list[tuple[int, dict, bytes | None]] = []
        self.polls = 0

    def claim_probes(self) -> list[dict]:
        self.polls += 1
        return self.queue.pop(0) if self.queue else []

    def post_probe_result(self, pid: int, result: dict, jpeg: bytes | None) -> bool:
        self.posted.append((pid, result, jpeg))
        return True


class _SlowProber:
    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def probe(self, url: str) -> ProbeResult:
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.15)
        with self.lock:
            self.active -= 1
        if "bad" in url:
            return ProbeResult(False, latency_ms=10, error="RTSP 401 Unauthorized", error_code="AUTH")
        return ProbeResult(True, 704, 576, 12.5, "h264", 150, jpeg=b"\xff\xd8jpeg")


def test_poll_interval_bursts_for_30s_after_work() -> None:
    clock = _Clock()
    client = _Client()
    poller = ProbePoller(client, _SlowProber(), clock=clock)
    assert poller.interval() == 5.0
    assert poller.poll_once() == 0
    assert poller.interval() == 5.0
    client.queue.append([{"id": 7, "rtspUrl": "rtsp://ok"}])
    assert poller.poll_once() == 1
    assert poller.interval() == 1.0
    clock.t += 29.9
    assert poller.interval() == 1.0
    clock.t += 0.2
    assert poller.interval() == 5.0


def test_poll_runs_probes_concurrently_and_posts_results() -> None:
    client = _Client()
    prober = _SlowProber()
    client.queue.append([{"id": i, "rtspUrl": "rtsp://bad" if i == 3 else "rtsp://ok"} for i in range(1, 9)])
    poller = ProbePoller(client, prober, concurrency=4)
    t0 = time.monotonic()
    assert poller.poll_once() == 8
    assert time.monotonic() - t0 < 0.15 * 8 * 0.6  # parallel, not 8 x 150 ms
    assert prober.max_active == 4
    by_id = {pid: (res, jpeg) for pid, res, jpeg in client.posted}
    assert sorted(by_id) == list(range(1, 9))
    assert by_id[3] == ({"status": "FAILED", "latencyMs": 10, "errorCode": "AUTH", "error": "RTSP 401 Unauthorized"}, None)
    assert by_id[1] == ({"status": "OK", "width": 704, "height": 576, "fps": 12.5, "codec": "h264", "latencyMs": 150}, b"\xff\xd8jpeg")


def test_poller_thread_loop() -> None:
    client = _Client()
    client.queue.append([{"id": 1, "rtspUrl": "rtsp://ok"}])
    poller = ProbePoller(client, _SlowProber(), poll_sec=0.05, burst_poll_sec=0.02)
    poller.start()
    deadline = time.time() + 5
    while not client.posted and time.time() < deadline:
        time.sleep(0.02)
    time.sleep(0.2)
    poller.stop()
    assert client.posted and client.posted[0][0] == 1
    assert client.polls >= 3  # keeps polling (burst mode)


def test_backend_client_probe_endpoints(tmp_path: Path) -> None:
    seen: list[tuple[str, str, bytes]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.content))
        if req.url.path == "/api/ingest/probes" and req.method == "GET":
            return httpx.Response(200, json=[{"id": 5, "rtspUrl": "rtsp://a"}])
        if req.url.path == "/api/ingest/probes/5":
            return httpx.Response(200, json={"id": 5, "status": "OK"})
        if req.url.path == "/api/ingest/probes/6":
            return httpx.Response(409, json={"message": "Probe is already EXPIRED"})
        if req.url.path == "/api/ingest/discovered":
            return httpx.Response(200, json={"accepted": 1})
        return httpx.Response(404)

    c = BackendClient("http://backend", "k", tmp_path / "spool", transport=httpx.MockTransport(handler), sleep=lambda s: None)
    assert c.claim_probes() == [{"id": 5, "rtspUrl": "rtsp://a"}]
    assert c.post_probe_result(5, {"status": "OK", "width": 640}, b"\xff\xd8jpg") is True
    method, path, body = seen[-1]
    assert (method, path) == ("POST", "/api/ingest/probes/5")
    assert b'name="result"' in body and b'{"status": "OK", "width": 640}' in body and b'name="file"' in body and b"\xff\xd8jpg" in body
    assert c.post_probe_result(6, {"status": "OK"}) is False
    assert c.post_discovered([{"host": "10.0.0.20", "port": 554, "brandGuess": "HIKVISION", "onvif": True}]) is True
    assert json.loads(seen[-1][2]) == {"devices": [{"host": "10.0.0.20", "port": 554, "brandGuess": "HIKVISION", "onvif": True}]}
    c.stop(final_drain=False)


# ------------------------------------------------------------------------------------------- discovery
PROBE_MATCH = """<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch>
<wsa:EndpointReference><wsa:Address>urn:uuid:54575d1f-1dd2-11b2-a105-c056e3c8e6a1</wsa:Address></wsa:EndpointReference>
<d:Types>dn:NetworkVideoTransmitter tds:Device</d:Types>
<d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/Profile/Streaming onvif://www.onvif.org/name/HIKVISION%20DS-7208HQHI-K1 onvif://www.onvif.org/hardware/DS-7208HQHI-K1</d:Scopes>
<d:XAddrs>http://10.20.1.20/onvif/device_service http://[fe80::c256:e3ff:fec8:e6a1]/onvif/device_service</d:XAddrs>
<d:MetadataVersion>10</d:MetadataVersion></d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>"""


def test_ws_discovery_parsing_and_brand_guess() -> None:
    devs = parse_probe_match(PROBE_MATCH, "10.20.1.20")
    assert devs[0] == DiscoveredDevice(host="10.20.1.20", port=554, brandGuess="HIKVISION", onvif=True, httpPort=80)
    assert devs[0].contract() == {"host": "10.20.1.20", "port": 554, "brandGuess": "HIKVISION", "onvif": True}
    dahua = PROBE_MATCH.replace("HIKVISION%20DS-7208HQHI-K1", "Dahua").replace("DS-7208HQHI-K1", "DH-XVR5108").replace("http://10.20.1.20/", "http://10.20.1.21:8080/")
    d = parse_probe_match(dahua, "10.20.1.21")[0]
    assert (d.host, d.httpPort, d.brandGuess) == ("10.20.1.21", 8080, "DAHUA")
    generic = PROBE_MATCH.replace("HIKVISION%20DS-7208HQHI-K1", "IPC").replace("DS-7208HQHI-K1", "X1")
    assert parse_probe_match(generic, "10.20.1.20")[0].brandGuess == "GENERIC_ONVIF"
    assert b"NetworkVideoTransmitter" in wsd_probe_message() and b"/discovery/Probe" in wsd_probe_message()
    assert guess_brand("CP PLUS DVR") == "CP_PLUS" and guess_brand("App-webs/") == "HIKVISION" and guess_brand(None, "") is None


def test_subnet_hosts() -> None:
    assert len(subnet_hosts(ip="192.168.1.77")) == 254
    assert subnet_hosts(ip="192.168.1.77")[0] == "192.168.1.1"
    assert subnet_hosts("127.0.0.1/32") == ["127.0.0.1"]


def _rtsp_listener(server_header: str) -> tuple[socket.socket, int, threading.Event]:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(8)
    s.settimeout(0.2)
    stop = threading.Event()

    def run() -> None:
        while not stop.is_set():
            try:
                c, _ = s.accept()
            except (socket.timeout, OSError):
                continue
            try:
                c.settimeout(1)
                if c.recv(4096).startswith(b"OPTIONS"):
                    c.sendall(f"RTSP/1.0 200 OK\r\nCSeq: 1\r\nServer: {server_header}\r\nPublic: OPTIONS, DESCRIBE\r\n\r\n".encode())
            except OSError:
                pass
            finally:
                c.close()

    threading.Thread(target=run, daemon=True).start()
    return s, s.getsockname()[1], stop


def test_port_scan_and_discover_with_a_deadline() -> None:
    s, port, stop = _rtsp_listener("Hikvision-Webs")
    try:
        found = port_scan(["127.0.0.1"], [port], timeout=0.5)
        assert found == [DiscoveredDevice(host="127.0.0.1", port=port, brandGuess="HIKVISION", onvif=False)]
        t0 = time.monotonic()
        devs = discover(timeout=2, subnet="127.0.0.0/30", ports=[port], ws_discovery_enabled=False)
        assert time.monotonic() - t0 < 3
        assert [d.contract() for d in devs] == [{"host": "127.0.0.1", "port": port, "brandGuess": "HIKVISION", "onvif": False}]
    finally:
        stop.set()
        s.close()


def test_ai_discover_endpoint(tmp_path: Path) -> None:
    s, port, stop = _rtsp_listener("Rtsp Server/2.0")
    posted: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/ingest/discovered":
            posted.append(json.loads(req.content))
            return httpx.Response(200, json={"accepted": 1})
        return httpx.Response(404)

    try:
        settings = Settings(_env_file=None, SPOOL_DIR=tmp_path / "spool", DISCOVERY_SUBNET="127.0.0.1/32", DISCOVERY_PORTS=[port],  # type: ignore[call-arg]
                            DISCOVERY_WS_ENABLED=False, DISCOVERY_TIMEOUT_SEC=3, PROBE_ENABLED=False)
        client = BackendClient("http://backend", "k", tmp_path / "spool", transport=httpx.MockTransport(handler), sleep=lambda s: None)
        runner = StoreRunner(settings, client=client)
        api = TestClient(create_app(runner, manage_lifecycle=False, person_detector=None))
        r = api.post("/ai/discover")
        assert r.status_code == 200
        assert r.json() == [{"host": "127.0.0.1", "port": port, "brandGuess": "DAHUA", "onvif": False}]
        assert posted == [{"devices": [{"host": "127.0.0.1", "port": port, "brandGuess": "DAHUA", "onvif": False}]}]
        assert api.get("/status").json()["discovery"]["devices"] == r.json()
        # disabled -> 503
        runner.settings = Settings(_env_file=None, SPOOL_DIR=tmp_path / "s2", DISCOVERY_ENABLED=False)  # type: ignore[call-arg]
        assert api.post("/ai/discover").status_code == 503
        client.stop(final_drain=False)
    finally:
        stop.set()
        s.close()
