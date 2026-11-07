"""Minimal ONVIF client: GetStreamUri for GENERIC_ONVIF recorders (plain SOAP 1.2 over httpx).

Flow: ``GetCapabilities`` (device service) -> Media XAddr, ``GetProfiles`` -> profiles grouped by video source
(one source per recorder channel, in order), ``GetStreamUri`` (RTP-Unicast over RTSP) for the channel's first
profile (MAIN) or second profile (SUB). Requests carry a WS-Security UsernameToken with a password digest:
``base64(sha1(nonce + created + password))``.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from .urls import url_host, with_credentials

log = logging.getLogger(__name__)

NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tt": "http://www.onvif.org/ver10/schema",
    "wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
    "wsu": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
}
PASSWORD_DIGEST = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest"
NONCE_B64 = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"


class OnvifError(Exception):
    """ONVIF request failed; ``auth`` is true for an authentication fault (HTTP 401 / NotAuthorized)."""

    def __init__(self, message: str, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth


def password_digest(nonce: bytes, created: str, password: str) -> str:
    return base64.b64encode(hashlib.sha1(nonce + created.encode("utf-8") + password.encode("utf-8")).digest()).decode("ascii")


def security_header(username: str, password: str, nonce: bytes | None = None, created: str | None = None) -> str:
    nonce = nonce if nonce is not None else os.urandom(16)
    created = created or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
    return (
        f'<wsse:Security s:mustUnderstand="1" xmlns:wsse="{NS["wsse"]}" xmlns:wsu="{NS["wsu"]}">'
        f"<wsse:UsernameToken><wsse:Username>{esc(username)}</wsse:Username>"
        f'<wsse:Password Type="{PASSWORD_DIGEST}">{password_digest(nonce, created, password)}</wsse:Password>'
        f'<wsse:Nonce EncodingType="{NONCE_B64}">{base64.b64encode(nonce).decode("ascii")}</wsse:Nonce>'
        f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security>"
    )


def envelope(body: str, username: str | None = None, password: str | None = None) -> str:
    header = f"<s:Header>{security_header(username, password or '')}</s:Header>" if username else ""
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{NS["s"]}" xmlns:tds="{NS["tds"]}" '
        f'xmlns:trt="{NS["trt"]}" xmlns:tt="{NS["tt"]}">{header}<s:Body>{body}</s:Body></s:Envelope>'
    )


@dataclass
class OnvifProfile:
    token: str
    name: str
    source_token: str | None
    width: int | None = None
    height: int | None = None
    encoding: str | None = None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_all(root: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in root.iter() if _local(e.tag) == name]


def _find(root: ET.Element, name: str) -> ET.Element | None:
    return next((e for e in root.iter() if _local(e.tag) == name), None)


class OnvifClient:
    def __init__(self, host: str, port: int = 80, username: str = "", password: str = "", timeout: float = 5.0,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.device_url = f"http://{url_host(host)}:{port}/onvif/device_service"
        self.username = username
        self.password = password
        self._http = httpx.Client(timeout=timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def _call(self, url: str, action: str, body: str) -> ET.Element:
        headers = {"Content-Type": f'application/soap+xml; charset=utf-8; action="{action}"'}
        try:
            r = self._http.post(url, content=envelope(body, self.username, self.password).encode("utf-8"), headers=headers)
        except httpx.HTTPError as exc:
            raise OnvifError(f"ONVIF {action.rsplit('/', 1)[-1]}: {exc.__class__.__name__}: {exc}") from exc
        text = r.text
        if r.status_code == 401 or "NotAuthorized" in text or "FailedAuthentication" in text:
            raise OnvifError("ONVIF authentication failed", auth=True)
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError as exc:
            raise OnvifError(f"ONVIF {action.rsplit('/', 1)[-1]}: invalid XML (HTTP {r.status_code})") from exc
        fault = _find(root, "Fault")
        if fault is not None or r.status_code >= 400:
            reason = _find(fault, "Text") if fault is not None else None
            raise OnvifError(f"ONVIF {action.rsplit('/', 1)[-1]} failed: {(reason.text if reason is not None else '') or f'HTTP {r.status_code}'}")
        return root

    def media_url(self) -> str:
        """Media service XAddr from GetCapabilities; falls back to the device service URL."""
        try:
            root = self._call(self.device_url, f"{NS['tds']}/GetCapabilities",
                              "<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>")
        except OnvifError as exc:
            if exc.auth:
                raise
            return self.device_url
        media = _find(root, "Media")
        xaddr = _find(media, "XAddr") if media is not None else None
        return xaddr.text.strip() if xaddr is not None and xaddr.text else self.device_url

    def profiles(self, media_url: str) -> list[OnvifProfile]:
        root = self._call(media_url, f"{NS['trt']}/GetProfiles", "<trt:GetProfiles/>")
        out: list[OnvifProfile] = []
        for p in _find_all(root, "Profiles"):
            src = _find(p, "SourceToken")
            name = _find(p, "Name")
            enc = _find(p, "VideoEncoderConfiguration")
            res = _find(enc, "Resolution") if enc is not None else None
            w = _find(res, "Width") if res is not None else None
            h = _find(res, "Height") if res is not None else None
            codec = _find(enc, "Encoding") if enc is not None else None
            out.append(OnvifProfile(
                token=p.get("token", ""), name=(name.text or "") if name is not None else "",
                source_token=src.text if src is not None else None,
                width=int(w.text) if w is not None and w.text else None, height=int(h.text) if h is not None and h.text else None,
                encoding=codec.text if codec is not None else None,
            ))
        return out

    def stream_uri(self, media_url: str, profile_token: str) -> str:
        body = (
            "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>"
            "<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>"
            f"<trt:ProfileToken>{profile_token}</trt:ProfileToken></trt:GetStreamUri>"
        )
        root = self._call(media_url, f"{NS['trt']}/GetStreamUri", body)
        uri = _find(root, "Uri")
        if uri is None or not (uri.text or "").strip():
            raise OnvifError("ONVIF GetStreamUri returned no Uri")
        return uri.text.strip()


def pick_profile(profiles: list[OnvifProfile], channel: int, stream: str = "MAIN") -> OnvifProfile:
    """Channel N = the N-th video source (in first-seen order); MAIN = its first profile, SUB = its second."""
    if not profiles:
        raise OnvifError("ONVIF device has no media profiles")
    groups: dict[str, list[OnvifProfile]] = {}
    for p in profiles:
        groups.setdefault(p.source_token or p.token, []).append(p)
    sources = list(groups.values())
    if len(sources) == 1 and len(profiles) >= channel * 2 and channel > 1:
        # some recorders put every profile under one source: assume (main, sub) pairs per channel
        pair = profiles[(channel - 1) * 2 : (channel - 1) * 2 + 2]
        return pair[1] if stream == "SUB" and len(pair) > 1 else pair[0]
    if channel < 1 or channel > len(sources):
        raise OnvifError(f"ONVIF device has {len(sources)} video source(s); channel {channel} not found")
    group = sources[channel - 1]
    return group[1] if stream == "SUB" and len(group) > 1 else group[0]


def resolve_stream_uri(host: str, http_port: int, username: str, password: str, channel: int, stream: str = "MAIN",
                       timeout: float = 5.0, transport: httpx.BaseTransport | None = None) -> str:
    """The channel's RTSP URL with URL-encoded credentials inserted. Raises :class:`OnvifError`."""
    client = OnvifClient(host, http_port, username, password, timeout=timeout, transport=transport)
    try:
        media = client.media_url()
        profile = pick_profile(client.profiles(media), channel, stream)
        return with_credentials(client.stream_uri(media, profile.token), username, password)
    finally:
        client.close()
