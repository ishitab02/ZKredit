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

# --- RISC Zero toolchain, pinned to 3.0.5 (must match contracts/shared/src/risc0.rs
# and the host Cargo.lock, or receipts won't verify on-chain) ---
# Same rust/cargo-risczero/r0vm pins as the repo-root Dockerfile, PLUS the
# `risc0-groth16` component: the default `rzup install` does NOT include the
# native Groth16 prover, so a standalone worker (which does the STARK→SNARK wrap
# locally, unlike the old Fly client that offloaded to Bento) fails at prove time
# with "Missing required risc0-groth16 rzup component ... Version not found: 0.1.0".
# 0.1.0 is the component version risc0-zkvm 3.0.5's prover requests.
ENV PATH="/root/.risc0/bin:${PATH}"
RUN curl -L https://risczero.com/install | bash \
    && rzup install rust 1.94.1 \
    && rzup install cargo-risczero 3.0.5 \
    && rzup install r0vm 3.0.5 \
    && rzup install risc0-groth16 0.1.0

# --- Build the host binary with GPU proving enabled ---
# The guest ELF is embedded at build time by risc0-build, so there is no separate
# ELF to copy. Path deps (../methods, ../model) resolve within the copied tree.
#
# risc0-circuit-rv32im-sys's build.rs defaults nvcc to `-arch=native`, which
# queries a live GPU via the CUDA runtime to detect its compute capability --
# but a `docker build` step has no GPU device passed through (even on a
# GPU-backed builder host), so autodetection fails with a hard compile error.
# Its build.rs skips `-arch=native` if NVCC_APPEND_FLAGS is set.
#
# Pinning a SINGLE arch here is fragile: this RunPod endpoint's "Enabled GPU
# types" pool has BOTH RTX 3090 (Ampere, sm_86) and L4 (Ada Lovelace, sm_89)
# checked -- two different architectures, and which one a worker actually gets
# varies per instance. A SASS binary built for the wrong compute capability
# doesn't fail cleanly -- it runs and crashes at prove time with a CUDA "illegal
# memory access" deep in sppark's kernels (confirmed: this exact crash happened
# when the image was pinned to sm_89 alone, almost certainly a 3090-scheduled run).
#
# Fix: compile a fat binary covering every architecture this project might see
# (A100=sm_80, RTX 3090/A10/A30=sm_86, L4/RTX4090/RTX6000-Ada=sm_89), plus embed
# compute_89 PTX so the driver can JIT for any newer/other GPU not listed
# explicitly (e.g. if a Blackwell type is enabled later in the pool).
ENV NVCC_APPEND_FLAGS="-gencode=arch=compute_80,code=sm_80 -gencode=arch=compute_86,code=sm_86 -gencode=arch=compute_89,code=sm_89 -gencode=arch=compute_89,code=compute_89"
WORKDIR /build
COPY ml/risc0 ./ml/risc0
# NOT target-cpu=native: that pins Rust codegen to the BUILD machine's exact CPU
# (AVX-512 etc.), which is the same class of bug as the CUDA arch issue above if
# RunPod's build infra runs on different silicon than the serving worker -- and
# there's no CPU-bound hot path here to justify the risk (the actual proving
# work is on the GPU via CUDA/sppark, not Rust-level SIMD). Default codegen only.
# `--locked` is load-bearing, not hygiene. `risc0-groth16-sys` and `risc0-sys`
# compile the HEADER-ONLY C++ of sppark/blst straight into their CUDA kernels,
# and `risc0-groth16-sys` requests `sppark = "0.1.12"` -- i.e. `^0.1.12`, which
# lets cargo silently pick 0.1.15. Those releases change `affine_t::mem_t`'s
# layout for 32-byte fields (BN254) plus mont_t/jacobian_t/ntt/gpu_t, so an
# unlocked build compiles RISC Zero's MSM against C++ headers it was never
# tested on -> "illegal memory access" in sppark at Groth16 wrap time. Cargo.lock
# pins sppark 0.1.12 / blst 0.3.15 to match risc0 v3.0.5's own lock; --locked
# makes a drifting lock fail the build instead of shipping a broken kernel.
RUN cd ml/risc0/host \
    && cargo build --release -F cuda --locked \
    && cp target/release/zkredit-risc0-host /usr/local/bin/zkredit-risc0-host \
    && rm -rf /build/ml/risc0/host/target

# --- Assert the vendored risc0-sys bounds fix actually compiled in ---
# `[patch.crates-io]` fails *silently* in several ways (wrong workspace root, a
# reused cargo layer, a stale `:latest` image on the worker). Each one costs a
# full build+deploy+prove cycle to discover at runtime. cuobjdump needs no GPU,
# so assert it here instead: the patched kernels take an extra `uint32_t count`,
# which shows up in the mangled name as a trailing `j` (Itanium ABI: unsigned
# int). Unpatched 1.5.0 mangles to ...P2Fp / ...P5FpExt. If this grep fails the
# image is unshippable and the build stops, rather than hard-faulting on a GPU.
RUN set -eu; \
    syms="$(cuobjdump --dump-elf-symbols /usr/local/bin/zkredit-risc0-host \
            | grep -o '_Z[0-9]*eltwise_zeroize[A-Za-z0-9_]*' | sort -u)"; \
    echo "eltwise_zeroize symbols in binary:"; echo "$syms"; \
    echo "$syms" | grep -q 'eltwise_zeroize_fpP2Fpj' \
        || { echo "FATAL: eltwise_zeroize_fp is UNPATCHED (risc0-sys patch did not apply)"; exit 1; }; \
    echo "$syms" | grep -q 'eltwise_zeroize_fpextP5FpExtj' \
        || { echo "FATAL: eltwise_zeroize_fpext is UNPATCHED (risc0-sys patch did not apply)"; exit 1; }; \
    echo "OK: vendored risc0-sys bounds fix is present in the built binary"

# --- Assert the C++ header pins, and record them in the image ---
# sppark/blst are header-only and get compiled INTO the CUDA kernels, so their
# resolved versions are a property of the binary, not of any runtime env var.
# Bake them where the handler can read them: a job result then reports exactly
# which headers built the MSM, with no build-arg plumbing required.
RUN set -eu; \
    lock=/build/ml/risc0/host/Cargo.lock; \
    ver() { grep -A1 "^name = \"$1\"\$" "$lock" | sed -n 's/^version = "\(.*\)"$/\1/p' | head -1; }; \
    sppark="$(ver sppark)"; blst="$(ver blst)"; zkvm="$(ver risc0-zkvm)"; \
    [ "$sppark" = "0.1.12" ] || { echo "FATAL: sppark $sppark != 0.1.12 (risc0 v3.0.5 pin)"; exit 1; }; \
    [ "$blst" = "0.3.15" ] || { echo "FATAL: blst $blst != 0.3.15 (risc0 v3.0.5 pin)"; exit 1; }; \
    printf '{"sppark":"%s","blst":"%s","risc0_zkvm":"%s"}\n' "$sppark" "$blst" "$zkvm" \
        > /etc/zkredit-build-info.json; \
    echo "OK: header pins match risc0 v3.0.5 -> $(cat /etc/zkredit-build-info.json)"

# --- Python serverless handler ---
ENV ZKREDIT_HOST_BIN=/usr/local/bin/zkredit-risc0-host
COPY ml/risc0/worker/requirements.txt /worker/requirements.txt
RUN pip3 install --no-cache-dir -r /worker/requirements.txt
COPY ml/risc0/worker/handler.py /worker/handler.py

# --- Build identity (LAST: an ARG this late can't invalidate the cargo layer) ---
# RunPod workers cache images per node, and re-pushing a mutable tag like
# `:latest` does not reliably force a re-pull -- an endpoint can keep serving a
# months-old digest. That turns "the fix didn't work" and "the fix never shipped"
# into the same observation. Stamp the build here and have handler.py echo it in
# every response, so the running image is always identifiable from a job result.
# Pass it at build time:  docker build --build-arg BUILD_ID=$(git rev-parse --short HEAD) ...
ARG BUILD_ID=dev
ENV ZKREDIT_BUILD_ID=${BUILD_ID}

CMD ["python3", "-u", "/worker/handler.py"]
