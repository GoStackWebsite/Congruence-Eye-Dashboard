#!/usr/bin/env bash
# Download model weights used by the AI service into ./models (run at deploy time / docker build).
#   YOLO person detector  : yolo11n.pt (default) and yolov8n.pt (fallback)  — Ultralytics GitHub releases
#   Demographics (optional): OpenCV SSD face detector + Levi-Hassner age/gender Caffe models
# Usage: scripts/download_models.sh [--no-demographics] [--yolo yolo11s.pt]
set -euo pipefail

cd "$(dirname "$0")/.."
MODELS_DIR="${MODELS_DIR:-models}"
mkdir -p "$MODELS_DIR"

YOLO_MODELS=("yolo11n.pt")
WITH_DEMOGRAPHICS=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-demographics) WITH_DEMOGRAPHICS=0 ;;
    --yolo) shift; YOLO_MODELS=("$1") ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

YOLO_BASE="${YOLO_BASE:-https://github.com/ultralytics/assets/releases/download/v8.4.0}"
DEMO_BASE="${DEMO_BASE:-https://raw.githubusercontent.com/smahesh29/Gender-and-Age-Detection/master}"

fetch() { # url dest
  local url="$1" dest="$2"
  if [[ -s "$dest" ]]; then echo "  ok      $dest"; return 0; fi
  echo "  fetch   $url"
  if ! curl -fSL --retry 3 --retry-delay 2 -o "$dest.part" "$url"; then
    rm -f "$dest.part"; echo "  FAILED  $url" >&2; return 1
  fi
  mv "$dest.part" "$dest"
}

echo "YOLO weights -> $MODELS_DIR"
for m in "${YOLO_MODELS[@]}"; do
  fetch "$YOLO_BASE/$m" "$MODELS_DIR/$m" || fetch "https://github.com/ultralytics/assets/releases/download/v8.3.0/$m" "$MODELS_DIR/$m"
done

if [[ "$WITH_DEMOGRAPHICS" == 1 ]]; then
  echo "Demographics models -> $MODELS_DIR (optional; failures are not fatal)"
  for f in opencv_face_detector.pbtxt opencv_face_detector_uint8.pb age_deploy.prototxt age_net.caffemodel gender_deploy.prototxt gender_net.caffemodel; do
    fetch "$DEMO_BASE/$f" "$MODELS_DIR/$f" || true
  done
fi
echo "done."
