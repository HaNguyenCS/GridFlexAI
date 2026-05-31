# GridFlex ML service — build once (with internet), run offline on ASUS GX10.
# Build on Mac:  docker build --platform linux/arm64 -t gridflex-ml:latest -f docker/ml-service/Dockerfile .
# Save for GX10: docker save gridflex-ml:latest | gzip > gridflex-ml-arm64.tar.gz
# Load on GX10:  gunzip -c gridflex-ml-arm64.tar.gz | docker load

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libomp-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY ML/requirements_asus.txt ./requirements_asus.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements_asus.txt

COPY ML/ ./ML/

WORKDIR /app/ML

EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8002/health')"

CMD ["python3", "-m", "uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8002"]
