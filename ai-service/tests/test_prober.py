"""RTSP connection tests: stderr classification (captured + field samples) and real probes against a local RTSP server."""

from __future__ import annotations

import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from congruence_eye_ai.recorders.prober import ProbeResult, RtspProber, classify_stderr, parse_sdp_codec, parse_stream_info
from tests.rtsp_test_server import RtspTestServer, SilentServer, encode_test_pattern, free_port

FIX = Path(__file__).parent / "fixtures" / "ffmpeg_stderr"
FFMPEG = shutil.which("ffmpeg")
PW = "p@ss:w/rd#1"


def _sample(name: str) -> str:
    return (FIX / name).read_text()


@pytest.mark.parametrize(
    "name,code,needle",
    [
        ("captured_auth_401.txt", "AUTH", "401 Unauthorized"),
        ("captured_not_found_404.txt", "NOT_FOUND", "404 Not Found"),
        ("captured_connection_refused.txt", "UNREACHABLE", "Connection refused"),
        ("field_no_route.txt", "UNREACHABLE", "No route to host"),
        ("field_dns.txt", "UNREACHABLE", "Name or service not known"),
        ("field_connect_timeout.txt", "TIMEOUT", "timed out"),
        ("field_dahua_400.txt", "NOT_FOUND", "400 Bad Request"),
        ("field_forbidden_403.txt", "AUTH", "403 Forbidden"),
        ("field_no_hevc_decoder.txt", "UNSUPPORTED_CODEC", "Decoder (codec hevc) not found"),
        ("field_decode_errors.txt", "UNSUPPORTED_CODEC", "non-existing PPS"),
    ],
)
def test_classify_stderr_samples(name: str, code: str, needle: str) -> None:
    got, msg = classify_stderr(_sample(name))
    assert got == code
    assert needle.lower() in msg.lower()
    assert "@ 0x" not in msg  # ffmpeg context prefixes are dropped
    assert "p%40ss" not in msg and "secret@" not in msg  # credentials never leak into messages


def test_classify_failure_uses_time_and_sdp() -> None:
    p = RtspProber(timeout_sec=10, ffmpeg_path="/nonexistent")
    # ffmpeg's socket timeout prints "Invalid data found when processing input"
    r = p.classify_failure(_sample("captured_socket_timeout.txt"), latency_ms=10_100)
    assert (r.error_code, r.error) == ("TIMEOUT", "No frame within 10 s (no answer from the recorder)")
    assert p.classify_failure(_sample("captured_socket_timeout.txt"), latency_ms=300).error_code == "OTHER"
    r = p.classify_failure(_sample("captured_unknown_codec.txt"), latency_ms=12_000, killed=True)
    assert (r.error_code, r.codec) == ("UNSUPPORTED_CODEC", "x-unknown")
    assert "switch the channel to H.264" in r.error
    assert parse_sdp_codec(_sample("captured_unknown_codec.txt")) == "X-UNKNOWN"
    assert p.classify_failure(_sample("captured_auth_401.txt"), latency_ms=100).error_code == "AUTH"


def test_parse_stream_info() -> None:
    assert parse_stream_info(_sample("captured_ok_h264.txt")) == ("h264", 640, 360, 10.0)
    assert parse_stream_info(_sample("field_decode_errors.txt")) == ("h264", 704, 576, 12.5)
    assert parse_stream_info(_sample("field_no_hevc_decoder.txt")) == ("hevc", 2560, 1440, 20.0)
    assert parse_stream_info("nothing") == (None, None, None, None)


def test_result_payload() -> None:
    assert ProbeResult(True, 1920, 1080, 25.0, "h264", 800, jpeg=b"x").to_payload() == {
        "status": "OK", "width": 1920, "height": 1080, "fps": 25.0, "codec": "h264", "latencyMs": 800}
    assert ProbeResult(False, latency_ms=90, error="RTSP 401", error_code="AUTH").to_payload() == {
        "status": "FAILED", "latencyMs": 90, "errorCode": "AUTH", "error": "RTSP 401"}
    assert ProbeResult(False).to_payload() == {"status": "FAILED", "errorCode": "OTHER", "error": "Connection test failed"}


def test_rejects_non_rtsp_urls() -> None:
    r = RtspProber().probe("http://10.0.0.20/stream")
    assert (r.ok, r.error_code) == (False, "OTHER")


# ------------------------------------------------------------------------------------------- real RTSP
@pytest.fixture(scope="module")
def rtsp(tmp_path_factory):
    if FFMPEG is None:
        pytest.skip("ffmpeg is not installed")
    d = tmp_path_factory.mktemp("rtsp")
    stream = encode_test_pattern(d / "pattern.h264", 640, 360, fps=10, seconds=3)
    srv = RtspTestServer(user="admin", password=PW)
    srv.add_stream("/Streaming/Channels/101", stream, fps=10)
    srv.add_stream("/Streaming/Channels/102", stream, fps=10)
    srv.add_stream("/Streaming/Channels/301", stream, fps=10, rtpmap="X-UNKNOWN/90000")
    srv.start()
    yield srv
    srv.stop()


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed")
def test_real_probe_ok_reports_resolution_codec_fps_and_snapshot(rtsp: RtspTestServer) -> None:
    r = RtspProber(timeout_sec=10).probe(rtsp.url("/Streaming/Channels/101", "admin", PW))
    assert r.ok, r.error
    assert (r.width, r.height, r.codec, r.fps) == (640, 360, "h264", 10.0)
    assert 0 < r.latency_ms < 10_000
    img = cv2.imdecode(np.frombuffer(r.jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape == (360, 640, 3)
    assert img.std() > 20  # a real picture (testsrc colour bars), not a grey frame


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed")
@pytest.mark.parametrize(
    "case,code",
    [("wrong_password", "AUTH"), ("wrong_path", "NOT_FOUND"), ("closed_port", "UNREACHABLE"), ("silent", "TIMEOUT"), ("codec", "UNSUPPORTED_CODEC")],
)
def test_real_probe_failures(rtsp: RtspTestServer, case: str, code: str) -> None:
    silent = SilentServer() if case == "silent" else None
    try:
        url = {
            "wrong_password": rtsp.url("/Streaming/Channels/101", "admin", "nope"),
            "wrong_path": rtsp.url("/Streaming/Channels/501", "admin", PW),
            "closed_port": f"rtsp://admin:x@127.0.0.1:{free_port()}/Streaming/Channels/101",
            "silent": f"rtsp://admin:x@127.0.0.1:{silent.port if silent else 0}/Streaming/Channels/101",
            "codec": rtsp.url("/Streaming/Channels/301", "admin", PW),
        }[case]
        r = RtspProber(timeout_sec=3).probe(url)
    finally:
        if silent:
            silent.stop()
    assert (r.ok, r.error_code) == (False, code), r.error
    assert r.error and "nope" not in r.error and "p%40ss" not in r.error
    assert r.jpeg is None


def test_opencv_fallback(rtsp: RtspTestServer) -> None:
    """Without ffmpeg the prober uses OpenCV (CAP_PROP_OPEN_TIMEOUT_MSEC) with a TCP pre-check."""
    p = RtspProber(timeout_sec=5, ffmpeg_path="/nonexistent/ffmpeg")
    assert p.backend == "opencv"
    ok = p.probe(rtsp.url("/Streaming/Channels/102", "admin", PW))
    assert ok.ok, ok.error
    assert (ok.width, ok.height) == (640, 360) and ok.jpeg[:2] == b"\xff\xd8"
    refused = p.probe(f"rtsp://127.0.0.1:{free_port()}/x")
    assert (refused.ok, refused.error_code) == (False, "UNREACHABLE")
    bad = p.probe(rtsp.url("/Streaming/Channels/101", "admin", "nope"))
    assert not bad.ok
