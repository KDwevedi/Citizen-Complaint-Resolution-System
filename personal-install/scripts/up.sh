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
CFG_DIR="$ROOT/../digit-configurator"
if [[ -d "$CFG_DIR" && ! -f "$CFG_DIR/dist/index.html" ]]; then
  echo "▸ building configurator dist (one-time)…"
  ( cd "$CFG_DIR/packages/data-provider" && npm run build ) >/dev/null
  ( cd "$CFG_DIR" && npx vite build --base=/configurator/ ) >/dev/null
fi

mode="${1:-all}"

up_stack() {
  echo "▸ docker compose pull (cache hits skip)…"
  COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" pull
  echo "▸ docker compose up -d (kong on :${PORT_PREFIX}000, configurator on :${PORT_PREFIX}172)…"
  COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" up -d
  echo "▸ waiting for kong-gateway healthy (up to 5 min)…"
  for _ in $(seq 1 60); do
    h=$(docker inspect --format '{{.State.Health.Status}}' kong-gateway 2>/dev/null || echo starting)
    [[ "$h" == healthy ]] && { echo "  kong healthy"; return 0; }
    sleep 5
  done
  echo "  kong did not reach healthy — check 'docker compose ${COMPOSE_FILES[*]} logs kong-gateway'"
  return 1
}

seed() {
  echo "▸ ansible-playbook (seed mode: SEED_DEMO_DATA=${SEED_DEMO_DATA:-true})…"
  cd "$ROOT/ansible"
  PORT_PREFIX="$PORT_PREFIX" \
  CONFIGURATOR_DIR="${CONFIGURATOR_DIR:-}" \
  UI_ESBUILD_DIR="${UI_ESBUILD_DIR:-}" \
  SEED_DEMO_DATA="${SEED_DEMO_DATA:-true}" \
  PERSONAL_TENANT_ROOT="$PERSONAL_TENANT_ROOT" \
  PERSONAL_TENANT_CITY="$PERSONAL_TENANT_CITY" \
  BOOTSTRAP_TENANT="$BOOTSTRAP_TENANT" \
  BOOTSTRAP_USER="$BOOTSTRAP_USER" \
  BOOTSTRAP_PASSWORD="$BOOTSTRAP_PASSWORD" \
    "$ANSIBLE_BIN" -i inventory.yml playbook.yml "$@"
}

case "$mode" in
  stack) up_stack ;;
  seed)  seed "${@:2}" ;;
  all)   up_stack && seed ;;
  *) echo "usage: $0 [stack|seed|all] [extra ansible args]" >&2; exit 2 ;;
esac
