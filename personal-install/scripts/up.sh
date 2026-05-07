#!/usr/bin/env bash
# Bring up the local DIGIT stack and run the seed playbook.
#
#   ./scripts/up.sh           # full up + seed
#   ./scripts/up.sh stack     # docker compose up only (no ansible)
#   ./scripts/up.sh seed      # ansible playbook only (assumes stack is up)
#
# Configuration:  edit config.env at the project root.

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/config.env"

# Load config.env defaults — but DON'T clobber anything already in the env,
# so `SEED_DEMO_DATA=false ./scripts/up.sh` works without editing config.env.
[[ -f "$CONFIG" ]] || { echo "missing $CONFIG — should be committed at personal-install/config.env"; exit 2; }
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  # only export if not already set
  if [[ -z "${!key+x}" ]]; then
    export "$key=$val"
  fi
done < "$CONFIG"

PROJECT="${COMPOSE_PROJECT_NAME:-naipepea-personal}"
COMPOSE_FILES=(-f "$ROOT/stack/docker-compose.yaml")

# ─── OS / architecture detection ─────────────────────────────────────────────
# OS=auto resolves via uname. naipepea's images are amd64-only — only Apple
# Silicon Macs need DOCKER_DEFAULT_PLATFORM forcing.
detect_os() {
  local k
  k="$(uname -s 2>/dev/null)"
  case "$k" in
    Darwin) echo macos ;;
    Linux)  if grep -qi microsoft /proc/version 2>/dev/null; then echo wsl
            else echo linux; fi ;;
    *) echo unknown ;;
  esac
}
[[ "${OS:-auto}" == "auto" ]] && OS="$(detect_os)"

case "$OS" in
  macos)
    # Most Macs since 2020 are arm64; older Intel Macs are amd64 native.
    # Only force the platform when the host is arm64 — saves Linux from
    # needless emulation if someone sets OS=macos on an Intel Mac+Linux mismatch.
    HOST_ARCH="$(uname -m)"
    if [[ "$HOST_ARCH" == "arm64" || "$HOST_ARCH" == "aarch64" ]]; then
      export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
      echo "▸ macOS arm64 — Rosetta emulation enabled (DOCKER_DEFAULT_PLATFORM=$DOCKER_DEFAULT_PLATFORM)"
    fi
    ;;
  linux)
    # Native amd64 — no platform forcing needed. arm64 Linux users would
    # need Rosetta-style emulation similar to Mac; only matters if someone
    # hits naipepea's amd64-only images on a non-amd64 Linux box.
    HOST_ARCH="$(uname -m)"
    if [[ "$HOST_ARCH" != "x86_64" && "$HOST_ARCH" != "amd64" ]]; then
      export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
      echo "▸ Linux $HOST_ARCH — emulation enabled for naipepea's amd64 images"
    fi
    ;;
  wsl)
    # WSL2 with Docker Desktop integration. Same as Linux behavior; Docker
    # Desktop runs the actual VM. Image pulls + ports work identically.
    echo "▸ WSL2 detected — using Docker Desktop integration"
    ;;
  *)
    echo "▸ OS=$OS — no platform-specific tweaks applied (set OS=macos/linux/wsl in config.env to opt in)"
    ;;
esac

ANSIBLE_BIN="$(command -v ansible-playbook 2>/dev/null || echo "$HOME/.local/bin/ansible-playbook")"

# Build the configurator dist if missing; the extra compose file mounts it.
# CONFIGURATOR_DIR (config.env) overrides; default is sibling of personal-install.
# Resolved to an *absolute* path here and exported so the compose file's
# `${CONFIGURATOR_DIR}/dist:/var/www/configurator:ro` volume is unambiguous —
# personal-install/stack/ is a symlink to local-setup/, and docker compose
# resolves relative volumes against the invocation path (not the symlink
# target), so a relative default lands in the wrong place. (Refs CCRS#549.)
CFG_DIR="${CONFIGURATOR_DIR:-$ROOT/../digit-configurator}"
if [[ ! -d "$CFG_DIR" ]]; then
  echo "  ✗ CONFIGURATOR_DIR='$CFG_DIR' does not exist."
  echo "    Set CONFIGURATOR_DIR in personal-install/config.env to the absolute path of digit-configurator,"
  echo "    or place digit-configurator as a sibling of Citizen-Complaint-Resolution-System."
  exit 1
fi
export CONFIGURATOR_DIR="$(cd "$CFG_DIR" && pwd)"
if [[ ! -f "$CONFIGURATOR_DIR/dist/index.html" ]]; then
  echo "▸ building configurator dist (one-time)…"
  ( cd "$CONFIGURATOR_DIR/packages/data-provider" && npm run build ) >/dev/null
  ( cd "$CONFIGURATOR_DIR" && npx vite build --base=/configurator/ ) >/dev/null
fi

# Same pattern as configurator, for digit-ui-esbuild. The digit-ui compose
# service mounts ${UI_ESBUILD_DIR}/build:/var/web/digit-ui:ro, so we need
# the build/ output present before `docker compose up` (otherwise the
# bind-mount target is missing and the digit-ui container won't start).
# Honors UI_ESBUILD_DIR from config.env; resolves to absolute path so the
# compose mount works regardless of how compose is invoked.
UI_DIR="${UI_ESBUILD_DIR:-$ROOT/../digit-ui-esbuild}"
if [[ ! -d "$UI_DIR" ]]; then
  echo "  ✗ UI_ESBUILD_DIR='$UI_DIR' does not exist."
  echo "    Set UI_ESBUILD_DIR in personal-install/config.env to the absolute path of digit-ui-esbuild,"
  echo "    or place digit-ui-esbuild as a sibling of Citizen-Complaint-Resolution-System."
  exit 1
fi
export UI_ESBUILD_DIR="$(cd "$UI_DIR" && pwd)"

# Build digit-ui bundle if missing or stale. Freshness gate: if any source
# file under products/, packages/, public/ or package.json is newer than
# build/index.html, rebuild. Saves ~30-60s on repeat ups when source hasn't
# changed.
need_ui_build=0
if [[ ! -f "$UI_ESBUILD_DIR/build/index.html" ]]; then
  need_ui_build=1
elif find "$UI_ESBUILD_DIR/products" "$UI_ESBUILD_DIR/packages" "$UI_ESBUILD_DIR/public" "$UI_ESBUILD_DIR/package.json" \
       -type f -newer "$UI_ESBUILD_DIR/build/index.html" 2>/dev/null | grep -q .; then
  need_ui_build=1
fi
if (( need_ui_build )); then
  echo "▸ building digit-ui bundle (esbuild.build.js)…"
  # --legacy-peer-deps: digit-ui-esbuild's transitive tree has a known
  # react18 peer-dep conflict (react-drag-drop-files@2.3.10 wants
  # react@^18.0.0; the resolved react@18.3.1 should satisfy that but
  # npm@10+ is stricter). The flag matches what the upstream repo's
  # README documents.
  if [[ ! -d "$UI_ESBUILD_DIR/node_modules" ]]; then
    ( cd "$UI_ESBUILD_DIR" && npm install --legacy-peer-deps ) >&2 \
      || { echo "  ✗ npm install (digit-ui-esbuild) failed"; exit 1; }
  fi
  ( cd "$UI_ESBUILD_DIR" && node esbuild.build.js ) >&2 \
    || { echo "  ✗ esbuild.build.js failed"; exit 1; }
  echo "  ✓ digit-ui build/ ready: $UI_ESBUILD_DIR/build/"
else
  echo "▸ digit-ui build/ is up-to-date — skipping rebuild"
fi

mode="${1:-all}"

up_stack() {
  echo "▸ docker compose pull (cache hits skip)…"
  COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" pull \
    || { echo "  ✗ pull failed"; return 1; }

  echo "▸ docker compose up -d (kong on :${PORT_PREFIX}000, configurator on :${PORT_PREFIX}172)…"
  if ! COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" up -d; then
    echo "  ✗ docker compose up -d failed."
    echo "    Common cause: a container name (e.g. 'digit-ui') already in use from a prior partial run."
    echo "    Recover with:"
    echo "      docker compose -f $ROOT/stack/docker-compose.yaml -p $PROJECT down"
    echo "      ./scripts/up.sh"
    return 1
  fi

  # Confirm kong-gateway container exists at all before polling its health
  if ! docker inspect kong-gateway >/dev/null 2>&1; then
    echo "  ✗ kong-gateway container doesn't exist — compose didn't create it."
    echo "    Check 'docker compose -f $ROOT/stack/docker-compose.yaml -p $PROJECT ps -a' for what's there."
    return 1
  fi

  echo "▸ waiting for kong-gateway healthy (up to 5 min)…"
  for _ in $(seq 1 60); do
    h=$(docker inspect --format '{{.State.Health.Status}}' kong-gateway 2>/dev/null)
    [[ "$h" == healthy ]] && { echo "  kong healthy"; return 0; }
    sleep 5
  done
  echo "  kong did not reach healthy — check 'docker logs kong-gateway'"
  return 1
}

seed() {
  echo "▸ ansible-playbook (seed mode: SEED_DEMO_DATA=${SEED_DEMO_DATA:-true})…"
  cd "$ROOT/ansible"
  PORT_PREFIX="$PORT_PREFIX" \
  CONFIGURATOR_DIR="${CONFIGURATOR_DIR:-}" \
  UI_ESBUILD_DIR="${UI_ESBUILD_DIR:-}" \
  SEED_DEMO_DATA="${SEED_DEMO_DATA:-true}" \
  USE_ESBUILD_HMR="${USE_ESBUILD_HMR:-false}" \
  PERSONAL_TENANT_ROOT="$PERSONAL_TENANT_ROOT" \
  PERSONAL_TENANT_CITY="$PERSONAL_TENANT_CITY" \
  BOOTSTRAP_TENANT="$BOOTSTRAP_TENANT" \
  BOOTSTRAP_USER="$BOOTSTRAP_USER" \
  BOOTSTRAP_PASSWORD="$BOOTSTRAP_PASSWORD" \
    "$ANSIBLE_BIN" -i inventory.yml playbook.yml "$@"
}

apply_config() {
  # Re-apply changes that don't auto-propagate after a `git pull`:
  #   - compose YAML changes → up -d picks up env/heap changes (auto-recreates affected services)
  #   - kong.yml routes      → kong reload (no container restart needed)
  #   - bind-mounted nginx/globalConfigs.js → docker restart digit-ui
  #     (nginx reads the bind-mount file at startup; live edits don't refresh)
  #   - any service stuck in Created (skipped during initial dependency cascade)
  echo "▸ docker compose up -d (auto-recreates services with changed env/heap)…"
  COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" up -d \
    || { echo "  ✗ compose up failed"; return 1; }

  echo "▸ kong reload (picks up new kong.yml routes/plugins)…"
  docker exec kong-gateway kong reload >/dev/null 2>&1 \
    && echo "  kong reloaded" \
    || echo "  ✗ kong reload failed (container may not be running yet)"

  echo "▸ docker restart digit-ui (re-bind nginx conf + globalConfigs.js)…"
  docker restart digit-ui >/dev/null 2>&1 \
    && echo "  digit-ui restarted" \
    || echo "  ✗ digit-ui restart failed"

  echo "▸ ./scripts/up.sh seed (idempotent — handles localization seed + cache flushes)…"
  seed
}

case "$mode" in
  stack) up_stack ;;
  seed)  seed "${@:2}" ;;
  all)   up_stack && seed ;;
  apply) apply_config ;;
  *) echo "usage: $0 [stack|seed|all|apply] [extra ansible args]" >&2; exit 2 ;;
esac
