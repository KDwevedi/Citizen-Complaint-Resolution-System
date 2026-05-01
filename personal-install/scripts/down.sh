#!/usr/bin/env bash
# Tear down the local stack.  --volumes / -v also drops Postgres/Kafka data.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/config.env" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
    k="${line%%=*}"; v="${line#*=}"
    [[ -z "${!k+x}" ]] && export "$k=$v"
  done < "$ROOT/config.env"
fi

PROJECT="${COMPOSE_PROJECT_NAME:-naipepea-personal}"
COMPOSE_FILES=(-f "$ROOT/stack/docker-compose.yaml")

flag=""
[[ "${1:-}" == "--volumes" || "${1:-}" == "-v" ]] && flag="-v"

COMPOSE_PROJECT_NAME="$PROJECT" docker compose "${COMPOSE_FILES[@]}" down ${flag:+"$flag"}
