"""The Python URL templating must produce exactly the backend's URLs (contract v3)."""

from __future__ import annotations

import json
import os
import random
import shutil
import string
import subprocess
from pathlib import Path

import pytest

from congruence_eye_ai.recorders.urls import (
    BRANDS,
    RecorderUrlInput,
    build_rtsp_url,
    encode_credential,
    masked_rtsp_url,
    redact,
    template_for,
    with_credentials,
)

BACKEND = Path(os.environ.get("CE_BACKEND_DIR", Path(__file__).resolve().parents[2] / "backend"))
VECTORS = BACKEND / "src" / "modules" / "recorders" / "recorder-url.vectors.json"


def _inp(d: dict) -> RecorderUrlInput:
    return RecorderUrlInput(brand=d["brand"], host=d["host"], rtsp_port=d["rtspPort"], username=d.get("username"), url_template=d.get("urlTemplate"))


def test_brand_list_matches_contract() -> None:
    assert BRANDS == ("HIKVISION", "CP_PLUS", "DAHUA", "UNIVIEW", "GODREJ", "HONEYWELL", "TIANDY", "GENERIC_ONVIF", "CUSTOM")


@pytest.mark.parametrize(
    "brand,stream,channel,expected",
    [
        ("HIKVISION", "MAIN", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/Streaming/Channels/301"),
        ("HIKVISION", "SUB", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/Streaming/Channels/302"),
        ("HIKVISION", "MAIN", 12, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/Streaming/Channels/1201"),
        ("CP_PLUS", "MAIN", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/cam/realmonitor?channel=3&subtype=0"),
        ("DAHUA", "SUB", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/cam/realmonitor?channel=3&subtype=1"),
        ("UNIVIEW", "SUB", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/unicast/c3/s1/live"),
        ("GODREJ", "MAIN", 1, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/cam/realmonitor?channel=1&subtype=0"),
        ("HONEYWELL", "SUB", 2, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/cam/realmonitor?channel=2&subtype=1"),
        ("TIANDY", "SUB", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/3/2"),
        ("GENERIC_ONVIF", "MAIN", 3, "rtsp://admin:p%40ss%3Aw%2Frd%231@10.0.0.20:554/ch3/main"),
    ],
)
def test_every_brand(brand: str, stream: str, channel: int, expected: str) -> None:
    r = RecorderUrlInput(brand, "10.0.0.20", 554, "admin")
    assert build_rtsp_url(r, channel, stream, "p@ss:w/rd#1") == expected
    assert masked_rtsp_url(r, channel, stream, True) == expected.replace("p%40ss%3Aw%2Frd%231", "****")


def test_custom_ipv6_and_empty_credentials() -> None:
    custom = RecorderUrlInput("CUSTOM", "10.0.0.20", 8554, "admin", "rtsp://{user}:{pass}@{host}:{port}/c{channel}?ch={channel}")
    assert build_rtsp_url(custom, 4, "SUB", "x/y") == "rtsp://admin:x%2Fy@10.0.0.20:8554/c4?ch=4"
    assert build_rtsp_url(RecorderUrlInput("HIKVISION", "fe80::1", 554, "admin"), 1, "MAIN", "pw") == "rtsp://admin:pw@[fe80::1]:554/Streaming/Channels/101"
    assert build_rtsp_url(RecorderUrlInput("DAHUA", "10.0.0.20", 554, "admin"), 1, "MAIN", None) == "rtsp://admin@10.0.0.20:554/cam/realmonitor?channel=1&subtype=0"
    assert build_rtsp_url(RecorderUrlInput("TIANDY", "10.0.0.20", 554, ""), 1, "MAIN", "") == "rtsp://10.0.0.20:554/1/1"
    assert template_for("CUSTOM", "MAIN", None) == ""


def test_encode_credential_is_encode_uri_component() -> None:
    assert encode_credential("p@ss:w/rd#1") == "p%40ss%3Aw%2Frd%231"
    assert encode_credential("A-z_0.9!~*'()") == "A-z_0.9!~*'()"
    assert encode_credential("ü %+&=?") == "%C3%BC%20%25%2B%26%3D%3F"


@pytest.mark.skipif(not VECTORS.exists(), reason="backend checkout not available")
def test_shared_vectors_with_the_backend() -> None:
    data = json.loads(VECTORS.read_text())
    assert len(data["cases"]) > 50
    for c in data["cases"]:
        r = _inp(c["input"])
        assert (c["name"], build_rtsp_url(r, c["channel"], c["stream"], c["password"])) == (c["name"], c["expected"])
        assert (c["name"], masked_rtsp_url(r, c["channel"], c["stream"], bool(c["password"]))) == (c["name"], c["expectedMasked"])


@pytest.mark.skipif(shutil.which("node") is None or not (BACKEND / "node_modules" / ".bin" / "ts-node").exists(), reason="node / backend not available")
def test_randomised_cross_check_against_the_typescript_helper(tmp_path: Path) -> None:
    """Random hosts, users, passwords (incl. unicode and URL-special characters) through both implementations."""
    rng = random.Random(42)
    alphabet = string.ascii_letters + string.digits + "@:/#?&=%+ !*'()~-_.,;$[]Üé€"
    cases = []
    for i in range(300):
        brand = rng.choice(BRANDS)
        cases.append({
            "input": {
                "brand": brand,
                "host": rng.choice(["10.0.0.20", "fe80::1", "dvr.local", "192.168.1.64", "[2001:db8::1]"]),
                "rtspPort": rng.choice([554, 8554, 10554]),
                "username": "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 8))),
                "urlTemplate": "rtsp://{user}:{pass}@{host}:{port}/x/{channel}/{channel}" if brand == "CUSTOM" else None,
            },
            "channel": rng.randint(1, 64),
            "stream": rng.choice(["MAIN", "SUB"]),
            "password": "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 12))) if i % 7 else None,
        })
    (tmp_path / "cases.json").write_text(json.dumps(cases))
    script = tmp_path / "x.ts"
    script.write_text(
        f"import {{ buildRtspUrl, maskedRtspUrl }} from {json.dumps(str(BACKEND / 'src/modules/recorders/recorder-url'))};\n"
        "const cases = require(process.argv[2]);\n"
        "console.log(JSON.stringify(cases.map((c: any) => [buildRtspUrl(c.input, c.channel, c.stream, c.password), maskedRtspUrl(c.input, c.channel, c.stream, !!c.password)])));\n"
    )
    out = subprocess.run([str(BACKEND / "node_modules/.bin/ts-node"), "-T", "--project", str(BACKEND / "tsconfig.json"), str(script), str(tmp_path / "cases.json")],
                         capture_output=True, text=True, timeout=120, cwd=BACKEND)
    assert out.returncode == 0, out.stderr
    ts = json.loads(out.stdout)
    for c, (real, masked) in zip(cases, ts):
        r = _inp(c["input"])
        assert build_rtsp_url(r, c["channel"], c["stream"], c["password"]) == real, c
        assert masked_rtsp_url(r, c["channel"], c["stream"], bool(c["password"])) == masked, c


def test_redact_and_with_credentials() -> None:
    assert redact("open rtsp://admin:p%40ss@10.0.0.20:554/x failed") == "open rtsp://admin:****@10.0.0.20:554/x failed"
    assert redact("rtsp://10.0.0.20/x") == "rtsp://10.0.0.20/x"
    assert with_credentials("rtsp://10.0.0.20:554/Streaming/Channels/101", "admin", "p@ss") == "rtsp://admin:p%40ss@10.0.0.20:554/Streaming/Channels/101"
    assert with_credentials("rtsp://u:p@10.0.0.20/x", "admin", "x") == "rtsp://u:p@10.0.0.20/x"
    assert with_credentials("rtsp://10.0.0.20/x", "", "x") == "rtsp://10.0.0.20/x"
