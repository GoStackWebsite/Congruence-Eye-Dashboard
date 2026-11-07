"""LAN discovery of recorders and cameras (contract v3, ``POST /ai/discover``).

Two passes run in parallel, both capped by ``DISCOVERY_TIMEOUT_SEC`` (10 s):

* **WS-Discovery**: an ONVIF ``Probe`` (NetworkVideoTransmitter) to 239.255.255.250:3702; every ``ProbeMatch``
  gives the device's XAddr (host + HTTP port) and scopes (vendor / model hints).
* **RTSP port scan** of the edge's local /24 (or ``DISCOVERY_SUBNET``): a TCP connect to 554 (``DISCOVERY_PORTS``)
  on every address, then an RTSP ``OPTIONS`` whose ``Server:`` header hints at the brand.

Result: ``{ host, port, brandGuess, onvif, httpPort }`` per device, sorted by IP.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
import struct
import time
import uuid
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

WSD_ADDR = ("239.255.255.250", 3702)

_BRANDS: list[tuple[str, re.Pattern[str]]] = [
    ("HIKVISION", re.compile(r"hikvision|hik-?connect|hilook|prama|\bDS-\d|App-webs|DNVRS-Webs", re.I)),
    ("CP_PLUS", re.compile(r"cp[\s_-]?plus|cpplus|\bCP-U", re.I)),
    ("DAHUA", re.compile(r"dahua|\bDH-|\bIPC-HFW|\bNVR\d{4}-|Rtsp Server/2\.0", re.I)),
    ("UNIVIEW", re.compile(r"uniview|\bUNV\b|\bIPC\d{4}-", re.I)),
    ("GODREJ", re.compile(r"godrej", re.I)),
    ("HONEYWELL", re.compile(r"honeywell", re.I)),
    ("TIANDY", re.compile(r"tiandy", re.I)),
]


def guess_brand(*hints: str | None) -> str | None:
    text = " ".join(h for h in hints if h)
    for brand, rx in _BRANDS:
        if rx.search(text):
            return brand
    return None


@dataclass
class DiscoveredDevice:
    host: str
    port: int = 554
    brandGuess: str | None = None  # noqa: N815 - contract field name
    onvif: bool = False
    httpPort: int | None = None  # noqa: N815

    def contract(self) -> dict[str, object]:
        """The ``POST /ai/discover`` shape: ``{ host, port, brandGuess, onvif }``."""
        return {"host": self.host, "port": self.port, "brandGuess": self.brandGuess, "onvif": self.onvif}

    def to_payload(self) -> dict[str, object]:
        """The ``POST /api/ingest/discovered`` item (adds ``httpPort``)."""
        return {k: v for k, v in asdict(self).items() if v is not None or k == "brandGuess"}


# ------------------------------------------------------------------------------------------- WS-Discovery
def wsd_probe_message(message_id: str | None = None) -> bytes:
    mid = message_id or f"uuid:{uuid.uuid4()}"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        f"<e:Header><w:MessageID>{mid}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>"
        "<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>"
        "<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>"
    ).encode("utf-8")


_XADDRS = re.compile(r"<(?:\w+:)?XAddrs>([^<]*)</(?:\w+:)?XAddrs>", re.I)
_SCOPES = re.compile(r"<(?:\w+:)?Scopes[^>]*>([^<]*)</(?:\w+:)?Scopes>", re.I)


def parse_probe_match(xml: str, sender: str | None = None) -> list[DiscoveredDevice]:
    """Devices in a WS-Discovery ProbeMatches reply (one per distinct XAddr host)."""
    out: dict[str, DiscoveredDevice] = {}
    scopes = " ".join(_SCOPES.findall(xml))
    brand = guess_brand(scopes.replace("%20", " "))
    for block in _XADDRS.findall(xml):
        for addr in block.split():
            try:
                u = urlsplit(addr)
            except ValueError:
                continue
            if not u.hostname:
                continue
            host = u.hostname
            try:
                ipaddress.ip_address(host)
            except ValueError:
                if sender:
                    host = sender
            if host in out:
                continue
            out[host] = DiscoveredDevice(host=host, port=554, brandGuess=brand or "GENERIC_ONVIF", onvif=True,
                                         httpPort=u.port or (443 if u.scheme == "https" else 80))
    if not out and sender and "ProbeMatch" in xml:
        out[sender] = DiscoveredDevice(host=sender, brandGuess=brand or "GENERIC_ONVIF", onvif=True, httpPort=80)
    return list(out.values())


def ws_discovery(timeout: float = 3.0, interface_ip: str | None = None) -> list[DiscoveredDevice]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, struct.pack("b", 2))
        if interface_ip:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(interface_ip))
        sock.settimeout(0.3)
        sock.sendto(wsd_probe_message(), WSD_ADDR)
        found: dict[str, DiscoveredDevice] = {}
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                data, (ip, _) = sock.recvfrom(65535)
            except socket.timeout:
                continue
            for d in parse_probe_match(data.decode("utf-8", "replace"), ip):
                found.setdefault(d.host, d)
        return list(found.values())
    except OSError as exc:
        log.info("WS-Discovery unavailable: %s", exc)
        return []
    finally:
        sock.close()


# ------------------------------------------------------------------------------------------- port scan
def local_ipv4() -> str | None:
    """The address of the interface that routes outward (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def subnet_hosts(subnet: str | None = None, ip: str | None = None) -> list[str]:
    if subnet:
        net = ipaddress.ip_network(subnet, strict=False)
    else:
        ip = ip or local_ipv4()
        if not ip:
            return []
        net = ipaddress.ip_network(f"{ip}/24", strict=False)
    hosts = list(net.hosts()) if net.num_addresses > 2 else list(net)
    return [str(h) for h in hosts[:1024]]


def rtsp_server_header(host: str, port: int, timeout: float = 1.0) -> str | None:
    """``Server:`` header of an RTSP OPTIONS reply (brand hint), or None."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(f"OPTIONS rtsp://{host}:{port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: CongruenceEye-Discovery\r\n\r\n".encode())
            data = b""
            while b"\r\n\r\n" not in data and len(data) < 8192:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
    except OSError:
        return None
    m = re.search(rb"^Server:\s*(.+?)\r?$", data, re.I | re.M)
    return m.group(1).decode("utf-8", "replace").strip() if m else ("" if data.startswith(b"RTSP/") else None)


def port_open(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def port_scan(hosts: Iterable[str], ports: Iterable[int] = (554,), timeout: float = 0.5, deadline: float | None = None,
              workers: int = 64) -> list[DiscoveredDevice]:
    targets = [(h, p) for h in hosts for p in ports]
    out: list[DiscoveredDevice] = []
    if not targets:
        return out
    pool = ThreadPoolExecutor(max_workers=min(workers, len(targets)), thread_name_prefix="discover")
    try:
        futs = {pool.submit(port_open, h, p, timeout): (h, p) for h, p in targets}
        remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
        try:
            for f in as_completed(futs, timeout=remaining):
                if f.result():
                    h, p = futs[f]
                    server = rtsp_server_header(h, p, timeout=min(1.0, max(0.2, (deadline or time.monotonic() + 1) - time.monotonic())))
                    out.append(DiscoveredDevice(host=h, port=p, brandGuess=guess_brand(server)))
        except TimeoutError:
            log.info("discovery port scan stopped at the deadline")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out


def _ip_key(host: str) -> tuple[int, object]:
    try:
        return (0, ipaddress.ip_address(host))
    except ValueError:
        return (1, host)


def discover(timeout: float = 10.0, subnet: str | None = None, ports: Iterable[int] = (554,), ws_discovery_enabled: bool = True,
             scan_enabled: bool = True, connect_timeout: float = 0.5) -> list[DiscoveredDevice]:
    """WS-Discovery + RTSP port scan in parallel, merged by host, all within ``timeout`` seconds."""
    deadline = time.monotonic() + timeout
    ports = list(ports)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="discover-main") as ex:
        wsd = ex.submit(ws_discovery, min(3.0, timeout * 0.5)) if ws_discovery_enabled else None
        scan = ex.submit(port_scan, subnet_hosts(subnet), ports, connect_timeout, deadline - 0.3) if scan_enabled else None
        onvif = wsd.result() if wsd else []
        scanned = scan.result() if scan else []
    merged: dict[str, DiscoveredDevice] = {}
    for d in scanned:
        merged.setdefault(d.host, d)
    for d in onvif:
        cur = merged.get(d.host)
        if cur is None:
            merged[d.host] = d
        else:
            cur.onvif = True
            cur.httpPort = d.httpPort
            if not cur.brandGuess or cur.brandGuess == "GENERIC_ONVIF":
                cur.brandGuess = d.brandGuess
    return sorted(merged.values(), key=lambda d: _ip_key(d.host))
