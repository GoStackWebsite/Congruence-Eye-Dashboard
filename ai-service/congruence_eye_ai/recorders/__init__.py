"""DVR / NVR support (contract v3): URL templates, ONVIF stream URIs, RTSP connection tests, LAN discovery."""

from .urls import BRANDS, RecorderUrlInput, build_rtsp_url, masked_rtsp_url, redact

__all__ = ["BRANDS", "RecorderUrlInput", "build_rtsp_url", "masked_rtsp_url", "redact"]
