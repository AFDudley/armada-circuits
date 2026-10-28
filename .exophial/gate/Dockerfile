# armada-circuits commit-boundary gate image (D49, ADR
# exophial/docs/decisions/2026-10-14-gate-runs-in-a-container-built-from-the-judged-commit.md).
# The pattern is armada-sdk's and armada-poc's .exophial/gate/Dockerfile.
#
# gate_container.build_gate_image builds this image from the judged commit's
# own tree: a tar of the working tree (with .git and .scratch excluded)
# streamed to `podman build --quiet -f .exophial/gate/Dockerfile -` (rootless
# Podman, exo-b3a.1, operator decision 2026-10-22; superseded Docker as the
# gate's own runtime). gate_container.run_in_container then runs the
# configured gate.command as the sole process: `podman run --rm -i`, NO -v,
# NO -e, NO --privileged (the exo-865 docker+privileged default is also
# superseded; a rootless-podman run grants only the scoped nested-container
# capability flags the gate always carries, never host-root). The image's
# own ENV / HOME / WORKDIR are all the container sees (D49.5/D49.6).
#
# The gate.command (.exophial/config.yaml) is, in one shell:
#   npm ci --offline --no-audit --no-fund
#   pre-commit run --all-files
#   CIRCOM_BIN=node_modules/.bin/circom2 npm run compile   (scripts/compile.sh,
#       21 circuit shapes)
#   npm test                 (scripts/test.sh: circomspect static analysis via
#                              `npm run lint:circom`, then the JS test
#                              placeholder)
#
# So every tool those steps invoke is IMAGE CONTENT, pinned to the version the
# host runs today:
#   python 3.12 + uv + git + the exophial wheel -> from exophial-e2e-base
#       (the local hooks call exophial-check-claude-md,
#        exophial-reroute-main-commit, exophial-check-subtree-edits,
#        exophial-session-trailer)
#   node 24.18.0 + npm 11.16.0    -> npm ci, eslint, prettier
#   circom2 npm package 0.2.22 (circom compiler 2.2.2) -> `npm run compile`;
#       the circom2 package ships its own wasm/native compiler, so pinning the
#       npm package pins the compiler
#   circomspect 0.9.0             -> `npm run lint:circom`
#   pre-commit 4.5.1              -> `pre-commit run --all-files`
#   the npm cache                 -> npm ci --offline
#   the pre-commit hook environments (incl. the node-language eslint/prettier
#       hook envs, which need their own npm installs) -> pre-commit run --all-files
#
# circom2 cannot read a symlinked node_modules. `npm ci` in this image writes
# a plain, non-symlinked node_modules (no npm/pnpm workspace, no `npm link`),
# so `CIRCOM_BIN=node_modules/.bin/circom2` resolves to a real file at gate
# time.
#
# circomspect has no published Linux binary release (checked the v0.9.0
# GitHub release: zero assets), so it is built from source with cargo in a
# throwaway stage and only the built binary is copied into the final image —
# the final image carries no Rust toolchain. The gate's own runtime is
# rootless podman (exo-b3a.1), which has no unqualified-search-registries
# configured on this host, so a short image name like `rust:1.88.0-bookworm`
# fails to resolve unless it is already in podman's local store (it is not —
# podman and docker keep separate stores). The base image name is therefore
# fully qualified with its registry host, the same way armada-poc's
# `ghcr.io/foundry-rs/foundry:v1.8.3` is.
FROM docker.io/library/rust:1.88.0-bookworm AS circomspect-builder
RUN cargo install circomspect --version 0.9.0 --locked

FROM exophial-e2e-base

USER root
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl xz-utils ca-certificates build-essential pkg-config git \
    && rm -rf /var/lib/apt/lists/*

# --- Node 24.18.0 + npm 11.16.0 (the host's versions) ---
RUN curl -fsSL https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz \
        | tar -xJ -C /usr/local --strip-components=1 \
    && npm install -g npm@11.16.0

# --- circomspect 0.9.0 (the host's version), copied from the builder stage ---
COPY --from=circomspect-builder /usr/local/cargo/bin/circomspect /usr/local/bin/circomspect

# --- pre-commit 4.5.1 (the host's version) on PATH via uv tool, alongside the
#     exophial console scripts the base already installs. ---
RUN uv tool install pre-commit==4.5.1

WORKDIR /gate
COPY . .

# Under `--quiet` (`podman build --quiet` is the gate's own invocation; a
# plain `docker build --quiet` has separately been observed to kill a RUN
# step mid-write on armada-poc/armada-sdk, npm ci exiting 146) a heavy RUN
# step that streams a large volume to the build-step pipe is a hazard either
# way. Each heavy step below writes its own output to a log file, never to
# the step pipe, and prints the log tail only on failure.

# --- npm cache + node_modules so the gate's own `npm ci --offline` resolves.
#     npm ci writes every fetched tarball into the image's ~/.npm cache, which
#     the offline ci at gate time then restores from. This also materializes
#     node_modules/.bin/circom2 for the compile step below. ---
RUN npm ci --no-audit --no-fund --loglevel=error \
        > /tmp/npm-ci.log 2>&1 || { tail -c 40000 /tmp/npm-ci.log; exit 1; }

# --- Compile all circuit shapes once here. circom2 is a pure npm package (no
#     external solc-style download), so this step needs no network; it proves
#     the pinned circom2/circomspect pair the gate will run offline actually
#     compiles this tree's shapes, the same work `npm run compile` repeats at
#     gate time. ---
RUN CIRCOM_BIN=node_modules/.bin/circom2 npm run compile \
        > /tmp/compile.log 2>&1 || { tail -c 40000 /tmp/compile.log; exit 1; }

# --- A throwaway git history (the judged tree carries no .git, D49.4/D49.5)
#     gives pre-commit a repo. `git add -A` honors .gitignore, so node_modules
#     and build/ stay untracked, exactly the file set `pre-commit run
#     --all-files` sees on the host. pre-commit install-hooks materializes
#     every hook's env offline, including the node-language eslint/prettier
#     hooks' own npm installs. install-hooks (not install) registers no git
#     hook, so this build-time commit fires none. The history is on a
#     NON-main branch: the gate run's `pre-commit run --all-files` runs
#     reroute-main-commit, which refuses a commit on main/master, so the
#     throwaway branch must not be one. ---
RUN { git init -q -b gate-tree \
        && git add -A \
        && git -c user.email=gate@armada-circuits -c user.name=gate \
               commit -qm "gate tree" \
        && pre-commit install-hooks --config .pre-commit-config.yaml ; } \
        > /tmp/precommit.log 2>&1 || { tail -c 40000 /tmp/precommit.log; exit 1; }

# No ENTRYPOINT: run_in_container passes the gate.command directly, and it
# runs in WORKDIR /gate with this image's PATH.
