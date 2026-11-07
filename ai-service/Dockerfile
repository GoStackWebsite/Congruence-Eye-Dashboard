# Congruence Eye AI service (CPU). Build:  docker build -t congruence-eye-ai .
# GPU (NVIDIA): build with --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu124 and run with --gpus all, DEVICE=0
FROM python:3.11-slim

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ARG DOWNLOAD_MODELS=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_PATH=/app/models/yolo11n.pt \
    MODELS_DIR=/app/models \
    SPOOL_DIR=/data/spool \
    YOLO_CONFIG_DIR=/tmp/ultralytics

# ffmpeg libs for RTSP/H.264/H.265 decoding by OpenCV, curl for model download
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 ffmpeg curl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --index-url ${TORCH_INDEX} torch torchvision
COPY requirements.txt .
RUN pip install -r requirements.txt \
    # ultralytics pulls the GUI opencv build; keep only the headless one (pinned < 5)
    && pip uninstall -y opencv-python || true \
    && pip install --force-reinstall --no-deps "opencv-python-headless>=4.9,<5"

COPY scripts ./scripts
RUN if [ "$DOWNLOAD_MODELS" = "1" ]; then bash scripts/download_models.sh || echo "model download failed; mount /app/models at runtime"; fi

COPY congruence_eye_ai ./congruence_eye_ai
COPY tests ./tests
COPY pyproject.toml README.md ./

RUN useradd --create-home --uid 10001 edge && mkdir -p /data/spool && chown -R edge /data /app
USER edge
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fs http://localhost:8000/health || exit 1
CMD ["python", "-m", "congruence_eye_ai", "run"]
