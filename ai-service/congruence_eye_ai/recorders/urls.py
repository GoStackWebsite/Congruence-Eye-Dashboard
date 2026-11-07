"""DVR / NVR RTSP URL templating (contract v3).

Byte-for-byte mirror of ``backend/src/modules/recorders/recorder-url.ts``; both are tested against
``backend/src/modules/recorders/recorder-url.vectors.json``. The backend already sends the real URL to the
edge, so this is used for GENERIC_ONVIF fallbacks, discovery previews, and to rebuild a URL locally.

Placeholders: ``{user}``, ``{pass}`` (URL-encoded), ``{host}``, ``{port}``, ``{channel}`` (1-based, no padding).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import quote

PASSWORD_MASK = "****"

_AUTH = "rtsp://{user}:{pass}@{host}:{port}"


def _realmonitor(sub: int) -> str:
    return f"{_AUTH}/cam/realmonitor?channel={{channel}}&subtype={sub}"


#: brand -> (main template, sub template). CUSTOM uses the recorder's own ``url_template``.
TEMPLATES: dict[str, tuple[str, str]] = {
    "HIKVISION": (f"{_AUTH}/Streaming/Channels/{{channel}}01", f"{_AUTH}/Streaming/Channels/{{channel}}02"),
    "CP_PLUS": (_realmonitor(0), _realmonitor(1)),
    "DAHUA": (_realmonitor(0), _realmonitor(1)),
    "UNIVIEW": (f"{_AUTH}/unicast/c{{channel}}/s0/live", f"{_AUTH}/unicast/c{{channel}}/s1/live"),
    "GODREJ": (_realmonitor(0), _realmonitor(1)),
    "HONEYWELL": (_realmonitor(0), _realmonitor(1)),
    "TIANDY": (f"{_AUTH}/{{channel}}/1", f"{_AUTH}/{{channel}}/2"),
    "GENERIC_ONVIF": (f"{_AUTH}/ch{{channel}}/main", f"{_AUTH}/ch{{channel}}/sub"),
}
BRANDS: tuple[str, ...] = (*TEMPLATES.keys(), "CUSTOM")


@dataclass(frozen=True)
class RecorderUrlInput:
    brand: str
    host: str
    rtsp_port: int = 554
    username: str | None = ""
    url_template: str | None = None


def encode_credential(s: str) -> str:
    """JavaScript ``encodeURIComponent``: unreserved plus ``!'()*`` stay as they are, UTF-8 percent-encoding."""
    return quote(s, safe="!'()*~", encoding="utf-8")


def url_host(host: str) -> str:
    """IPv6 literals are bracketed inside URLs."""
    return f"[{host}]" if ":" in host and not host.startswith("[") else host


def template_for(brand: str, stream: str = "MAIN", url_template: str | None = None) -> str:
    if brand == "CUSTOM":
        return url_template or ""
    main, sub = TEMPLATES.get(brand, TEMPLATES["GENERIC_ONVIF"])
    return sub if stream == "SUB" else main


_USERINFO = re.compile(r"^(rtsp://)([^/@]*)@", re.IGNORECASE)


def _tidy_userinfo(url: str) -> str:
    """Drops an empty password (``user:@`` -> ``user@``) and an empty user-info (``rtsp://@h`` -> ``rtsp://h``)."""

    def repl(m: re.Match[str]) -> str:
        info = m.group(2)
        if info.endswith(":"):
            info = info[:-1]
        return f"{m.group(1)}{info}@" if info else m.group(1)

    return _USERINFO.sub(repl, url, count=1)


def _fill(template: str, r: RecorderUrlInput, channel: int, password_part: str) -> str:
    values = {
        "{user}": encode_credential(r.username or ""),
        "{pass}": password_part,
        "{host}": url_host(r.host),
        "{port}": str(r.rtsp_port),
        "{channel}": str(int(channel)),
    }
    out = template
    for k, v in values.items():
        out = out.replace(k, v)
    return _tidy_userinfo(out)


def build_rtsp_url(r: RecorderUrlInput, channel: int, stream: str = "MAIN", password: str | None = None) -> str:
    """The real URL (password URL-encoded)."""
    return _fill(template_for(r.brand, stream, r.url_template), r, channel, encode_credential(password) if password else "")


def masked_rtsp_url(r: RecorderUrlInput, channel: int, stream: str = "MAIN", has_password: bool = True) -> str:
    """Same as the real URL with the password replaced by ``****``."""
    return _fill(template_for(r.brand, stream, r.url_template), r, channel, PASSWORD_MASK if has_password else "")


_CRED = re.compile(r"(rtsps?|https?)://([^\s/@:]*):([^\s/@]*)@", re.IGNORECASE)


def redact(text: str) -> str:
    """Masks ``user:password@`` in any URL inside free text (logs, ffmpeg stderr, error messages)."""
    return _CRED.sub(lambda m: f"{m.group(1)}://{m.group(2)}:{PASSWORD_MASK}@", text)


def with_credentials(uri: str, username: str | None, password: str | None) -> str:
    """Inserts (URL-encoded) credentials into an rtsp URI that has none, e.g. one returned by ONVIF GetStreamUri."""
    m = re.match(r"^(rtsps?://)([^/]*)(.*)$", uri, re.IGNORECASE)
    if not m or "@" in m.group(2) or not username:
        return uri
    auth = encode_credential(username) + (":" + encode_credential(password) if password else "")
    return f"{m.group(1)}{auth}@{m.group(2)}{m.group(3)}"
