# Onboarding flow

The configurator at `http://localhost:16172/configurator/` has two modes: **Management** (CRUD pages over MDMS, HRMS, boundaries, localization, etc.) and **Onboarding** (a 4-phase wizard that walks you through bringing up a new tenant). The same SPA renders both, switched by the "Management" / "Switch to Onboarding" button in the header.

This doc covers the onboarding wizard. For day-2 edits (change a complaint type's SLA, swap a logo, edit an employee's jurisdictions) use Management mode — covered in `06-ui-repos.md` §"Configurator routing".

If you want to script the same operations as direct API calls instead of going through the wizard, see `02-apis.md`.

## What you should expect on first load

- **digit-ui at `:16080` runs on the upstream `pg/en_IN` default.** Don't be surprised that the citizen UI shows mostly raw upper-snake keys (`CS_COMMON_CHOOSE_LANGUAGE`, `CORE_COMMON_CONTINUE`) — CCRS local-setup ships only 88 localization rows at `pg/en_IN`, and the bulk of the demo strings live at `statea.g/en_IN` (4,506 rows). The SPA reads from `stateTenantId=pg` so it gets the 88 + raw-key fallback. To target your seeded `ke.nairobi` from the citizen UI you'd need to seed `ke/en_IN` with at least the missing keys *first* (the localization service does a full-table scan on empty results, so hand-pointing the SPA at an unseeded `ke/en_KE` hangs the boot for several minutes). The configurator wizard's `targetTenant` mechanism is unaffected — that's separate. See `04-localization.md` for the naipepea translation-seed pattern.
- **No login screen on the configurator.** The configurator boots into a stub auth state — `localStorage['crs-auth-state']` is auto-populated with `user: { name: "System Administrator", roles: ["EMPLOYEE", "GRO", "SUPERUSER", "DGRO"], ... }` and a session token. You can verify by opening DevTools → Application → Local Storage. This is **not** a real backend session; the SPA threads the stub through API calls and most endpoints accept it for SUPERUSER-level operations. Backend-only scripting (curl) still needs a real token from `/user/oauth/token` — see `03-login-and-tenants.md`.
- **Two tenants you didn't create**: `pg`, `pg.citya`, `pg.cityb`, `statea.g` are pre-seeded by CCRS local-setup's bootstrap. They sit alongside whatever ansible seeded for you (`ke`, `ke.nairobi` for Nairobi-flavoured installs).
- **Wizard target tenant defaults to `pg`** (the bootstrap tenant). The 4 phases initially read/write data on `pg`. To target the freshly-seeded `ke.nairobi`, change `localStorage['crs-auth-state']` keys `targetTenant` and `tenant`:
  ```js
  // in the configurator's browser console
  var s = JSON.parse(localStorage.getItem('crs-auth-state'));
  s.targetTenant = 'ke.nairobi';
  s.tenant = 'ke.nairobi';
  localStorage.setItem('crs-auth-state', JSON.stringify(s));
  location.reload();
  ```
  After reload the header shows `ke.nairobi` next to "System Administrator" and wizard panes operate against that tenant.

## Big picture

A "tenant" in DIGIT is a dotted hierarchical string — `ke` is a root, `ke.nairobi` is a city under it. To make `ke.nairobi` usable for PGR you need:

```
1. tenant record in MDMS                 — Phase 1 (or ansible 02-seed-tenants.yml)
2. branding (palette + logos)            — Phase 1 (Step 1.2)
3. boundaries + hierarchy + relationships — Phase 2 (or ansible 03-seed-boundaries.yml)
4. departments + designations            — Phase 3
5. complaint types (PGR ServiceDefs)     — Phase 3
6. employees + jurisdictions + roles     — Phase 4
```

Personal-install's ansible runs handle steps 1 and 3 ahead of time when `SEED_DEMO_DATA=true`, leaving the wizard with steps 2 (branding), 4, 5, 6.

Phase order matters. Phase 4 reads departments/designations from Phase 3 to generate its dynamic employee template. Skipping breaks downstream — e.g. Phase 4's "Available data: Departments 0, Designations 0, Roles 0" flag will block creation.

## How phases are driven — XLSX templates

Every phase is **template-upload-driven**, not form-driven. Each phase has a "Download Template" button that gives you an XLSX to fill in:

| Phase | Template | What you fill in |
|---|---|---|
| 1 | `Tenant And Branding Master.xlsx` | Tenant code/name/type, logo URLs, palette tokens |
| 2 | (no template — UI form) | Hierarchy levels (e.g. State → District → Ward) |
| 3 | `Common and Complaint Master.xlsx` | Departments, Designations, Complaint Types |
| 4 | `Employee_Master_Dynamic.xlsx` | Employees — dynamically generated from Phase 3 data |

Filled XLSX → upload via the wizard's "Step n.1" → wizard processes rows → calls backend `_create` for each entity. Errors surface inline.

This means the wizard *is* the bulk-import path. There's no per-phase "single-create form" path; for one-off edits use Management mode.

## Phase 1 — Tenant & Branding

**What it does**: Combined tenant creation + state-level branding.

**Steps**:
- Step 1.1: Upload Tenant Master Excel → creates `tenant.tenants` MDMS records.
- Step 1.2: State Branding Configuration → creates `tenant.theme-config` (or whatever the current schema is) MDMS records, plus uploads logos to filestore and references them.

**Skip if**: ansible already created the tenant for you (`SEED_DEMO_DATA=true`). The created tenant won't disappear; you can still edit it via Management mode → Tenants.

**How to verify** (postgres direct):
```bash
docker exec docker-postgres psql -U egov -d egov -tA -c \
  "SELECT data->>'code', data->>'tenantId' FROM eg_mdms_data WHERE schemacode='tenant.tenants' ORDER BY createdtime;"
```
Expect at minimum the bootstrap tenants (`pg`, `pg.citya`, `pg.cityb`, `statea.g`) plus your seeded ones.

**Failure mode**: `SCHEMA_DEFINITION_NOT_FOUND_ERR` if the tenant XLSX has `Mdms.tenantId=ke` (records describing other tenants). The schema lives at `pg`. The wizard handles this internally; if you're driving via API, see `03-login-and-tenants.md` §"Schema scope".

## Phase 2 — Boundary Setup

**Two paths**:
- **Option 1 — Create New Hierarchy**: define the level chain via UI form (e.g. `State → District → Ward`), name the levels, and the wizard creates the `boundary-hierarchy-definition`. After that, you upload boundary entities + relationships.
- **Option 2 — Use Existing Hierarchy**: pick an already-registered hierarchy on the tenant. For Nairobi-flavoured installs ansible already created `ADMIN: County → SubCounty → Ward`, so this is the right path.

**How to verify**:
```bash
TOKEN=$(curl -s -X POST http://localhost:16000/user/oauth/token \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=ADMIN&password=eGov@123&scope=read&tenantId=pg&userType=EMPLOYEE" \
  | jq -r '.access_token')

curl -s -X POST "http://localhost:16000/boundary-service/boundary/_search?tenantId=ke.nairobi" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}" \
  | jq '{total: (.Boundary|length), by_type: ((.Boundary//[])|group_by(.additionalDetails.boundaryType)|map({type:.[0].additionalDetails.boundaryType, count:length}))}'
```
For the Nairobi pilot expect `1 County + 2 SubCounty + 9 Ward = 12 total`.

**Common failure**: search returns `{Boundary: null}` when no records exist — the wizard treats this as "boundary list empty"; if it persists after seeding, the tenant on the URL doesn't match where the boundaries were created.

## Phase 3 — Common Masters

**What it does**: Departments, Designations, Complaint Types — all from one Excel template.

**Steps**:
- Step 3.1: Upload `Common and Complaint Master.xlsx`
- Step 3.2: Create Depts & Designations (parses sheets, `_create`s rows)
- Step 3.3: Create Complaint Types (creates `RAINMAKER-PGR.ServiceDefs` records)

**Important**: Departments must succeed before Designations (designations reference dept codes); designations must succeed before complaint types (service defs reference dept). The wizard enforces this.

**Roles are NOT created here.** They are pre-seeded by CCRS local-setup's MDMS bootstrap. If your custom tenant lacks the role records (`ACCESSCONTROL-ROLES.roles`) the wizard will fail at Phase 4 with `INVALID_ROLE`. To add roles, use Management mode → Access Roles, or POST directly to `/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles` (`02-apis.md` §"Roles").

**How to verify**:
```bash
curl -s -X POST "http://localhost:16000/mdms-v2/v2/_search" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke.nairobi\",\"schemaCode\":\"common-masters.Department\",\"limit\":50}}" \
  | jq '.mdms | length'

curl -s -X POST "http://localhost:16000/mdms-v2/v2/_search" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke.nairobi\",\"schemaCode\":\"RAINMAKER-PGR.ServiceDefs\",\"limit\":100}}" \
  | jq '.mdms | length'
```
Nairobi pilot ≈ 18 departments, 37 service defs.

## Phase 4 — Employee Onboarding

**Prerequisites Met checks** (the wizard shows these at the top):
- Phase 1: Tenant created
- Phase 2: Boundaries configured
- Phase 3: Departments & Designations created

The "Available data from DIGIT" panel shows current counts:
- Departments / Designations / Roles / Boundaries

**Important**: this panel reads from `targetTenant`. If you see all zeros even after running Phases 1–3, your `crs-auth-state.targetTenant` is on the wrong tenant — change it via the localStorage snippet at the top of this doc and reload.

**What it does**:
1. **Generate `Employee_Master_Dynamic.xlsx`** — a per-tenant template with department codes, designation codes, role codes, and boundary codes pre-populated as drop-downs from the data Phase 3 created.
2. **Fill in the spreadsheet** — name, mobile, email, department, designation, roles[], jurisdictions[].
3. **Upload + bulk-create** — wizard POSTs `/user/users/_createnovalidate` then `/egov-hrms/employees/_create` per row. Errors per-row surface in the import report.

**Common failures**:
- `INVALID_ROLE` — a role in the spreadsheet isn't in `ACCESSCONTROL-ROLES.roles` at the city tenant. Either add the role (Management mode → Access Roles) or re-seed via bootstrap. See `03-login-and-tenants.md`.
- Mobile validation 400 — Kenya regex `^(0?7|0?1)\d{8}$`. 9-digit numbers (`722320295`) need a `0` prefix.
- Encrypted DB search returns nothing — on Kenya deployments `eg_user.username/mobilenumber` are encrypted at rest. Search via `/egov-hrms/employees/_search`, not `/user/_search`.

**How to verify**:
```bash
curl -s -X POST "http://localhost:16000/egov-hrms/employees/_search?tenantId=ke.nairobi&limit=100" \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}" \
  | jq '.Employees | length'
```

**Try logging in** as one of the just-created employees at `http://localhost:16080/digit-ui/employee/user/login` (tenantId=`ke.nairobi`, default password `eGov@123`) to confirm the round-trip.

## End-to-end smoke after Phase 4

Verify the configuration *actually works* before stopping:

1. Citizen mode: `http://localhost:16080/digit-ui/citizen` → file a complaint (pick one of the complaint types, locality from seeded wards, submit). Note the assigned ID (`PG-PGR-NCC-001`-style).
2. Employee mode: `http://localhost:16080/digit-ui/employee/user/login` as the GRO admin. Inbox shows the new complaint. Assign to an LME.
3. State advances to `PENDINGATLME`.
4. Log in as the LME, resolve.
5. Citizen rates → `CLOSEDAFTERRESOLUTION`.

After the round-trip:
- `/configurator/manage/pgr-dashboard` shows `pgr_mv_kpi.total = 1` after the next `DashboardRefreshScheduler` tick (~60s).
- `eg_pgr_service_v2` row in postgres has `applicationstatus='CLOSEDAFTERRESOLUTION'`.

## How to debug

If a phase appears to succeed in the UI but the verify-curl shows nothing:

1. **Check `crs-auth-state.targetTenant`** in localStorage matches the tenant your verify-curl is querying. Default is `pg`; if you didn't change it, the wizard wrote to `pg`.
2. **Open browser network tab during the wizard step.** Find the `_create` POST. Confirm response is 200/201/202. Confirm `RequestInfo.userInfo.tenantId` and `Mdms.tenantId` match what you expect.
3. **Tail the relevant service log** while you click:
   ```bash
   docker logs -f egov-mdms-service 2>&1 | grep -iE 'ERROR|exception|create|tenant'
   ```
   Most "succeeds in UI but missing in DB" issues turn up here as a swallowed exception.
4. **Check the wizard's step-state** — the configurator stores phase state in `localStorage['crs-auth-state'].completedPhases`; if you refresh mid-phase, the in-flight step's `_create` may have fired but the UI didn't advance. Re-trigger; idempotency on `_create` (`DUPLICATE_RECORD` whitelist) means re-runs are safe.

## When to escalate

- The wizard reports "Available data: 0 of everything" even after switching `targetTenant` and confirming via the verify-curls above that records exist — that's the wizard's data-load XHR talking to the wrong endpoint or rejecting the stub auth. Check DevTools network tab and report the failing call.
- A `_create` returns 5xx (not a validation 4xx).
- A schema you expected at a tenant returns `SCHEMA_DEFINITION_NOT_FOUND_ERR` on `_search` — that's missing schema-registration, beyond the wizard's scope.
