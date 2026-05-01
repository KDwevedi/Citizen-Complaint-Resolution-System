# Login + tenant model

The single most common stuck-state for a first-time DIGIT operator is "I'm logged in but everything 400s" — caused by tenant-scope confusion. This doc explains the mental model, the login API, and the four classic failure modes.

## Tenant scopes — mental model

DIGIT tenants are dotted hierarchical strings:

```
pg                ← bootstrap (CCRS local-setup)
ke                ← root (Kenya)
  ke.nairobi      ← city under ke
  ke.bomet        ← another city
in                ← root (India)
  in.mumbai
```

Three things to keep separate:

1. **Where a record is stored** (`Mdms.tenantId` on a `_create`). Often `pg` or another bootstrap.
2. **What tenant the record describes** (`data.tenantId`). E.g. a `tenant.tenants` record stored under `pg` describes `ke.nairobi`.
3. **What tenant the operator is authenticated for** (`RequestInfo.userInfo.tenantId`). Drives access control.

These are commonly conflated and cause real bugs. When something 400s, your first check should be: which of the three is mismatched?

## Roles + access-control

A user has `roles[]`, each with `code` (e.g. `GRO`) and `tenantId` (where the role *as an MDMS record* lives). The access-control service intersects:

```
user.roles ∩ MDMS_role_definitions ∩ MDMS_role_action_mappings
```

If the user's `roles[].tenantId` points to a tenant that doesn't have that role's MDMS record, you get `INVALID_ROLE`. This is the #1 cause of "I just created an admin and it can't log in."

## Configurator's stub auth (and how to point it at a real tenant)

The configurator SPA is the first thing most operators see. **It does not show a login screen on first load.** Instead, on boot it auto-populates `localStorage['crs-auth-state']` with a stub user:

```js
{
  user: { name: "System Administrator", roles: ["EMPLOYEE", "GRO", "SUPERUSER", "DGRO"], ... },
  authToken: "<stub>",
  isAuthenticated: true,
  mode: "management",
  tenant: "pg",
  targetTenant: "pg",
  currentPhase: 1,
  completedPhases: []
}
```

The SPA threads this stub through API calls. Most endpoints accept it for SUPERUSER-level operations because the bootstrap tenant `pg` has the role-action mappings that grant access. **You don't have to log in to use the configurator** — that's a feature, not a bug, of personal-install's pre-bootstrapped CCRS local-setup.

**`tenant` and `targetTenant`**: the wizard's data-load XHRs (Phase 4 "Available data: Departments X, Designations Y, …") query `targetTenant`. To target your seeded `ke.nairobi` instead of the default `pg`:

```js
// in the configurator's browser console
var s = JSON.parse(localStorage.getItem('crs-auth-state'));
s.targetTenant = 'ke.nairobi';
s.tenant = 'ke.nairobi';
localStorage.setItem('crs-auth-state', JSON.stringify(s));
location.reload();
```

The header now shows `ke.nairobi` next to "System Administrator" and the wizard reads/writes against that tenant.

**Backend curls still need a real token** from `/user/oauth/token` — see below. The stub is configurator-internal; it's not what the rest of the system uses.

## Login API

### Bootstrap operator (CCRS local-setup ADMIN)
```bash
TOKEN=$(curl -s -X POST http://localhost:16000/user/oauth/token \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=ADMIN&password=eGov@123&scope=read&tenantId=pg&userType=EMPLOYEE" \
  | jq -r '.access_token')
```

The `Basic` auth is `egov-user-client:` (empty secret), base64-encoded as `ZWdvdi11c2VyLWNsaWVudDo=`.

**Don't use** `ZWdvdi11c2VyLWNsaWVudDplZ292LXVzZXItc2VjcmV0` (`egov-user-client:egov-user-secret`) — that's the upstream default and CCRS naipepea overrides it to empty. Returns 401.

### City-tenant employee (after wizard Phase 4 creates them)
```bash
TOKEN=$(curl -s -X POST http://localhost:16000/user/oauth/token \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=GRO_LANDS_001&password=eGov@123&scope=read&tenantId=ke.nairobi&userType=EMPLOYEE" \
  | jq -r '.access_token')
```

`tenantId=ke.nairobi` here is critical — the user exists at the city tenant, not at `pg`. Login as `tenantId=pg` for a `ke.nairobi` user returns `invalid_credentials`.

### Citizen (OTP-based, not password)
```bash
# Step 1 — request an OTP
curl -X POST http://localhost:16000/otp/v1/_send \
  -H "Content-Type: application/json" \
  -d '{"otp":{"mobileNumber":"0712345678","tenantId":"ke.nairobi","type":"login","userType":"CITIZEN"}}'

# Step 2 — exchange OTP for a token
curl -X POST http://localhost:16000/user/oauth/token \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=0712345678&password=<otp>&scope=read&tenantId=ke.nairobi&userType=CITIZEN"
```

Citizens auto-register on first OTP. There's no password stored — `password=eGov@123` for citizens always 401s.

## Token contents

The bearer token is opaque to the client; you pass it via `RequestInfo.authToken`. The login response also returns `UserRequest` with the user's roles, tenantId, type — stash this for `RequestInfo.userInfo` in subsequent calls (most APIs require it).

```json
{
  "access_token": "...",
  "expires_in": 86399,
  "UserRequest": {
    "id": 1, "userName": "ADMIN", "type": "EMPLOYEE", "tenantId": "pg",
    "roles": [{"code": "SUPERUSER", "tenantId": "pg"}, ...]
  }
}
```

## Failure mode #1 — login fails

Symptom: `401 invalid_credentials`.

Diagnose:
1. **Username case-sensitive.** `Admin` ≠ `ADMIN`. The form may auto-cap or lowercase; verify what's actually sent.
2. **Password case-sensitive + special chars.** `eGov@123` (the `@` matters; the `G` is uppercase). Common mistake: `eGov123` (missing `@`).
3. **Tenant matches the user's tenant.** Bootstrap ADMIN is at `pg`, not `ke.nairobi`. After Phase 4 you have a city ADMIN at `ke.nairobi` — that one needs `tenantId=ke.nairobi`.
4. **userType matches.** `EMPLOYEE` for staff, `CITIZEN` for citizens. EMPLOYEE login on a citizen mobile number 401s.

If all four are correct, paste the request and response, and check `docker logs egov-user`.

## Failure mode #2 — INVALID_ROLE on user/employee create

Symptom: `INVALID_ROLE: Unable to validate role from MDMS` when POSTing `/user/users/_createnovalidate` or `/egov-hrms/employees/_create`.

Cause: the role(s) you put in `user.roles[]` reference a `tenantId` where that role's MDMS record doesn't exist.

Diagnose:
```bash
# Are the roles registered at the city tenant?
curl -s -X POST http://localhost:16000/mdms-v2/v2/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"ke.nairobi\",\"schemaCode\":\"ACCESSCONTROL-ROLES.roles\",\"limit\":50}}" \
  | jq '.mdms[].data.code'
```

If the list is empty, run wizard Phase 2 (or `02-apis.md` §"Roles"). If full, the issue is the `tenantId` in your request — it should match where the roles live.

Fallback: while bootstrapping a city tenant before its roles exist, point `roles[].tenantId` at `pg` (which has them from CCRS local-setup). The wizard's Phase 2 then re-creates them on the city tenant and you can swap.

## Failure mode #3 — SCHEMA_DEFINITION_NOT_FOUND_ERR

Symptom: `_create` to `/mdms-v2/v2/_create/<schema>` returns `SCHEMA_DEFINITION_NOT_FOUND_ERR`.

Cause: `Mdms.tenantId` points to a tenant where that schema isn't registered. Schemas are registered against specific tenants — typically the bootstrap (`pg`).

Diagnose:
```bash
# Where is this schema registered?
curl -s -X POST http://localhost:16000/mdms-v2/v2/schema/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"SchemaDefCriteria\":{\"tenantId\":\"pg\",\"codes\":[\"tenant.tenants\"]}}"
```

Fix: use the tenant where the schema is registered as `Mdms.tenantId`. The record's `data.tenantId` carries the logical scope. They're allowed to differ.

## Failure mode #4 — token works for some endpoints, not others

Symptom: `MDMS _search` works but `pgr-services/v2/request/_create` returns 403 / "ACCESS_DENIED".

Cause: role-action mapping is missing. The role you have doesn't include the API endpoint in its allowed actions list.

Diagnose:
```bash
curl -s -X POST http://localhost:16000/access/v1/actions/mdms/_get \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"tenantId\":\"ke.nairobi\",\"roleCodes\":[\"GRO\"]}"
```

If the response is empty or 400 (`Missing property in path $['MdmsRes']['ACCESSCONTROL-ACTIONS-TEST']['actions-test']`), the access-control registry is missing for that tenant. This is a **pre-existing NCCG-onboarding gap** at `ke` — flagged in `Nai Pepea/docs/DEV-LOG.md` §13. Workaround: log in as a SUPERUSER (which bypasses most checks) until the access-actions seed is filled in.

## Cross-tenant operations

Once you have a `pg/ADMIN` token, you can `_search` and `_create` records that target other tenants — the bootstrap superuser has SUPERUSER role and is treated as cross-tenant.

```json
"RequestInfo": {
  "authToken": "<pg-admin-token>",
  "userInfo": { "tenantId": "pg", "roles": [{"code": "SUPERUSER", "tenantId": "pg"}], ... }
},
"Mdms": { "tenantId": "ke.nairobi", ... }
```

This is how ansible's `02-seed-tenants.yml` registers `ke` and `ke.nairobi` while authenticated to `pg`. It's also how the wizard works: you log in to the configurator at `pg/ADMIN` and target `ke.nairobi` from the wizard.

## How to debug "I can't tell what tenant my UI is on"

Every digit-ui XHR includes `tenantId` in either the URL or body. In DevTools network tab:

1. Click any wizard interaction.
2. Inspect the request payload.
3. Check three things: URL `?tenantId=`, body `Mdms.tenantId`, body `RequestInfo.userInfo.tenantId`.

The configurator stores the wizard target tenant in localStorage under `STATE_LEVEL_TENANT_ID` (or similar) and threads it into requests. If you're unsure, `localStorage.clear()` and re-login resets cleanly.

## When to escalate

- Login works (`access_token` returned) but every subsequent call 401s — token-validation issue, may need `egov-user` log inspection.
- `INVALID_ROLE` even though `_search` confirms the role IS at the right tenant — possible MDMS cache desync, restart `egov-mdms-service`.
- Cross-tenant operation 403s with a `pg/ADMIN` token — access-control may have been hardened on this deploy; check role-action MDMS at `pg`.
