"""A small, real RTSP server for tests (RTSP 1.0 over TCP, RTP/H.264 interleaved, RFC 6184 packetization).

It stands in for a DVR / NVR: Digest authentication (401 on a wrong login, like Hikvision / CP Plus), 404 for an
unknown path, and real H.264 video (an ffmpeg ``testsrc`` pattern) that FFmpeg / OpenCV clients can decode.
`mediamtx` would be the usual choice, but it is not installable in every CI sandbox; this keeps the test
self-contained (it needs only the ``ffmpeg`` binary to encode the test pattern).

Usage::

    srv = RtspTestServer(user="admin", password="p@ss:w/rd#1")
    srv.add_stream("/Streaming/Channels/101", h264_annexb_bytes, fps=10)
    srv.start(); ...; srv.stop()
"""

from __future__ import annotations

import base64
import hashlib
import os
import random
import re
import shutil
import socket
import struct
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

MAX_RTP_PAYLOAD = 1400


def encode_test_pattern(path: Path, width: int = 640, height: int = 360, fps: int = 10, seconds: int = 3, ffmpeg: str | None = None) -> bytes:
    """H.264 Annex B (baseline, SPS/PPS before every IDR, GOP = fps) of ffmpeg's testsrc."""
    ffmpeg = ffmpeg or shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={width}x{height}:rate={fps}",
         "-t", str(seconds), "-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-g", str(fps), "-bf", "0",
         "-x264-params", "repeat-headers=1:slices=1:sliced-threads=0", "-bsf:v", "h264_mp4toannexb", "-f", "h264", str(path)],
        check=True,
    )
    return path.read_bytes()


def split_nals(data: bytes) -> list[bytes]:
    """Annex B byte stream -> NAL units (without start codes)."""
    out: list[bytes] = []
    i, n = 0, len(data)
    starts: list[tuple[int, int]] = []
    while i < n - 3:
        if data[i] == 0 and data[i + 1] == 0 and (data[i + 2] == 1 or (data[i + 2] == 0 and i + 3 < n and data[i + 3] == 1)):
            sc = 3 if data[i + 2] == 1 else 4
            starts.append((i, i + sc))
            i += sc
        else:
            i += 1
    for k, (_, begin) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else n
        nal = data[begin:end].rstrip(b"\x00") if k + 1 < len(starts) else data[begin:end]
        if nal:
            out.append(nal)
    return out


@dataclass
class _Stream:
    access_units: list[list[bytes]]
    sps: bytes
    pps: bytes
    fps: float
    #: overrides the SDP rtpmap (e.g. "X-UNKNOWN/90000") to simulate a codec the client cannot decode
    rtpmap: str | None = None

    @classmethod
    def from_annexb(cls, data: bytes, fps: float) -> "_Stream":
        aus: list[list[bytes]] = []
        cur: list[bytes] = []
        sps = pps = b""
        for nal in split_nals(data):
            t = nal[0] & 0x1F
            if t == 7:
                sps = nal
            elif t == 8:
                pps = nal
            if t == 9:  # access unit delimiter
                continue
            cur.append(nal)
            if t in (1, 5):  # one slice per picture
                aus.append(cur)
                cur = []
        if not sps or not pps or not aus:
            raise ValueError("not an H.264 Annex B stream with SPS/PPS")
        return cls(aus, sps, pps, fps)

    def sdp(self, host: str) -> str:
        profile = self.sps[1:4].hex().upper()
        sprop = f"{base64.b64encode(self.sps).decode()},{base64.b64encode(self.pps).decode()}"
        return (
            "v=0\r\n"
            f"o=- {random.randint(1, 1 << 30)} 1 IN IP4 {host}\r\n"
            "s=Congruence Eye test DVR\r\n"
            "t=0 0\r\n"
            "a=control:*\r\n"
            "m=video 0 RTP/AVP 96\r\n"
            "c=IN IP4 0.0.0.0\r\n"
            f"a=rtpmap:96 {self.rtpmap or 'H264/90000'}\r\n"
            + ("" if self.rtpmap else f"a=fmtp:96 packetization-mode=1;profile-level-id={profile};sprop-parameter-sets={sprop}\r\n")
            + "a=control:trackID=1\r\n"
        )


def rtp_packets(nal: bytes, seq: int, ts: int, ssrc: int, marker: bool) -> tuple[list[bytes], int]:
    """RFC 6184: single NAL unit packet, or FU-A fragments for large NALs."""
    def hdr(m: bool, s: int) -> bytes:
        return struct.pack("!BBHII", 0x80, (0x80 if m else 0) | 96, s & 0xFFFF, ts & 0xFFFFFFFF, ssrc)

    if len(nal) <= MAX_RTP_PAYLOAD:
        return [hdr(marker, seq) + nal], seq + 1
    out: list[bytes] = []
    nri_type = nal[0]
    fu_ind = (nri_type & 0xE0) | 28
    payload = nal[1:]
    first = True
    while payload:
        chunk, payload = payload[: MAX_RTP_PAYLOAD - 2], payload[MAX_RTP_PAYLOAD - 2 :]
        last = not payload
        fu_hdr = (0x80 if first else 0) | (0x40 if last else 0) | (nri_type & 0x1F)
        out.append(hdr(marker and last, seq) + bytes([fu_ind, fu_hdr]) + chunk)
        seq += 1
        first = False
    return out, seq


@dataclass
class RtspTestServer:
    user: str | None = None
    password: str | None = None
    host: str = "127.0.0.1"
    port: int = 0
    realm: str = "Congruence Test DVR"
    streams: dict[str, _Stream] = field(default_factory=dict)
    requests: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._sock: socket.socket | None = None
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def add_stream(self, path: str, annexb: bytes, fps: float = 10, rtpmap: str | None = None) -> None:
        st = _Stream.from_annexb(annexb, fps)
        st.rtpmap = rtpmap
        self.streams[path] = st

    # ----------------------------------------------------------------------------------------- lifecycle
    def start(self) -> "RtspTestServer":
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self.port = self._sock.getsockname()[1]
        self._sock.listen(16)
        self._sock.settimeout(0.2)
        t = threading.Thread(target=self._accept, name="rtsp-test-accept", daemon=True)
        t.start()
        self._threads.append(t)
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._sock:
            self._sock.close()
        for t in self._threads:
            t.join(timeout=2)

    def url(self, path: str, user: str | None = None, password: str | None = None) -> str:
        from urllib.parse import quote

        auth = ""
        if user is not None:
            auth = quote(user, safe="") + (":" + quote(password, safe="") if password is not None else "") + "@"
        return f"rtsp://{auth}{self.host}:{self.port}{path}"

    def _accept(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()  # type: ignore[union-attr]
            except (socket.timeout, OSError):
                continue
            t = threading.Thread(target=self._serve, args=(conn,), name="rtsp-test-conn", daemon=True)
            t.start()
            self._threads.append(t)

    # ----------------------------------------------------------------------------------------- protocol
    def _check_auth(self, method: str, headers: dict[str, str], nonce: str) -> bool:
        if self.user is None:
            return True
        h = headers.get("authorization", "")
        if h.lower().startswith("basic "):
            try:
                u, _, p = base64.b64decode(h[6:]).decode("utf-8").partition(":")
            except Exception:
                return False
            return u == self.user and p == (self.password or "")
        if h.lower().startswith("digest "):
            params = dict(re.findall(r'(\w+)="?([^",]*)"?', h[7:]))
            if params.get("username") != self.user or params.get("nonce") != nonce:
                return False
            md5 = lambda s: hashlib.md5(s.encode("utf-8")).hexdigest()  # noqa: E731
            ha1 = md5(f"{self.user}:{self.realm}:{self.password or ''}")
            ha2 = md5(f"{method}:{params.get('uri', '')}")
            return params.get("response") == md5(f"{ha1}:{nonce}:{ha2}")
        return False

    def _serve(self, conn: socket.socket) -> None:
        conn.settimeout(30)
        wlock = threading.Lock()
        nonce = os.urandom(8).hex()
        session = str(random.randint(10_000_000, 99_999_999))
        stream: _Stream | None = None
        player: threading.Thread | None = None
        playing = threading.Event()
        buf = b""

        def send(data: bytes) -> bool:
            try:
                with wlock:
                    conn.sendall(data)
                return True
            except OSError:
                return False

        def reply(cseq: str, code: int, reason: str, extra: dict[str, str] | None = None, body: str = "") -> None:
            lines = [f"RTSP/1.0 {code} {reason}", f"CSeq: {cseq}", "Server: CongruenceTestDVR/1.0"]
            for k, v in (extra or {}).items():
                lines.append(f"{k}: {v}")
            if body:
                lines += ["Content-Type: application/sdp", f"Content-Length: {len(body.encode())}"]
            send(("\r\n".join(lines) + "\r\n\r\n" + body).encode())

        def play(s: _Stream) -> None:
            ssrc = random.getrandbits(32)
            seq = random.getrandbits(16)
            ts = random.getrandbits(32)
            step = int(90000 / s.fps)
            t0 = time.monotonic()
            k = 0
            while playing.is_set() and not self._stop.is_set():
                au = s.access_units[k % len(s.access_units)]
                for j, nal in enumerate(au):
                    pkts, seq = rtp_packets(nal, seq, ts, ssrc, marker=(j == len(au) - 1))
                    for p in pkts:
                        if not send(b"$\x00" + struct.pack("!H", len(p)) + p):
                            return
                ts += step
                k += 1
                delay = t0 + k / s.fps - time.monotonic()
                if delay > 0:
                    time.sleep(delay)

        try:
            while not self._stop.is_set():
                while not buf.startswith(b"$") and b"\r\n\r\n" not in buf:
                    chunk = conn.recv(4096)
                    if not chunk:
                        return
                    buf += chunk
                if buf.startswith(b"$"):  # interleaved RTCP from the client: skip it
                    while len(buf) < 4:
                        chunk = conn.recv(4096)
                        if not chunk:
                            return
                        buf += chunk
                    ln = struct.unpack("!H", buf[2:4])[0]
                    while len(buf) < 4 + ln:
                        chunk = conn.recv(4096)
                        if not chunk:
                            return
                        buf += chunk
                    buf = buf[4 + ln :]
                    continue
                head, _, buf = buf.partition(b"\r\n\r\n")
                lines = head.decode("utf-8", "replace").split("\r\n")
                method, uri, _ = (lines[0].split(" ") + ["", ""])[:3]
                headers = {}
                for ln_ in lines[1:]:
                    k_, _, v_ = ln_.partition(":")
                    headers[k_.strip().lower()] = v_.strip()
                clen = int(headers.get("content-length", "0") or 0)
                while len(buf) < clen:
                    buf += conn.recv(4096)
                buf = buf[clen:]
                cseq = headers.get("cseq", "0")
                self.requests.append(f"{method} {uri}")
                path = unquote(urlsplit(uri).path or "/")
                if method == "OPTIONS":
                    reply(cseq, 200, "OK", {"Public": "OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN, GET_PARAMETER"})
                    continue
                if not self._check_auth(method, headers, nonce):
                    reply(cseq, 401, "Unauthorized", {"WWW-Authenticate": f'Digest realm="{self.realm}", nonce="{nonce}"'})
                    continue
                if method == "DESCRIBE":
                    s = self.streams.get(path.rstrip("/")) or self.streams.get(path)
                    if s is None:
                        reply(cseq, 404, "Not Found")
                        continue
                    stream = s
                    base = uri if uri.endswith("/") else uri + "/"
                    reply(cseq, 200, "OK", {"Content-Base": base}, s.sdp(self.host))
                elif method == "SETUP":
                    transport = headers.get("transport", "")
                    if "interleaved" not in transport and "TCP" not in transport.upper():
                        reply(cseq, 461, "Unsupported Transport")
                        continue
                    reply(cseq, 200, "OK", {"Transport": "RTP/AVP/TCP;unicast;interleaved=0-1", "Session": f"{session};timeout=60"})
                elif method == "PLAY":
                    if stream is None:
                        reply(cseq, 455, "Method Not Valid in This State")
                        continue
                    reply(cseq, 200, "OK", {"Session": session, "Range": "npt=0.000-"})
                    if player is None:
                        playing.set()
                        player = threading.Thread(target=play, args=(stream,), name="rtsp-test-play", daemon=True)
                        player.start()
                elif method in ("TEARDOWN",):
                    reply(cseq, 200, "OK", {"Session": session})
                    return
                elif method in ("GET_PARAMETER", "SET_PARAMETER"):
                    reply(cseq, 200, "OK", {"Session": session})
                else:
                    reply(cseq, 501, "Not Implemented")
        except (OSError, ValueError):
            return
        finally:
            playing.clear()
            try:
                conn.close()
            except OSError:
                pass


class SilentServer:
    """Accepts TCP connections and never answers (a recorder that hangs → TIMEOUT)."""

    def __init__(self, host: str = "127.0.0.1") -> None:
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind((host, 0))
        self._sock.listen(8)
        self.host = host
        self.port = self._sock.getsockname()[1]
        self._conns: list[socket.socket] = []
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._sock.settimeout(0.2)
        self._t.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                c, _ = self._sock.accept()
                self._conns.append(c)
            except (socket.timeout, OSError):
                continue

    def stop(self) -> None:
        self._stop.set()
        self._sock.close()
        for c in self._conns:
            c.close()


def free_port() -> int:
    """A TCP port with nothing listening on it (closed port → connection refused)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
