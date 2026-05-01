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

## Citizen OTP login — the five-layer config

The citizen `/digit-ui/citizen/login` flow on personal-install needs **five** distinct config layers in agreement to produce a working session token (and the SPA's "auto-register on login" fallback to actually create new citizens). Skip any one of them and you see a different failure mode. All five mirror naipepea production; the bundle below is shipped on `feat/personal-install`.

| Layer | File | What it does | What breaks if missing |
|---|---|---|---|
| 1. Kong mock for `/otp/*` and `/user-otp/*` | `local-setup/kong/kong.yml` (`otp-validate-mock`, `user-otp-mock` services) | `request-termination` plugin returns hardcoded `{"otp":"","isValidationSuccessful":true}` body. No real OTP service, no SMS gateway. | `POST /otp/v1/_send` → 404 from Kong; SPA falls through to `/citizen/register/name` |
| 2. digit-ui nginx proxy regex | `local-setup/nginx/digit-ui.conf` | Forwards `/otp`, `/user-otp`, `/egov-user-event` from `:16080` to Kong on `:16000`. | Same 404 — but from this nginx layer, before Kong is reached |
| 3. `egov-user` OTP host points at Kong | `local-setup/docker-compose.yaml`, env `EGOV_OTP_HOST: http://kong:8000` | Routes egov-user's internal OTP-validate call through Kong, hits the mock from layer 1. | Citizen-create internal validate calls a non-routable URL |
| 4. Citizen OTP fixed value | `local-setup/docker-compose.yaml`, env on egov-user: `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED: "true"` + `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE: "123456"` | egov-user accepts citizen OTP "123456" directly — bypasses the `eg_token` row check that would normally compare against the OTP `_send` wrote. Our Kong mock doesn't write that row. | `/user/oauth/token` returns 400 "Invalid login credentials" no matter what OTP you type |
| 5. `egov-user` self-callback host | `local-setup/docker-compose.yaml`, env `EGOV_USER_HOST: http://localhost:8107` | Inside the `/user/citizen/_create` handler, egov-user calls its own `/user/oauth/token` to issue the access token after creating the user. The Java code defaults to `http://egov-user.egov:8080` (a Kubernetes-style hostname that doesn't resolve on docker-compose). | `/user/citizen/_create` (the auto-register endpoint) returns 400 with `UnknownHostException: egov-user.egov` |

**The hardcoded OTP value for personal-install is `123456`.** That's the value to type at the `/digit-ui/citizen/login/otp` screen after entering a mobile number. Same as naipepea (which also uses `123456`).

### Auto-register on login (the new-citizen path)

The SPA's `Login/index.js:332-352` has a try/catch around `authenticateAndSetUser()`: if OAuth fails (typically because the citizen doesn't exist yet), it calls `Digit.UserService.registerUser(...)` (POST `/user/citizen/_create`) and retries auth. With layers 1–5 above all in place, this fallback **transparently creates the citizen** on their first login attempt — they just type their mobile + OTP `123456` and they're in. Their `name` defaults to the mobile number (no registration form needed); they can edit it later via `/digit-ui/citizen/user/profile`.

This matches naipepea's UX: any new mobile + `123456` works on first try, no separate registration step.

To change it: edit `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE` in `local-setup/docker-compose.yaml` and `docker compose up -d --force-recreate --no-deps egov-user`.

To turn it off entirely (require real OTP): set `CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED: "false"`. Won't actually work on personal-install yet — needs a real OTP _validate flow that checks against eg_token rows from a real `_send`. So leave it on.

### Verifying the chain end-to-end

```bash
# 1. Kong layer — should return 200 with the mock body
curl -X POST http://localhost:16000/otp/v1/_send \
  -H 'Content-Type: application/json' \
  -d '{"otp":{"mobileNumber":"9876543210","tenantId":"pg","type":"login","userType":"CITIZEN"}}'
# expect: {"ResponseInfo":{...},"otp":{"otp":"","isValidationSuccessful":true}}

# 2. nginx layer — same body via the SPA's port :16080
curl -X POST http://localhost:16080/otp/v1/_send -H 'Content-Type: application/json' -d '{}'
# expect: same 200 body

# 3+4. End-to-end OAuth — exchange OTP for a token
curl -X POST http://localhost:16000/user/oauth/token \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&username=9876543210&password=123456&scope=read&tenantId=pg&userType=CITIZEN'
# expect: HTTP 200 with access_token (after the citizen user exists at the tenant)
# OR:    HTTP 400 with "User not found" if the mobile isn't registered yet —
# that's a separate issue from OTP; the citizen must exist first.
```

### When all five are right but you still get 400

- **Wrong tenant** — citizens registered at `ke.nairobi` won't auth at `tenantId=pg`. Match the tenant on `_send`, `/user/oauth/token`, and the SPA's `Citizen.tenant-id` localStorage entry.
- **Layer 5 missing on a fresh stack** — symptom is that `/user/oauth/token` directly returns 400 (because the citizen doesn't exist) but auto-register at `/user/citizen/_create` also fails with `UnknownHostException: egov-user.egov`. Confirm `EGOV_USER_HOST=http://localhost:8107` is on the running egov-user container: `docker inspect egov-user | grep EGOV_USER_HOST`.
- **Mobile validation regex** — egov-user runs the mobile through MDMS `ValidationConfigs.mobileNumberValidation` for the tenant. Default fallback is `(^$|[0-9]{10})` — strict 10-digit, no country code. Fails: `9876543`, `+919876543210`. Works: `9876543210`.

### How to confirm "the OTP layer is working" without the user-existence variable

```bash
# Find an existing CITIZEN on the tenant
docker exec docker-postgres psql -U egov -d egov -tA -c \
  "SELECT username FROM eg_user WHERE type='CITIZEN' AND tenantid='pg' AND active=true LIMIT 1;"

# Try OTP "123456" against that user — should be 200
# Try a wrong OTP — should be 400
# If 200 vs 400 split matches the OTP value, the layer-4 fixed-OTP logic is working.
```

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
