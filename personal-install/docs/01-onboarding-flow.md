# Onboarding flow

The configurator's onboarding wizard at `http://localhost:16172/configurator/` is the canonical path from a freshly-up stack to a usable city tenant. It has 5 phases. This doc covers what each phase does, what gets created where, what to expect on success, and how to diagnose failure without escalating.

If you'd rather script this (CI, automation, repeatability), see `02-apis.md` for the same operations as direct curl calls.

## Big picture

A "tenant" in DIGIT is a dotted hierarchical string — `ke` is a root, `ke.nairobi` is a city under it. To make `ke.nairobi` usable for PGR you need:

```
1. tenant record in MDMS               (what wizard Phase 1 does — or ansible 02-seed-tenants.yml)
2. roles registered at the tenant      (Phase 2)
3. departments + designations          (Phase 2)
4. complaint types (PGR ServiceDefs)   (Phase 3)
5. boundaries + hierarchy + relationships  (ansible 03-seed-boundaries.yml — already done)
6. employees + jurisdictions           (Phase 4)
7. theme + logos                       (Phase 5)
```

Personal-install's ansible run handles steps 1 and 5 ahead of time when `SEED_DEMO_DATA=true`. So the wizard begins effectively at Phase 2 for a Nairobi-flavoured install.

Phase order matters. The wizard enforces it: each phase blocks on the previous. Skipping breaks downstream — e.g. roles must exist before the city tenant's first ADMIN can be assigned them.

## Phase 1 — Tenant header

**What it does**: creates a record in MDMS schema `tenant.tenants` describing the city tenant (code, name, type=CITY, district name).

**Where it lands**:
- Postgres: `eg_mdms_data` row with `schemacode='tenant.tenants'`, `tenantid='pg'` (storage scope), `data->>'tenantId'='ke.nairobi'` (logical scope).
- Subsequent operations under `ke.nairobi` will resolve via this record.

**Skip if**: ansible already seeded it (default for `SEED_DEMO_DATA=true`).

**How to verify**:
```bash
TOKEN=$(./get-token.sh)  # see 03-login-and-tenants.md for the curl
curl -s -X POST http://localhost:16000/mdms-v2/v2/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"pg\",\"schemaCode\":\"tenant.tenants\",\"limit\":50}}" \
  | jq '.mdms[].data.tenantId'
```
You should see `ke`, `ke.nairobi`.

**Failure**: `SCHEMA_DEFINITION_NOT_FOUND_ERR` if you POST with `Mdms.tenantId=ke` instead of `Mdms.tenantId=pg`. The schema is registered under `pg`. See `03-login-and-tenants.md` §"Schema scope".

## Phase 2 — Roles + departments + designations

**What it does**: creates MDMS records for ACCESSCONTROL roles, common-masters Department, common-masters Designation, all on the *city* tenant.

**Roles created** (for PGR pilot):
- `CITIZEN`, `CSR`, `GRO`, `DGRO`, `PGR_LME`, `SUPERUSER`, `EMPLOYEE`

**How to verify**:
```bash
curl -s -X POST http://localhost:16000/mdms-v2/v2/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke.nairobi\",\"schemaCode\":\"ACCESSCONTROL-ROLES.roles\",\"limit\":50}}" \
  | jq '.mdms[].data.code'
```

**Common failure**: clicking "Create employee" in Phase 4 returns `INVALID_ROLE: Unable to validate role from MDMS`. Means roles weren't seeded on the city tenant yet — re-do Phase 2.

## Phase 3 — Complaint types (PGR ServiceDefs)

**What it does**: creates `RAINMAKER-PGR.ServiceDefs` MDMS records — each represents a complaint type the citizen can file (e.g. "Land ownership dispute", "Surveying delay"). Each ties to a department, has SLA hours, and a menuPath.

**Where it lands**:
- MDMS at `tenantId=ke.nairobi`, `schemaCode=RAINMAKER-PGR.ServiceDefs`.
- Localization keys for displaying these in the citizen dropdown: `SERVICEDEFS.{SERVICECODE_UPPER}` (must exist in `rainmaker-pgr` module — see `04-localization.md`).

**How to verify**:
```bash
curl -s "http://localhost:16000/mdms-v2/v2/_search" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke.nairobi\",\"schemaCode\":\"RAINMAKER-PGR.ServiceDefs\",\"limit\":100}}" \
  | jq '.mdms | length'
```
Expect 37 for the Nairobi pilot.

**Common failure**: depts must be created in Phase 2 first; `serviceDef.department` references a department code that has to exist.

## Phase 4 — Employees

**What it does**:
1. Creates `egov-user` records (the credential layer)
2. Wraps each in `egov-hrms` employee shape with department, designation, jurisdictions (where they work)
3. Bulk import via XLSX (3 sheets: Employee, Codes, Instructions) or single-create

**Where it lands**:
- `eg_user` table — credentials.
- `eg_hrms_employee` — employee record with assignments + jurisdictions.

**Important**:
- Mobile numbers must match the Kenya regex from `ValidationConfigs.mobileNumberValidation` MDMS schema: `^(0?7|0?1)\d{8}$`. 9-digit numbers (`722320295`) fail until prefixed with `0`.
- On naipepea, `eg_user.username/mobilenumber` are encrypted at rest (Kenya DPA). Search via `/egov-hrms/employees/_search`, not `/user/_search`.
- Default password is `eGov@123`. No force-rotate-on-first-login wired.

**How to verify**:
```bash
curl -s "http://localhost:16000/egov-hrms/employees/_search?tenantId=ke.nairobi&limit=100" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}" \
  | jq '.Employees | length'
```

**Try logging in as a freshly-created employee** at `/digit-ui/employee/user/login` to confirm the round-trip.

**Common failures**:
- `INVALID_ROLE` — roles not seeded on the tenant; revisit Phase 2.
- Mobile validation 400 — see regex above.
- Jurisdictions empty after submit — boundaries weren't seeded; check the `personal_tenant_city` boundary search has rows (`02-apis.md` §"Boundaries").

## Phase 5 — Branding (theme + logos)

**What it does**: writes a `tenant.branding` (or theme-config) MDMS record with the colour palette + logo references.

**Where it lands**:
- MDMS — palette + logo IDs (filestore-resolved).
- DIGIT-UI consumes via runtime `--color-*` CSS vars; logos resolve through `globalConfigs.js` + filestore lookup.

See `05-branding-and-logos.md` for the full mechanics + how to update without going through the wizard.

## Wizard "Complete" page

Surfaces real login URLs for the citizen and employee SPAs at the new tenant, plus a copy-to-clipboard for the city ADMIN credentials. **Save these immediately** — the password is `eGov@123` by default but the ADMIN was just created at the city tenant; you'll log in there next.

## End-to-end smoke after Phase 5

Verify the configuration *actually works* before stopping:

1. Citizen mode: `http://localhost:16080/digit-ui/citizen` → file a complaint with one of the 37 complaint types, locality picked from the seeded wards, submit. Note the assigned ID (`PG-PGR-NCC-001`-style).
2. Switch to employee mode at `/digit-ui/employee/user/login`. Log in as the GRO admin from Phase 4.
3. Inbox shows the new complaint. Assign to an LME from your dept.
4. The state in workflow advances to `PENDINGATLME`; citizen-side now reflects it.
5. Log in as the LME, resolve.
6. Citizen rates → `CLOSEDAFTERRESOLUTION`.

After this round-trip:
- `/manage/pgr-dashboard` should show `pgr_mv_kpi.total = 1` after the next `DashboardRefreshScheduler` tick (~60s).
- `eg_pgr_service_v2` row in postgres has `applicationstatus='CLOSEDAFTERRESOLUTION'`.

## How to debug

If a phase appears to succeed in the UI but the verify-curl shows nothing:

1. **Open browser network tab during the wizard step.** Find the `_create` POST. Confirm response is 200/201/202. Confirm `RequestInfo.userInfo.tenantId` and `Mdms.tenantId` match what you expect.
2. **Tail the relevant service log** while you click:
   ```bash
   docker logs -f mdms-v2 2>&1 | grep -iE 'ERROR|exception|create|tenant'
   ```
   Most "succeeds in UI but missing in DB" issues turn up here as a swallowed exception.
3. **Check the wizard's step-state** — the configurator stores wizard progress in localStorage; if you refresh mid-phase, the in-flight step's `_create` may have fired but the UI's "next phase" guard refused to advance. Re-trigger the action; idempotency on `_create` (`DUPLICATE_RECORD` whitelist) means re-runs are safe.

## When to escalate

- Phase advances but downstream phase fails because the upstream record is missing — **after** you've confirmed via `_search` that the record really isn't there. (If it is there but the wizard didn't advance, that's a UI bug.)
- A `_create` returns a 5xx.
- A schema you expected at a tenant returns `SCHEMA_DEFINITION_NOT_FOUND_ERR` on `_search` — that's a missing schema-registration, beyond the wizard's scope.
