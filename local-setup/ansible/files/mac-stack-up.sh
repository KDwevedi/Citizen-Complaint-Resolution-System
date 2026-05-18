#!/usr/bin/env bash
# mac-stack-up.sh — bring the DIGIT stack up on macOS/Rosetta.
#
# Why this exists: under Rosetta the JVM services cold-start slower than
# compose's `depends_on: condition: service_healthy` timeouts, so the
# first `docker compose up -d` aborts ("dependency failed to start")
# even though the containers it created keep warming and DO go healthy
# moments later.
#
# Strategy (validated on the mzmac bring-up):
#   1. ONE clean `down --remove-orphans` to guarantee a single
#      consistent project network and no leaked endpoints from a prior
#      partial run. Volumes are KEPT (no -v) so the db_fast_path
#      Postgres dump persists and is not reloaded.
#   2. Then a plain `up -d` retry loop with NO network/endpoint
#      surgery. Containers are NOT torn down between attempts, so JVM
#      warmth accumulates: each `up -d` starts more of the tier as its
#      deps cross `service_healthy`, converging in a few attempts.
#
# An earlier version tried to "preserve warmth" by force-disconnecting
# leaked endpoints between attempts WITHOUT a down. That re-orphaned the
# still-running Postgres from the recreated network -> every JVM died
# with `UnknownHostException: postgres`. Do NOT reintroduce per-endpoint
# `docker network disconnect`; the single up-front `down` is what makes
# this correct.
#
# Linux never needs this (the playbook runs a plain `up -d` there).
#
# Usage: mac-stack-up.sh <digit_dir> <compose_profiles> <compose_files...>
set -uo pipefail

DIGIT_DIR="$1"; PROFILES="$2"; shift 2
COMPOSE_ARGS="$*"             # e.g. "-f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml"
MAX="${MAC_STACK_UP_MAX:-14}"
DELAY="${MAC_STACK_UP_DELAY:-40}"

cd "$DIGIT_DIR" || { echo "mac-stack-up: cannot cd $DIGIT_DIR"; exit 2; }

# 1) One clean baseline (keep volumes -> Postgres dump persists).
echo "mac-stack-up: clean baseline (down --remove-orphans, volumes kept)…"
COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS down --remove-orphans >/dev/null 2>&1 || true

# 2) Plain up -d retry loop; no network surgery, warmth accumulates.
for i in $(seq 1 "$MAX"); do
  if COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS up -d >/tmp/mac-stack-up.$i.log 2>&1; then
    echo "mac-stack-up: converged on attempt $i/$MAX"
    exit 0
  fi
  reason="$(grep -oE 'dependency failed to start[^"]*|exited \([0-9]+\)|UnknownHostException: [a-z]+|no space left on device' \
            /tmp/mac-stack-up.$i.log | tail -1)"
  echo "mac-stack-up: attempt $i/$MAX not yet converged${reason:+ — $reason}; JVMs warming ${DELAY}s…"
  sleep "$DELAY"
done

echo "mac-stack-up: did NOT converge after $MAX attempts" >&2
exit 1
