# Direct APIs (UI alternative)

Every onboarding step the configurator wizard performs is a sequence of HTTP calls through Kong. This doc gives you the curl-equivalents so you can:

- Script onboarding for CI / repeatability
- Debug a failing wizard step (compare what UI sent vs. what works in curl)
- Drive a non-Nairobi tenant without writing a new wizard
- Bulk-fix data when a phase silently dropped records

All examples assume Kong on `localhost:16000` and an auth token from `03-login-and-tenants.md`.

## Get an auth token

```bash
TOKEN=$(curl -s -X POST http://localhost:16000/user/oauth/token \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=ADMIN&password=eGov@123&scope=read&tenantId=pg&userType=EMPLOYEE" \
  | jq -r '.access_token')
echo "$TOKEN"
```

The `Basic` header is `egov-user-client:` (empty secret) — base64-encoded. Don't use `:egov-user-secret`; that's the upstream default that doesn't apply here.

## Common request envelope

Almost every DIGIT API takes:

```json
{
  "RequestInfo": {
    "authToken": "<token>",
    "userInfo": { "id": 1, "userName": "ADMIN", "type": "EMPLOYEE", "tenantId": "pg", "roles": [...] },
    "msgId": "<any-string>",
    "ts": <epoch-ms>
  },
  "<EntityWrapper>": { ... }
}
```

For brevity, examples below show only the entity-specific bits and assume `RequestInfo` is filled with the token + a synthetic userInfo.

Status code tolerance to bake in: **`[200, 201, 202]` for creates** (MDMS returns 202 under load). For searches: **`[200, 400, 404]`** — search shapes vary across DIGIT versions, fall back to "create everything" if the search response is unrecognized.

## Tenants

### Create a tenant
```
POST /mdms-v2/v2/_create/tenant.tenants
```
```json
{
  "RequestInfo": { ... },
  "Mdms": {
    "tenantId": "pg",                // where the SCHEMA lives (always pg in CCRS local-setup)
    "schemaCode": "tenant.tenants",
    "uniqueIdentifier": "Tenant.ke.nairobi",
    "data": {
      "code": "ke.nairobi",
      "name": "Nairobi",
      "tenantId": "ke.nairobi",       // the actual tenant the record describes
      "type": "CITY",
      "city": { "code": "KE_NAIROBI", "name": "Nairobi", "districtName": "Nairobi" }
    }
  }
}
```

**Idempotency**: search first; on collision the server returns `DUPLICATE_RECORD` 400.

### Search tenants
```
POST /mdms-v2/v2/_search
```
```json
{
  "RequestInfo": { ... },
  "MdmsCriteria": { "tenantId": "pg", "schemaCode": "tenant.tenants", "limit": 1000 }
}
```

### Why `tenantId=pg` (not `ke`)
The schema `tenant.tenants` is registered against `pg` (CCRS local-setup boots it there). Each MDMS record has its own `data.tenantId` describing which tenant it represents. Records are *stored* under `pg`; they *describe* whatever tenant is in `data.tenantId`. POST'ing with `Mdms.tenantId=ke` returns `SCHEMA_DEFINITION_NOT_FOUND_ERR` because `ke` doesn't have that schema registered.

## Boundaries

### 1. Create boundary entities
```
POST /boundary-service/boundary/_create
```
```json
{
  "RequestInfo": { ... },
  "Boundary": [
    { "tenantId": "ke.nairobi", "code": "KE_NAIROBI_COUNTY", "geometry": null,
      "additionalDetails": { "name": "Nairobi", "boundaryType": "County" } }
  ]
}
```
Repeat for each entity (county, sub-counties, wards). One POST can include many.

### 2. Create the hierarchy definition
```
POST /boundary-service/boundary-hierarchy-definition/_create
```
```json
{
  "RequestInfo": { ... },
  "BoundaryHierarchy": {
    "tenantId": "ke.nairobi",
    "hierarchyType": "ADMIN",
    "boundaryHierarchy": [
      { "boundaryType": "County", "parentBoundaryType": null },
      { "boundaryType": "SubCounty", "parentBoundaryType": "County" },
      { "boundaryType": "Ward", "parentBoundaryType": "SubCounty" }
    ]
  }
}
```
**Must precede relationships.** Relationships fail 400 if the hierarchy doesn't exist.

### 3. Create relationships (the tree wiring)
```
POST /boundary-service/boundary-relationships/_create
```
```json
{
  "RequestInfo": { ... },
  "BoundaryRelationship": {
    "tenantId": "ke.nairobi",
    "hierarchyType": "ADMIN",
    "boundaryType": "Ward",
    "code": "KE_NAIROBI_HARAMBEE",
    "parent": "KE_NAIROBI_MAKADARA"
  }
}
```

**Idempotency**: re-runs return `DUPLICATE_RECORD` 400. Wrap in `failed_when` (ansible) or `if [ $? -ne 0 ] && response contains DUPLICATE_RECORD ; then : ; fi`.

### Searches (note: POST, not GET)
```
POST /boundary-service/boundary/_search?tenantId=ke.nairobi
POST /boundary-service/boundary-relationships/_search?tenantId=ke.nairobi&hierarchyType=ADMIN
```
GET returns 405. Body can be `{"RequestInfo": {...}}` (no filter).

`_search` for relationships returns `TenantBoundary[].boundary[]` as a tree; flatten if you need a flat list. Beware: `BoundaryHierarchy: null` (not absent) on missing data — use `default([], true)` in jinja or `?? []` in JS.

## Roles + role-actions

### Create a role
```
POST /mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles
```
```json
{
  "RequestInfo": { ... },
  "Mdms": {
    "tenantId": "ke.nairobi",
    "schemaCode": "ACCESSCONTROL-ROLES.roles",
    "uniqueIdentifier": "GRO",
    "data": { "code": "GRO", "name": "Grievance Routing Officer", "description": "..." }
  }
}
```

### Map roles to actions
```
POST /mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions
```
Body links a role code to a list of API endpoint codes. Source files in `data/mdms/ACCESSCONTROL-ROLEACTIONS/`.

## Departments + designations
```
POST /mdms-v2/v2/_create/common-masters.Department
POST /mdms-v2/v2/_create/common-masters.Designation
```
Each takes `data.code`, `data.name`, `data.active=true`. Department first; designation references it.

## Service definitions (complaint types)
```
POST /mdms-v2/v2/_create/RAINMAKER-PGR.ServiceDefs
```
```json
{
  "Mdms": {
    "tenantId": "ke.nairobi",
    "schemaCode": "RAINMAKER-PGR.ServiceDefs",
    "uniqueIdentifier": "LandOwnershipDispute",
    "data": {
      "serviceCode": "LandOwnershipDispute",
      "name": "Land ownership dispute",
      "department": "LANDS",
      "slaHours": 72,
      "menuPath": "Lands.Ownership.Disputes",
      "active": true
    }
  }
}
```
After this, **add localization keys** so the citizen dropdown shows the human-readable name (see `04-localization.md` §"ServiceDef labels").

## Users + employees

### Create a user (low-level)
```
POST /user/users/_createnovalidate
```
```json
{
  "RequestInfo": { ... },
  "user": {
    "userName": "GRO_LANDS_001",
    "name": "Jane Otieno",
    "mobileNumber": "0722320295",
    "type": "EMPLOYEE",
    "tenantId": "ke.nairobi",
    "password": "eGov@123",
    "active": true,
    "roles": [
      { "code": "GRO", "name": "Grievance Routing Officer", "tenantId": "ke.nairobi" },
      { "code": "EMPLOYEE", "name": "Employee", "tenantId": "ke.nairobi" }
    ]
  }
}
```
**Roles must already exist as MDMS records on the user's tenant** or you get `INVALID_ROLE`. Phase 2 of the wizard creates the city-tenant role records.

### Create an employee (HRMS wrapper)
```
POST /egov-hrms/employees/_create
```
HRMS wraps the user with department/designation/jurisdictions. The wizard's Phase 4 single-create flow does this in one shot. Body shape:
```json
{
  "RequestInfo": { ... },
  "Employees": [{
    "tenantId": "ke.nairobi",
    "code": "...",
    "dateOfAppointment": <epoch-ms>,
    "user": { ... full user record ... },
    "assignments": [{ "department": "LANDS", "designation": "DIRECTOR",
                       "fromDate": <epoch>, "isCurrentAssignment": true }],
    "jurisdictions": [{ "hierarchy": "ADMIN", "boundaryType": "Ward",
                          "boundary": "KE_NAIROBI_HARAMBEE", "tenantId": "ke.nairobi" }]
  }]
}
```

### Search employees
```
POST /egov-hrms/employees/_search?tenantId=ke.nairobi&limit=100
```
Use this, not `/user/_search`, on encrypted-DB deployments (naipepea). HRMS knows how to round-trip through `egov-enc-service`.

## PGR

### Citizen creates a complaint
```
POST /pgr-services/v2/request/_create
```
Body has `service`, `workflow`, plus the citizen's user info. The wizard doesn't drive this — citizens do, via the digit-ui SPA. But you can fire it directly to load-test or seed data.

### Search complaints
```
POST /pgr-services/v2/request/_search?tenantId=ke.nairobi&limit=100
```
Note `SortBy` enum currently only allows `applicationStatus` (custom-sort fields rejected — known platform constraint).

### Workflow history
```
POST /egov-workflow-v2/process/_search?tenantId=ke.nairobi&businessIds=PG-PGR-NCC-001
```

### PGR dashboard (separate, GET-only)
```
GET /pgr-services/v2/dashboard?tenantId=ke.nairobi
```
Returns kpi/monthly/dimensions JSON. Reads materialized views, so they must exist (`../DEPLOYMENT-NOTES.md` §3.10).

## Filestore (logos, attachments)

### Upload
```
POST /filestore/v1/files
multipart/form-data: file=@logo.png, tenantId=ke.nairobi, module=branding
```
Response includes `files[0].fileStoreId` — that's the reference you save in MDMS.

### Get a presigned URL by ID
```
GET /filestore/v1/files/url?tenantId=ke.nairobi&fileStoreIds=<id>
```

**Quirk**: `ALLOWED_FORMATS_MAP` rejects SVG by default. PNG/JPG are safe. See memory `reference_filestore_quirks`.

## Localization

`/localization/messages/v1/_search` and `/localization/messages/v1/_upsert` — covered in `04-localization.md` because there's enough nuance to fill its own doc (dedup-by-code-in-batch bug, locale-region semantics, cache busting).

One endpoint worth calling out here too:

```
POST /localization/messages/cache-bust
```
Returns `{successful: true}` and invalidates the localization service's per-tenant in-memory cache. Required after any direct INSERT to the `message` table or any `_upsert` whose results need to be visible immediately. The configurator's bulk import calls it automatically. Fallback: `redis-cli DEL messages computedMessages` + `docker restart egov-localization` (heavier — only use if the endpoint is unavailable).

## Idempotency conventions

| Endpoint | On duplicate |
|---|---|
| `mdms-v2/v2/_create/{schema}` | 400 with `DUPLICATE_RECORD` |
| `boundary-service/boundary/_create` | 400 with `DUPLICATE_RECORD` |
| `boundary-relationships/_create` | 400 with `DUPLICATE_RECORD` |
| `user/users/_createnovalidate` | 400 username taken |
| `egov-hrms/employees/_create` | 400 user already wrapped |
| `localization/messages/v1/_upsert` | 200 (overwrite by `(code, module, locale, tenantId)`) |

For replay safety: `_search` first to collect existing identifiers, only `_create` what's missing.

## How to debug

When a curl returns something unexpected:

1. **Compare to what the wizard sends.** Open browser DevTools → Network tab → click the wizard's button → grab the request payload. If your curl differs, fix it.
2. **Check Kong's reach to the service.** `/{service}/health` returns `{"status":"UP"}` for most. If 502, the service is down.
3. **Look at the service log directly.** `docker logs <service> 2>&1 | tail -200` — most validation rejects show up here with the real reason (Spring's `@Valid` chains tend to log the field name).
4. **Confirm `userInfo.tenantId`** in your `RequestInfo` is the right one. Many endpoints reject silently if userInfo is from a tenant that lacks the role/action mapping for the call.

## When to escalate

- A documented endpoint returns 5xx → service is broken (paste the docker log).
- Idempotency check (`_search`) returns the record but `_create` re-creates it as a duplicate — that's a deduplication bug, not normal.
- You can hit the endpoint successfully but the UI doesn't reflect the result after hard refresh — that's a frontend cache issue, see `04-localization.md` §"Cache busting" and `06-ui-repos.md`.
