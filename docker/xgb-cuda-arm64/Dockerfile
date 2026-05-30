FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 \
    python3-dev \
    python3-pip \
    git \
    cmake \
    ninja-build \
    build-essential \
    libomp-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --upgrade pip setuptools wheel

RUN python3 -m pip install \
    numpy \
    scipy \
    pandas \
    scikit-learn \
    packaging

WORKDIR /opt

RUN git clone --recursive --branch v2.1.4 https://github.com/dmlc/xgboost.git

WORKDIR /opt/xgboost

RUN rm -rf build && mkdir build && cd build && \
    cmake .. \
      -GNinja \
      -DUSE_CUDA=ON \
      -DUSE_NCCL=OFF \
      -DUSE_OPENMP=ON \
      -DCMAKE_BUILD_TYPE=Release && \
    ninja -j$(nproc)

WORKDIR /opt/xgboost/python-package

RUN python3 -m pip install .

WORKDIR /workspace/ML

CMD ["/bin/bash"]