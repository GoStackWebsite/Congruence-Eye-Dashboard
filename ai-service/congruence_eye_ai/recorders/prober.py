"""RTSP connection test (contract v3 probes).

Opens a stream over RTSP/TCP with a 10 s timeout, decodes one frame and reports width, height, fps, codec,
latency and a JPEG snapshot. FFmpeg is used when it is installed (its stderr gives precise error causes);
otherwise OpenCV's FFmpeg backend with ``CAP_PROP_OPEN_TIMEOUT_MSEC`` / ``CAP_PROP_READ_TIMEOUT_MSEC``.

Failures map to the contract's ``errorCode``: AUTH (RTSP 401/403), NOT_FOUND (RTSP 404/400, stream not found),
UNREACHABLE (refused, no route, unknown host), TIMEOUT, UNSUPPORTED_CODEC (no decoder / undecodable stream)
and OTHER.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from .urls import redact

log = logging.getLogger(__name__)

#: "verbose" makes ffmpeg print the RTSP SDP, which names the codec even when nothing can be decoded
LOGLEVEL = "verbose"
ERROR_CODES = ("AUTH", "TIMEOUT", "UNREACHABLE", "NOT_FOUND", "UNSUPPORTED_CODEC", "OTHER")


@dataclass
class ProbeResult:
    ok: bool
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    codec: str | None = None
    latency_ms: int | None = None
    error: str | None = None
    error_code: str | None = None
    jpeg: bytes | None = field(default=None, repr=False)

    def to_payload(self) -> dict[str, Any]:
        """The ``result`` JSON of ``POST /api/ingest/probes/:id``."""
        out: dict[str, Any] = {"status": "OK" if self.ok else "FAILED"}
        for k, v in (("width", self.width), ("height", self.height), ("fps", self.fps), ("codec", self.codec), ("latencyMs", self.latency_ms)):
            if v is not None:
                out[k] = v
        if not self.ok:
            out["errorCode"] = self.error_code or "OTHER"
            out["error"] = (self.error or "Connection test failed")[:500]
        return out


# ---------------------------------------------------------------------------------------------- stderr parsing
#: (errorCode, regex, user-facing summary) — first match wins, so auth/404 beat the generic "Invalid data" lines
_RULES: list[tuple[str, re.Pattern[str], str]] = [
    ("AUTH", re.compile(r"\b40[13] (?:Unauthorized|Forbidden)|Unauthorized|authorization failed|Forbidden", re.I),
     "RTSP 401 Unauthorized: wrong username or password"),
    ("NOT_FOUND", re.compile(r"\b404 Not Found|Stream not found|\b400 Bad Request|No such file or directory", re.I),
     "RTSP 404 Not Found: no stream at this URL"),
    ("UNREACHABLE", re.compile(
        r"Connection refused|No route to host|Network is unreachable|Host is unreachable|Name or service not known|"
        r"Temporary failure in name resolution|nodename nor servname|Cannot assign requested address|Failed to resolve hostname|"
        r"Connection reset by peer", re.I), "Cannot reach the recorder"),
    ("TIMEOUT", re.compile(r"timed out|Timeout|time-out|Operation not permitted.*timeout", re.I), "No answer within the timeout"),
    ("UNSUPPORTED_CODEC", re.compile(
        r"Decoder \(codec [^)]*\) not found|Unsupported codec|unknown codec|Could not find codec parameters|no decoder|"
        r"Unknown decoder|decoding for stream \d+ failed|Error while decoding stream|Invalid NAL unit|non-existing PPS|no frame!|"
        r"is not implemented", re.I),
     "The stream could not be decoded"),
]

_VIDEO = re.compile(r"Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: ([A-Za-z0-9_]+)[^\n]*?, (\d{2,5})x(\d{2,5})")
_FPS = re.compile(r"([\d.]+) fps")
_TBR = re.compile(r"([\d.]+)(k?) tbr")


_SDP_RTPMAP = re.compile(r"^a=rtpmap:\d+\s+([A-Za-z0-9._-]+)/", re.M)
_SDP_VIDEO = re.compile(r"^m=video ", re.M)
#: RTP encodings an FFmpeg build decodes for CCTV (RFC 6184 / 7798 / 2435 / 3016)
DECODABLE_RTP = {"H264", "H265", "HEVC", "JPEG", "MP4V-ES"}


def parse_sdp_codec(stderr: str) -> str | None:
    """The video rtpmap encoding from the SDP that ffmpeg prints at ``-loglevel verbose`` (e.g. ``H264``)."""
    text = stderr or ""
    m = _SDP_VIDEO.search(text)
    if not m:
        return None
    r = _SDP_RTPMAP.search(text, m.end())
    return r.group(1).upper() if r else None


_PREFIX = re.compile(r"^(\[[^\]]+ @ 0x[0-9a-f]+\]\s*)+", re.I)


def _clean(line: str) -> str:
    """Drops ffmpeg's ``[rtsp @ 0x55...]`` context prefixes."""
    return _PREFIX.sub("", line.strip())


def classify_stderr(stderr: str) -> tuple[str, str]:
    """``(errorCode, message)`` for an ffmpeg/ffprobe failure. The message is short, user-facing and redacted."""
    text = stderr or ""
    for code, rx, summary in _RULES:
        m = rx.search(text)
        if m:
            line = next((_clean(ln) for ln in text.splitlines() if rx.search(ln)), m.group(0))
            return code, f"{summary} ({redact(line)[:160]})"
    last = next((_clean(ln) for ln in reversed(text.splitlines()) if ln.strip()), "unknown error")
    return "OTHER", redact(last)[-300:]


def parse_stream_info(stderr: str) -> tuple[str | None, int | None, int | None, float | None]:
    """``(codec, width, height, fps)`` from ffmpeg's ``Stream #0:0: Video: h264 ..., 1920x1080, 25 fps`` line."""
    for line in (stderr or "").splitlines():
        m = _VIDEO.search(line)
        if not m:
            continue
        codec, w, h = m.group(1).lower(), int(m.group(2)), int(m.group(3))
        fps: float | None = None
        f = _FPS.search(line)
        if f:
            fps = float(f.group(1))
        else:
            t = _TBR.search(line)
            if t:
                fps = float(t.group(1)) * (1000 if t.group(2) else 1)
        if fps is not None and (fps <= 0 or fps > 300):
            fps = None
        return codec, w, h, (round(fps, 2) if fps is not None else None)
    return None, None, None, None


# ---------------------------------------------------------------------------------------------- probers
def _host_port(url: str) -> tuple[str | None, int]:
    try:
        u = urlsplit(url)
        return u.hostname, u.port or 554
    except ValueError:
        return None, 554


class RtspProber:
    """``probe(url) -> ProbeResult``. Thread-safe; one ffmpeg process per call."""

    def __init__(self, timeout_sec: float = 10.0, ffmpeg_path: str | None = None, snapshot_width: int = 1280) -> None:
        self.timeout_sec = timeout_sec
        self.snapshot_width = snapshot_width
        self.ffmpeg = ffmpeg_path or os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
        if self.ffmpeg and not (os.path.isfile(self.ffmpeg) or shutil.which(self.ffmpeg)):
            self.ffmpeg = None

    @property
    def backend(self) -> str:
        return "ffmpeg" if self.ffmpeg else "opencv"

    def probe(self, url: str) -> ProbeResult:
        if not url or not url.lower().startswith(("rtsp://", "rtsps://")) and not os.path.exists(url):
            return ProbeResult(False, error="Not an RTSP URL", error_code="OTHER")
        try:
            return self._probe_ffmpeg(url) if self.ffmpeg else self._probe_opencv(url)
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("probe failed")
            return ProbeResult(False, error=redact(f"{exc.__class__.__name__}: {exc}")[:300], error_code="OTHER")

    # -- ffmpeg --------------------------------------------------------------------------------
    def ffmpeg_args(self, url: str) -> list[str]:
        args = [self.ffmpeg or "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", LOGLEVEL]
        if url.lower().startswith(("rtsp://", "rtsps://")):
            args += ["-rtsp_transport", "tcp", "-timeout", str(int(self.timeout_sec * 1_000_000))]
        args += [
            "-i", url, "-an", "-sn", "-dn", "-frames:v", "1",
            "-vf", f"scale='min({self.snapshot_width},iw)':-2", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
        ]
        return args

    def _probe_ffmpeg(self, url: str) -> ProbeResult:
        t0 = time.monotonic()
        proc = subprocess.Popen(self.ffmpeg_args(url), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        killed = False
        try:
            out, err = proc.communicate(timeout=self.timeout_sec + 2)
        except subprocess.TimeoutExpired:
            # e.g. a codec ffmpeg cannot parse: packets keep arriving (no socket timeout) but nothing decodes
            proc.kill()
            out, err = proc.communicate()
            killed = True
        latency = int((time.monotonic() - t0) * 1000)
        stderr = err.decode("utf-8", "replace")
        codec, w, h, fps = parse_stream_info(stderr)
        if not killed and proc.returncode == 0 and out[:2] == b"\xff\xd8":
            return ProbeResult(True, w, h, fps, codec, latency, jpeg=out)
        result = self.classify_failure(stderr, latency, killed)
        result.width, result.height, result.fps, result.codec = w, h, fps, codec or result.codec
        log.debug("probe %s failed (%s): %s", redact(url), result.error_code, redact(stderr[-800:]))
        return result

    def classify_failure(self, stderr: str, latency_ms: int, killed: bool = False) -> ProbeResult:
        """Maps a failed ffmpeg run (stderr, elapsed time, killed on the wall-clock timeout) to an errorCode."""
        sdp_codec = parse_sdp_codec(stderr)
        stream_codec = parse_stream_info(stderr)[0]
        if sdp_codec and sdp_codec not in DECODABLE_RTP:
            return ProbeResult(False, codec=sdp_codec.lower(), latency_ms=latency_ms, error_code="UNSUPPORTED_CODEC",
                               error=f"Unsupported video codec {sdp_codec}: switch the channel to H.264")
        code, msg = classify_stderr(stderr)
        if code in ("AUTH", "NOT_FOUND", "UNREACHABLE", "UNSUPPORTED_CODEC"):
            return ProbeResult(False, latency_ms=latency_ms, error=msg, error_code=code)
        if killed or code == "TIMEOUT" or (code == "OTHER" and not stream_codec and latency_ms >= self.timeout_sec * 900):
            # ffmpeg's socket timeout surfaces as "Invalid data found when processing input"
            what = f"{stream_codec or sdp_codec.lower()} stream found but no picture decoded" if (stream_codec or sdp_codec) else "no answer from the recorder"
            return ProbeResult(False, latency_ms=latency_ms, error_code="TIMEOUT", error=f"No frame within {self.timeout_sec:g} s ({what})")
        if code == "OTHER" and stream_codec:
            return ProbeResult(False, latency_ms=latency_ms, error_code="UNSUPPORTED_CODEC", error=redact(f"The {stream_codec} stream could not be decoded ({msg})"))
        return ProbeResult(False, latency_ms=latency_ms, error=msg, error_code=code)

    # -- OpenCV fallback -----------------------------------------------------------------------
    _cv_lock = threading.Lock()

    def _probe_opencv(self, url: str) -> ProbeResult:
        import cv2

        host, port = _host_port(url)
        t0 = time.monotonic()
        if host:
            pre = tcp_check(host, port, min(self.timeout_sec, 5.0))
            if pre:
                return ProbeResult(False, latency_ms=int((time.monotonic() - t0) * 1000), error=f"{pre[1]} ({host}:{port})", error_code=pre[0])
        ms = int(self.timeout_sec * 1000)
        with self._cv_lock:  # OPENCV_FFMPEG_CAPTURE_OPTIONS is process-wide
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, ms])
        try:
            if not cap.isOpened():
                return ProbeResult(False, latency_ms=int((time.monotonic() - t0) * 1000),
                                   error="The stream could not be opened (wrong URL, login or channel)", error_code="OTHER")
            ok, frame = cap.read()
            latency = int((time.monotonic() - t0) * 1000)
            fourcc = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
            codec = "".join(chr((fourcc >> (8 * i)) & 0xFF) for i in range(4)).strip().lower() or None if fourcc else None
            fps = cap.get(cv2.CAP_PROP_FPS) or None
            if not ok or frame is None:
                return ProbeResult(False, codec=codec, latency_ms=latency, error="No picture decoded", error_code="UNSUPPORTED_CODEC" if codec else "TIMEOUT")
            h, w = frame.shape[:2]
            if w > self.snapshot_width:
                frame = cv2.resize(frame, (self.snapshot_width, int(h * self.snapshot_width / w)))
            enc_ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return ProbeResult(True, w, h, round(float(fps), 2) if fps and 0 < fps < 300 else None, codec, latency, jpeg=buf.tobytes() if enc_ok else None)
        finally:
            cap.release()


def tcp_check(host: str, port: int, timeout: float) -> tuple[str, str] | None:
    """``None`` when a TCP connection opens, else ``(errorCode, message)``."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return None
    except socket.timeout:
        return "TIMEOUT", "Connection timed out"
    except socket.gaierror as exc:
        return "UNREACHABLE", f"Unknown host: {exc}"
    except ConnectionRefusedError:
        return "UNREACHABLE", "Connection refused"
    except OSError as exc:
        return "UNREACHABLE", f"{exc.strerror or exc}"
