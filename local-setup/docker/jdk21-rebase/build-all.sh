#!/bin/bash
# Build JDK 21 + CDS images for all Spring Boot 3.2 / JDK 17 services.
# Extracts the jar from each stock egovio image and repackages it on
# eclipse-temurin:21-jre-alpine with a pre-baked CDS archive.
#
# Usage: ./build-all.sh [service-name]
#   No args  = build all services
#   With arg = build only that service (e.g. ./build-all.sh egov-idgen)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# service_name:source_image
SERVICES=(
  "egov-idgen:egovio/egov-idgen:v2.9.2-4a60f20"
  "egov-enc-service:egovio/egov-enc-service:v2.9.2-4a60f20"
  "egov-accesscontrol:egovio/egov-accesscontrol:v2.9.2-4a60f20"
  "egov-persister:egovio/egov-persister:v2.9.2-4a60f20"
  "egov-hrms:egovio/egov-hrms:hrms-boundary-0a4e737"
  "egov-filestore:egovio/egov-filestore:v2.9.2-4a60f20"
  "egov-url-shortening:egovio/egov-url-shortening:v2.9.2-4a60f20"
  "boundary-service:egovio/boundary-service:v2.9.2-4a60f20"
  "mdms-v2:egovio/mdms-v2:v2.9.2-4a60f20"
  "pgr-services:egovio/pgr-services:multiarch-d448cb7"
  "egov-workflow-v2:egovio/egov-workflow-v2:v2.9.2-4a60f20"
  "egov-localization:egovio/egov-localization:v2.9.2-4a60f20"
)

FILTER="${1:-}"
BUILT=0
FAILED=0
SKIPPED=0

for entry in "${SERVICES[@]}"; do
  SVC="${entry%%:*}"
  SRC="${entry#*:}"

  if [ -n "$FILTER" ] && [ "$SVC" != "$FILTER" ]; then
    continue
  fi

  TAG="egovio/${SVC}:jdk21-cds-local"
  echo "=== Building ${TAG} from ${SRC} ==="

  if docker build \
    --build-arg "SOURCE_IMAGE=${SRC}" \
    -t "$TAG" \
    -f "${SCRIPT_DIR}/Dockerfile" \
    "${SCRIPT_DIR}"; then
    echo "=== OK: ${TAG} ==="
    BUILT=$((BUILT + 1))
  else
    echo "=== FAILED: ${TAG} ==="
    FAILED=$((FAILED + 1))
  fi
  echo
done

echo "--- Summary ---"
echo "Built:   ${BUILT}"
echo "Failed:  ${FAILED}"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
