"""ONVIF GetStreamUri over plain SOAP (mocked device) and its use by the probe poller."""

from __future__ import annotations

import base64
import hashlib
import re

import httpx
import pytest

from congruence_eye_ai.recorders.onvif import (
    OnvifError,
    OnvifProfile,
    password_digest,
    pick_profile,
    resolve_stream_uri,
    security_header,
)
from congruence_eye_ai.recorders.poller import ProbePoller
from congruence_eye_ai.recorders.prober import ProbeResult

ENV = '<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" ' \
      'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" ' \
      'xmlns:tt="http://www.onvif.org/ver10/schema"><SOAP-ENV:Body>{}</SOAP-ENV:Body></SOAP-ENV:Envelope>'

CAPABILITIES = ENV.format(
    "<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://10.0.0.40:8080/onvif/Media</tt:XAddr>"
    "<tt:StreamingCapabilities><tt:RTP_TCP>true</tt:RTP_TCP></tt:StreamingCapabilities></tt:Media></tds:Capabilities>"
    "</tds:GetCapabilitiesResponse>"
)


def _profile(token: str, name: str, source: str, w: int, h: int) -> str:
    return (
        f'<trt:Profiles token="{token}" fixed="true"><tt:Name>{name}</tt:Name>'
        f'<tt:VideoSourceConfiguration token="vsc_{source}"><tt:Name>{source}</tt:Name><tt:SourceToken>{source}</tt:SourceToken></tt:VideoSourceConfiguration>'
        f'<tt:VideoEncoderConfiguration token="enc_{token}"><tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>{w}</tt:Width>'
        f"<tt:Height>{h}</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>"
    )


PROFILES = ENV.format(
    "<trt:GetProfilesResponse>"
    + _profile("Profile_101", "ch1 main", "VideoSource_1", 1920, 1080)
    + _profile("Profile_102", "ch1 sub", "VideoSource_1", 704, 576)
    + _profile("Profile_201", "ch2 main", "VideoSource_2", 1920, 1080)
    + _profile("Profile_202", "ch2 sub", "VideoSource_2", 704, 576)
    + "</trt:GetProfilesResponse>"
)


def _stream_uri(token: str) -> str:
    return ENV.format(
        f"<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://10.0.0.40:554/onvif/{token}</tt:Uri>"
        "<tt:InvalidAfterConnect>false</tt:InvalidAfterConnect><tt:Timeout>PT0S</tt:Timeout></trt:MediaUri></trt:GetStreamUriResponse>"
    )


def _check_digest(body: str, password: str) -> bool:
    nonce = base64.b64decode(re.search(r"<wsse:Nonce[^>]*>([^<]+)</wsse:Nonce>", body).group(1))
    created = re.search(r"<wsu:Created>([^<]+)</wsu:Created>", body).group(1)
    digest = re.search(r"<wsse:Password[^>]*>([^<]+)</wsse:Password>", body).group(1)
    return digest == base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()


class FakeDevice:
    def __init__(self, user: str = "admin", password: str = "On@vif:1") -> None:
        self.user, self.password = user, password
        self.calls: list[tuple[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = request.content.decode()
        action = re.search(r'action="[^"]*/(\w+)"', request.headers["content-type"]).group(1)
        self.calls.append((str(request.url), action))
        user = re.search(r"<wsse:Username>([^<]*)</wsse:Username>", body)
        if not user or user.group(1) != self.user or not _check_digest(body, self.password):
            return httpx.Response(400, text=ENV.format("<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value>"
                                                       "<SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code>"
                                                       "<SOAP-ENV:Reason><SOAP-ENV:Text>Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>"))
        if action == "GetCapabilities":
            assert str(request.url) == "http://10.0.0.40:8080/onvif/device_service"
            return httpx.Response(200, text=CAPABILITIES)
        assert str(request.url) == "http://10.0.0.40:8080/onvif/Media"
        if action == "GetProfiles":
            return httpx.Response(200, text=PROFILES)
        if action == "GetStreamUri":
            token = re.search(r"<trt:ProfileToken>([^<]+)</trt:ProfileToken>", body).group(1)
            assert "<tt:Protocol>RTSP</tt:Protocol>" in body and "RTP-Unicast" in body
            return httpx.Response(200, text=_stream_uri(token))
        return httpx.Response(500)


def test_password_digest_matches_ws_security_spec() -> None:
    # WS-Security UsernameToken Profile 1.0: Base64(SHA-1(nonce + created + password))
    nonce = bytes(range(16))
    assert password_digest(nonce, "2026-10-06T10:00:00.000Z", "secret") == base64.b64encode(
        hashlib.sha1(nonce + b"2026-10-06T10:00:00.000Z" + b"secret").digest()).decode()
    xml = security_header("admin", "secret", nonce, "2026-10-06T10:00:00.000Z")
    assert "<wsse:Username>admin</wsse:Username>" in xml and "PasswordDigest" in xml and "secret" not in xml
    assert _check_digest(xml, "secret")


@pytest.mark.parametrize("channel,stream,token", [(1, "MAIN", "Profile_101"), (1, "SUB", "Profile_102"), (2, "MAIN", "Profile_201"), (2, "SUB", "Profile_202")])
def test_resolve_stream_uri_per_channel(channel: int, stream: str, token: str) -> None:
    dev = FakeDevice()
    uri = resolve_stream_uri("10.0.0.40", 8080, "admin", "On@vif:1", channel, stream, transport=httpx.MockTransport(dev))
    assert uri == f"rtsp://admin:On%40vif%3A1@10.0.0.40:554/onvif/{token}"
    assert [a for _, a in dev.calls] == ["GetCapabilities", "GetProfiles", "GetStreamUri"]


def test_wrong_password_and_missing_channel() -> None:
    with pytest.raises(OnvifError) as e:
        resolve_stream_uri("10.0.0.40", 8080, "admin", "wrong", 1, "MAIN", transport=httpx.MockTransport(FakeDevice()))
    assert e.value.auth
    with pytest.raises(OnvifError, match="channel 3 not found"):
        resolve_stream_uri("10.0.0.40", 8080, "admin", "On@vif:1", 3, "MAIN", transport=httpx.MockTransport(FakeDevice()))
    with pytest.raises(OnvifError):
        resolve_stream_uri("10.0.0.40", 8080, "admin", "x", 1, transport=httpx.MockTransport(lambda r: httpx.Response(401)))


def test_media_xaddr_falls_back_to_device_service() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        action = re.search(r'action="[^"]*/(\w+)"', req.headers["content-type"]).group(1)
        if action == "GetCapabilities":
            return httpx.Response(500, text="oops")
        assert str(req.url).endswith("/onvif/device_service")
        return httpx.Response(200, text=PROFILES if action == "GetProfiles" else _stream_uri("Profile_101"))

    assert resolve_stream_uri("10.0.0.40", 8080, "", "", 1, transport=httpx.MockTransport(handler)) == "rtsp://10.0.0.40:554/onvif/Profile_101"


def test_pick_profile_single_source_pairs() -> None:
    flat = [OnvifProfile(f"p{i}", f"p{i}", "src") for i in range(1, 7)]
    assert pick_profile(flat, 1, "MAIN").token == "p1"
    assert pick_profile(flat, 2, "MAIN").token == "p3"
    assert pick_profile(flat, 3, "SUB").token == "p6"
    with pytest.raises(OnvifError):
        pick_profile([], 1)


class _Client:
    def __init__(self, items: list[dict]) -> None:
        self.items = items
        self.posted: list[tuple[int, dict, bytes | None]] = []

    def claim_probes(self) -> list[dict]:
        items, self.items = self.items, []
        return items

    def post_probe_result(self, pid: int, result: dict, jpeg: bytes | None) -> bool:
        self.posted.append((pid, result, jpeg))
        return True


class _Prober:
    def __init__(self) -> None:
        self.urls: list[str] = []

    def probe(self, url: str) -> ProbeResult:
        self.urls.append(url)
        return ProbeResult(True, 640, 360, 10.0, "h264", 50, jpeg=b"\xff\xd8x")


def test_poller_resolves_generic_onvif_urls_and_falls_back() -> None:
    onvif = {"host": "10.0.0.40", "httpPort": 8080, "username": "admin", "password": "On@vif:1"}
    items = [
        {"id": 1, "rtspUrl": "rtsp://admin:x@10.0.0.40:554/ch2/sub", "brand": "GENERIC_ONVIF", "channel": 2, "streamProfile": "SUB", "onvif": onvif},
        {"id": 2, "rtspUrl": "rtsp://admin:x@10.0.0.40:554/ch1/main", "brand": "GENERIC_ONVIF", "channel": 1, "streamProfile": "MAIN", "onvif": {**onvif, "password": "bad"}},
        {"id": 3, "rtspUrl": "rtsp://admin:x@10.0.0.20:554/Streaming/Channels/101", "brand": "HIKVISION", "channel": 1, "onvif": None},
    ]
    dev = FakeDevice()
    prober = _Prober()
    client = _Client(items)
    poller = ProbePoller(client, prober, concurrency=1,
                         resolver=lambda *a, **k: resolve_stream_uri(*a, **k, transport=httpx.MockTransport(dev)))
    assert poller.poll_once() == 3
    assert prober.urls == [
        "rtsp://admin:On%40vif%3A1@10.0.0.40:554/onvif/Profile_202",
        "rtsp://admin:x@10.0.0.40:554/ch1/main",  # ONVIF auth failed -> the backend's template URL
        "rtsp://admin:x@10.0.0.20:554/Streaming/Channels/101",
    ]
    assert [p[0] for p in client.posted] == [1, 2, 3]
    assert client.posted[0][1] == {"status": "OK", "width": 640, "height": 360, "fps": 10.0, "codec": "h264", "latencyMs": 50}
