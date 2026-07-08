# RunPod serverless worker for ZKredit RISC Zero proving.
#
# Builds the zkredit-risc0-host binary WITH the `cuda` feature and runs it on the
# worker's own NVIDIA GPU, so `default_prover()` produces a native Groth16 (BN254)
# receipt with NO inner Docker and NO Bento cluster. One container = the whole
# prover. Single stage (fat image, ~a few GB) is deliberate: proving is async, so
# the cold-start cost of a big image is acceptable and correctness beats size.
#
# Build from the REPO ROOT (the build context must include ml/risc0):
#   docker build -f ml/risc0/worker/Dockerfile -t <user>/zkredit-prover:latest .
#   docker push <user>/zkredit-prover:latest
# Then point a RunPod serverless endpoint (NVIDIA L4/A10/etc.) at that image.
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
# risc0 3.0.5's native (Docker-free) Groth16 wrap pulls `circom-witnesscalc`,
# which needs two system build tools (confirmed by resolving the full `-F cuda`
# dep tree with `cargo tree`, not just the base lock):
#   - protobuf-compiler (protoc)  <- prost-build
#   - clang + libclang-dev        <- bindgen/clang-sys, for its graph_witness.h
# The rest of the tree needs only a C compiler (build-essential); no cmake/nasm.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl build-essential pkg-config libssl-dev git ca-certificates \
        protobuf-compiler clang libclang-dev python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# --- Rust ---
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# --- RISC Zero toolchain: rust guest toolchain, r0vm, cargo-risczero ---
# `rzup install` pulls the default component set (incl. the Groth16 prover). The
# native GPU Groth16 path is the assumption to VERIFY on first build — see the
# "Verify the native Groth16 path" section in ml/risc0/worker/README.md. If a
# newer rzup names the GPU groth16 prover as a separate component, add it here.
ENV PATH="/root/.risc0/bin:${PATH}"
RUN curl -L https://risczero.com/install | bash \
    && rzup install

# --- Build the host binary with GPU proving enabled ---
# The guest ELF is embedded at build time by risc0-build, so there is no separate
# ELF to copy. Path deps (../methods, ../model) resolve within the copied tree.
#
# risc0-circuit-rv32im-sys's build.rs defaults nvcc to `-arch=native`, which
# queries a live GPU via the CUDA runtime to detect its compute capability --
# but a `docker build` step has no GPU device passed through (even on a
# GPU-backed builder host), so autodetection fails with a hard compile error.
# Its build.rs skips `-arch=native` if NVCC_APPEND_FLAGS is set, so pin the
# target GPU's compute capability explicitly. sm_89 = Ada Lovelace (L4, RTX 4090).
# Override ARG CUDA_ARCH at build time for a different GPU (A10=sm_86, A100=sm_80).
ARG CUDA_ARCH=sm_89
ENV NVCC_APPEND_FLAGS="-arch=${CUDA_ARCH}"
WORKDIR /build
COPY ml/risc0 ./ml/risc0
ENV RUSTFLAGS="-C target-cpu=native"
RUN cd ml/risc0/host \
    && cargo build --release -F cuda \
    && cp target/release/zkredit-risc0-host /usr/local/bin/zkredit-risc0-host \
    && rm -rf /build/ml/risc0/host/target

# --- Python serverless handler ---
ENV ZKREDIT_HOST_BIN=/usr/local/bin/zkredit-risc0-host
COPY ml/risc0/worker/requirements.txt /worker/requirements.txt
RUN pip3 install --no-cache-dir -r /worker/requirements.txt
COPY ml/risc0/worker/handler.py /worker/handler.py

CMD ["python3", "-u", "/worker/handler.py"]
