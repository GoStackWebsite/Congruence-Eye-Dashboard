"""Pure-logic analytics modules (no cv2 required)."""

from .camera_health import CameraHealth
from .demographics import AgeGenderEstimator, DemographicsVoter, HintEstimator, NullEstimator, age_to_band
from .group_detector import GroupDetector
from .heatmap import HeatmapAccumulator
from .line_counter import Crossing, LineCounter, StoreDwellTracker
from .queue_monitor import QueueMonitor, QueueReading, UnattendedAlert
from .reid import ReIdGallery, appearance_embedding, fallback_visitor_id
from .staff import StaffClassifier, uniform_ratio
from .storeops import FrameStats, OpsEvent, StoreOpsConfig, StoreOpsMonitor, frame_stats
from .zone_tracker import ZoneTracker, ZoneTransition

__all__ = [
    "AgeGenderEstimator",
    "CameraHealth",
    "Crossing",
    "DemographicsVoter",
    "FrameStats",
    "GroupDetector",
    "HeatmapAccumulator",
    "HintEstimator",
    "LineCounter",
    "NullEstimator",
    "OpsEvent",
    "QueueMonitor",
    "QueueReading",
    "ReIdGallery",
    "StaffClassifier",
    "StoreDwellTracker",
    "StoreOpsConfig",
    "StoreOpsMonitor",
    "UnattendedAlert",
    "ZoneTracker",
    "ZoneTransition",
    "age_to_band",
    "appearance_embedding",
    "fallback_visitor_id",
    "frame_stats",
    "uniform_ratio",
]
