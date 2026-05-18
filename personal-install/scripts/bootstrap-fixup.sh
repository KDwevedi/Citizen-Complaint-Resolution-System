#!/bin/bash
# bootstrap-fixup.sh — un-stick an onboarding session whose Phase 1 bootstrap
# left gaps that the upstream wizard code couldn't backfill after the fact.
#
# Companion to digit-configurator#66. Also a complete standalone state-root
# bootstrap for the non-wizard path (API / CI / scripted onboarding): it copies
# both the SCHEMAS and the DATA, so a fresh root needs no prior Phase-1 run.
#   1. Bulk-copy MDMS schema definitions + data SOURCE → TARGET
#      (data deny-lists tenant.tenants; schemas copied wholesale). The schema
#      copy is what makes _create against a brand-new root work at all —
#      without it every Phase 3-4 write fails SCHEMA_DEFINITION_NOT_FOUND_ERR.
#   2. Restart MDMS services so in-process caches reload.
#   3. Bust the localization service cache.
#   4. Detect orphan HRMS rows (employees with no eg_user) and print a
#      copy-paste recovery template.
#   5. Remind whoever's testing the UI to clear localStorage and verify
#      globalConfigs.js's stateTenantId.
#
# Idempotent. Safe to re-run.
#
# Usage:
#   ./bootstrap-fixup.sh                 # defaults: SOURCE=pg, TARGET=mz
#   TARGET=ze SOURCE=pg ./bootstrap-fixup.sh
#   HOST=http://localhost:16000 ./bootstrap-fixup.sh

set -euo pipefail

HOST=${HOST:-http://localhost:16000}      # Kong base URL
SOURCE=${SOURCE:-pg}                       # MDMS data source tenant
TARGET=${TARGET:-mz}                       # New state root being repaired

echo "=== [1/5] Copy MDMS schema defs + data $SOURCE → $TARGET (deny-list = tenant.tenants) ==="
# Two copies, one transaction, schemas first:
#
#   (1) eg_mdms_schema_definition — the SCHEMAS. Without these at $TARGET every
#       _create against the new root (or any city under it) fails with
#       SCHEMA_DEFINITION_NOT_FOUND_ERR — mdms-v2 has no parent fallback on
#       _create. This mirrors the configurator wizard's tenantBootstrap.ts
#       'schemas' step; copying it here makes the script a complete bootstrap
#       for the non-wizard path instead of a data-only backfill. De-dup by
#       (tenant, code).
#
#   (2) eg_mdms_data — the DATA. Dual de-dup: skip a SOURCE row if either
#       (a) (TARGET, schemacode, uniqueidentifier) already exists — exact
#       storage-key match, or (b) (TARGET, schemacode, data) already exists —
#       same logical content under a different uniqueidentifier. (b) catches
#       the case where Phase 1's bootstrap re-keyed pg's data with a code-based
#       uniqueIdentifier (DEPT_10) while pg's seed uses a content-hashed one
#       ("0e8a47…"). Without (b) we'd insert a second copy of every
#       bootstrap-covered row, doubling counts in dropdowns and role lookups.
docker exec -i docker-postgres psql -U egov -d egov <<SQL
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO eg_mdms_schema_definition
       (id,                tenantid, code,    description,   definition,  isactive,
        createdby,         createdtime,
        lastmodifiedby,    lastmodifiedtime)
SELECT  gen_random_uuid(), '$TARGET', s.code, s.description, s.definition, s.isactive,
        'bootstrap-fixup', (extract(epoch from now())*1000)::bigint,
        'bootstrap-fixup', (extract(epoch from now())*1000)::bigint
FROM   eg_mdms_schema_definition s
WHERE  s.tenantid = '$SOURCE'
  AND  NOT EXISTS (
        SELECT 1 FROM eg_mdms_schema_definition d
        WHERE  d.tenantid = '$TARGET' AND d.code = s.code
       );
INSERT INTO eg_mdms_data
       (id,                tenantid, schemacode, uniqueidentifier, data, isactive,
        createdby,         createdtime,
        lastmodifiedby,    lastmodifiedtime)
SELECT  gen_random_uuid(), '$TARGET', src.schemacode, src.uniqueidentifier, src.data, src.isactive,
        'bootstrap-fixup', (extract(epoch from now())*1000)::bigint,
        'bootstrap-fixup', (extract(epoch from now())*1000)::bigint
FROM   eg_mdms_data src
WHERE  src.tenantid   = '$SOURCE'
  AND  src.schemacode NOT IN ('tenant.tenants')
  AND  NOT EXISTS (
        SELECT 1 FROM eg_mdms_data dst
        WHERE  dst.tenantid   = '$TARGET'
          AND  dst.schemacode = src.schemacode
          AND  dst.data       = src.data
       )
ON CONFLICT (tenantid, schemacode, uniqueidentifier) DO NOTHING;
COMMIT;

\echo ''
\echo '--- schema definitions now at '"'$TARGET'"' vs '"'$SOURCE'"':'
SELECT '$SOURCE' AS tenant, count(*) FROM eg_mdms_schema_definition WHERE tenantid='$SOURCE'
UNION ALL
SELECT '$TARGET' AS tenant, count(*) FROM eg_mdms_schema_definition WHERE tenantid='$TARGET';

\echo ''
\echo '--- rows now at '"'$TARGET'"' by schema:'
SELECT schemacode, count(*) FROM eg_mdms_data WHERE tenantid='$TARGET' GROUP BY schemacode ORDER BY 1;

\echo ''
\echo '--- gap-check vs '"'$SOURCE'"' (anything still short is suspicious):'
SELECT  p.schemacode,
        (SELECT count(*) FROM eg_mdms_data WHERE tenantid='$SOURCE' AND schemacode=p.schemacode) AS at_source,
        (SELECT count(*) FROM eg_mdms_data WHERE tenantid='$TARGET' AND schemacode=p.schemacode) AS at_target
FROM    (SELECT DISTINCT schemacode FROM eg_mdms_data WHERE tenantid='$SOURCE') p
WHERE   (SELECT count(*) FROM eg_mdms_data WHERE tenantid='$TARGET' AND schemacode=p.schemacode)
      < (SELECT count(*) FROM eg_mdms_data WHERE tenantid='$SOURCE' AND schemacode=p.schemacode)
  AND   p.schemacode != 'tenant.tenants'
ORDER BY 1;
SQL

echo
echo "=== [2/5] Restart MDMS services so in-memory caches reload ==="
for c in egov-mdms-service mdms-v2; do
  if docker ps --format '{{.Names}}' | grep -q "^$c\$"; then
    echo "  restarting $c"
    docker restart "$c" >/dev/null
  else
    echo "  $c not running — skipping"
  fi
done

echo
echo "=== [3/5] Bust the localization service cache ==="
curl -s -X POST "$HOST/localization/messages/cache-bust" \
  -H 'Content-Type: application/json' -d '{}' | head -c 200
echo

echo
echo "=== [4/5] Detect orphan HRMS rows (employees with no eg_user) ==="
ORPHANS=$(docker exec docker-postgres psql -U egov -d egov -tA -c "
SELECT e.code || '|' || e.tenantid || '|' || e.uuid
FROM   eg_hrms_employee e
LEFT JOIN eg_user u ON u.uuid = e.uuid
WHERE  u.uuid IS NULL;
")

if [ -z "$ORPHANS" ]; then
  echo "  no orphans — every HRMS row has a matching eg_user. ✓"
else
  echo "  ⚠ orphan HRMS rows found:"
  echo "$ORPHANS" | column -t -s '|' -N 'code,hrms_tenant,hrms_uuid' | sed 's/^/    /'
  echo
  echo "  These employees exist in HRMS but cannot log in."
  echo "  Recovery curl template (run once per orphan; fill in name/mobile/email/roles from your XLSX):"
  cat <<'HINT'

    TOKEN=$(curl -s -u 'egov-user-client:' -X POST "$HOST/user/oauth/token" \
      -d "username=ADMIN&password=eGov@123&tenantId=$TARGET&grant_type=password&scope=read&userType=EMPLOYEE" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
    OP_UUID=$(curl -s -u 'egov-user-client:' -X POST "$HOST/user/oauth/token" \
      -d "username=ADMIN&password=eGov@123&tenantId=$TARGET&grant_type=password&scope=read&userType=EMPLOYEE" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['UserRequest']['uuid'])")

    HRMS_UUID=<from table above>
    HRMS_TENANT=<from table above>
    USERNAME=jane.doe          # from your Phase 4 XLSX
    FULLNAME='Jane Doe'
    MOBILE=9000000001
    EMAIL=jane@example.com
    ROLES='[{"code":"EMPLOYEE","tenantId":"'"$HRMS_TENANT"'"},{"code":"GRO","tenantId":"'"$HRMS_TENANT"'"}]'

    curl -s -X POST "$HOST/user/users/_createnovalidate" \
      -H 'Content-Type: application/json' \
      -d '{
        "RequestInfo":{"authToken":"'"$TOKEN"'","userInfo":{"id":1,"userName":"ADMIN","uuid":"'"$OP_UUID"'","type":"EMPLOYEE","tenantId":"'"$TARGET"'","roles":[{"code":"SUPERUSER","tenantId":"'"$TARGET"'"}]},"msgId":"x","ts":1},
        "user":{
          "uuid":"'"$HRMS_UUID"'",
          "name":"'"$FULLNAME"'",
          "userName":"'"$USERNAME"'",
          "password":"eGov@123",
          "mobileNumber":"'"$MOBILE"'",
          "emailId":"'"$EMAIL"'",
          "tenantId":"'"$HRMS_TENANT"'",
          "type":"EMPLOYEE",
          "active":true,
          "roles":'"$ROLES"'
        }
      }' | python3 -m json.tool

    # verify:
    curl -s -u 'egov-user-client:' -X POST "$HOST/user/oauth/token" \
      -d "username=$USERNAME&password=eGov@123&tenantId=$HRMS_TENANT&grant_type=password&scope=read&userType=EMPLOYEE" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK token=' + d['access_token'][:12] + '…' if d.get('access_token') else 'FAIL: ' + str(d.get('error_description') or d))"
HINT
fi

echo
echo "=== [5/5] Browser-side reminder for whoever's testing the UI ==="
cat <<'BROWSER'
  In the digit-ui devtools console:
    localStorage.clear(); sessionStorage.clear();
    document.cookie.split(';').forEach(c => {
      const n = c.split('=')[0].trim();
      document.cookie = `${n}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
    location.reload();

  And confirm globalConfigs.js has the state root (not the city):
    grep stateTenantId /path/to/local-setup/nginx/globalConfigs.js
    # should print: var stateTenantId = "<state-root>";   ← state root, NOT the city
  If wrong, edit + `docker restart digit-ui`.
BROWSER

echo
echo "=== done — gap check above should be empty; orphan list above should be empty after Step 4. ==="
