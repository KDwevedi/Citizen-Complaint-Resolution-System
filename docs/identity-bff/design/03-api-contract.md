# 02: Identity BFF frozen API contract (design revision 6)

**Prepared:** 2026-10-03, for the design-review walkthrough.
**Target:** `IDENTITY-BFF-BOUNDARY-FREEZE.md` revision 6 (cited below as §n, Dn, or item #n for the §10 work list).
**Current code:** `wt-bff/backend/identity-bff`, HEAD `8d2f2057a` (develop + #2190/#2192/#2199/#2201/#2205/#2206 merged locally). `B/` = `backend/identity-bff/src/modules/`.
**Evidence:** `_identity-bff-audit-2026-10-01/` (route inventory: `12-spec-vs-code-cohesion.md` §1c).

**Conventions**
- **PROPOSED** = I had to guess because the design says nothing. Each guess is listed again in §4.
- Where the design is silent and code exists, the **current code shape is the default**, and I say so.
- Current error bodies are `{error}` (display text), sometimes with `code`. The **target envelope (PROPOSED)** is `{code, error, ...details}` on every JSON error. `code` is stable; `error` is display text only. This is the citizen-OTP convention today (`B/citizen-otp/routes.ts:42-44`), applied everywhere.
- Every `/identity/v1/*` response sends `Cache-Control: no-store` (`app/create-app.ts:40-43`), except the branding route today and `tenant-contexts` in the target.
- **CORS:** credentialed CORS only for `IDENTITY_ALLOWED_ORIGINS`. Methods are GET/POST/OPTIONS (`create-app.ts:27-38`). Browser writes check `Origin` only when the header is present (`app/request-security.ts:4-7`). The design does not change this.

---

## 1. Route summary (current and target)

Status values:
- **KEEP:** the contract is unchanged; internals may change.
- **CHANGE:** the request, response, codes or semantics change.
- **NEW:** the route does not exist yet.
- **DELETE:** the route is removed (item 14).
- **ALIAS→DELETE:** the route is kept as a compatibility alias, then its staff use is deleted at item 14.

Audiences: **PUB** = browser, anonymous. **SES** = browser with a session cookie (one cookie per surface). **WRK** = internal workload (PGR). **OPS** = operator or ops tooling.

### 1a. Ops and probes

| # | Method | Path | Aud | Auth | Status | Item | Current file:line |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/livez` | OPS | none | KEEP | — | `B/operations/routes.ts:6` |
| 2 | GET | `/healthz` | OPS | none | KEEP (design silent; audit says dead, see Q) | — | `B/operations/routes.ts:8` |
| 3 | GET | `/readyz` | OPS | none | CHANGE | 15 | `B/operations/routes.ts:17` |

### 1b. Browser: anonymous (public)

| # | Method | Path | Aud | Auth | Status | Item | Current file:line |
|---|---|---|---|---|---|---|---|
| 4 | GET | `/identity/v1/auth-methods` | PUB | none | CHANGE | 2 | `B/authentication/routes.ts:164` |
| 5 | GET | `/identity/v1/authorize` | PUB (SES when `action=`) | none / session for `action` | CHANGE | 1, 4 | `B/authentication/routes.ts:185` |
| 6 | GET | `/identity/v1/callback` | PUB (Keycloak redirect) | login cookie + state + PKCE + nonce | CHANGE | 4, 6, 15 | `B/authentication/routes.ts:307` |
| 7 | GET | `/identity/v1/auth-results/:id` | PUB | one-time id | CHANGE | 2, 6 | `B/authentication/routes.ts:414` |
| 8 | POST | `/identity/v1/authentication/magic-link-requests` | PUB | Origin check + rate limit | KEEP | — | `B/authentication/magic-link-signup.ts:106` |
| 9 | POST | `/identity/v1/password/setup-requests` | PUB / SES | Origin check + rate limit; optional session | CHANGE | 5 | `B/authentication/password-setup.ts:100` |
| 10 | GET | `/identity/v1/password/setup-complete/:state` | PUB (Keycloak redirect) | one-time state | CHANGE | 5, 6 | `B/authentication/password-setup.ts:138` |
| 11 | GET | `/identity/v1/tenant-contexts/:urlSlug` | PUB | none | CHANGE | 11, 15 | `B/access-context/routes.ts:75` |
| 12 | GET | `/identity/v1/tenant-contexts/:urlSlug/branding` | PUB | none | **DELETE** | 14 | `B/branding/routes.ts:17` |
| 13 | POST | `/identity/v1/citizen/otp/_send` | PUB | Origin check + rate limits | CHANGE | 3, 13 | `B/citizen-otp/routes.ts:85` |
| 14 | POST | `/identity/v1/citizen/otp/_verify` | PUB | challenge + code | CHANGE | 13 | `B/citizen-otp/routes.ts:179` |

### 1c. Browser: with a session

| # | Method | Path | Aud | Auth | Status | Item | Current file:line |
|---|---|---|---|---|---|---|---|
| 15 | GET | `/identity/v1/session` | SES | surface cookie | CHANGE | 4, 9, 10, 15 | `B/sessions/routes.ts:22` |
| 16 | POST | `/identity/v1/logout` | SES | surface cookie + Origin | CHANGE | 10 | `B/sessions/routes.ts:59` |
| 17 | GET | `/identity/v1/tenants` | SES (configurator) | configurator cookie | CHANGE | 8, 11, 15 | `B/access-context/routes.ts:94` |
| 18 | POST | `/identity/v1/contexts/_select` | SES (configurator, employee) | surface cookie + Origin | CHANGE | 6, 7, 8, 10, 12 | `B/access-context/routes.ts:111` |
| 19 | POST | `/identity/v1/contexts/citizen/_select` | SES (citizen) | citizen cookie + Origin | CHANGE | 6, 10, 12, 13 | `B/access-context/routes.ts:190` |
| 20 | POST | `/identity/v1/organization-members/_invite` | SES (configurator) | cookie + Keycloak-group admin | **DELETE** (after `_link`/`_accept` consumers are on every box) | 14 | `B/organizations/routes.ts:58` |
| 21 | POST | `/identity/v1/workspace-members/_link` | SES (configurator) | cookie + Origin + live DIGIT `ACCOUNT_ADMIN` (D5) | NEW | 8, 9 | — |
| 22 | GET | `/identity/v1/workspace-members?tenantId=` | SES (configurator) | cookie + live `ACCOUNT_ADMIN` | NEW | 9 | — |
| 23 | POST | `/identity/v1/workspace-members/_remove` | SES (configurator) | cookie + Origin + live `ACCOUNT_ADMIN` | NEW | 9, 10 | — |
| 24 | POST | `/identity/v1/workspace-invitations/_accept` | SES (configurator) | cookie + Origin, bound to the subject | NEW | 9 | — |
| 25 | POST | `/identity/v1/account/providers/_unlink` | SES (any surface whose person has a Keycloak credential) | cookie + Origin, own account | NEW | 4 | — |
| 26 | POST | `/identity/v1/citizen/phone/_send` **(path PROPOSED)** | SES (citizen) | citizen cookie + Origin | NEW | 13 | — |
| 27 | POST | `/identity/v1/citizen/phone/_verify` **(path PROPOSED)** | SES (citizen) | citizen cookie + Origin | NEW | 13 | — |

### 1d. Internal: workload (PGR) and operator

All `/internal/identity/v1/*` routes take `Authorization: Bearer <token>`, compared in constant time. `_introspect` and `_check` take `IDENTITY_SESSION_INTROSPECTION_TOKEN`; every other route takes `IDENTITY_CONTROL_PLANE_TOKEN`. A missing config gives 503; a bad token gives 401 (`B/control-plane/routes.ts:86-104`).

| # | Method | Path | Aud | Auth | Status | Item | Current file:line |
|---|---|---|---|---|---|---|---|
| 28 | POST | `/internal/identity/v1/sessions/_introspect` | WRK | introspection token + forwarded configurator cookie | KEEP | — | `B/control-plane/routes.ts:295` |
| 29 | POST | `/internal/identity/v1/identifiers/_check` | WRK | introspection token | CHANGE (batched) | 11 (§5) | `B/control-plane/routes.ts:313` |
| 30 | POST | `/internal/identity/v1/organizations/_ensure` | WRK | control-plane token | CHANGE | 11 | `B/control-plane/routes.ts:198` |
| 31 | POST | `/internal/identity/v1/organizations/_lifecycle` | WRK | control-plane token | NEW | 11 | — |
| 32 | POST | `/internal/identity/v1/memberships/_ensure` | WRK | control-plane token | CHANGE (role projection removed; new body) | 11, 14 | `B/control-plane/routes.ts:331` |
| 33 | POST | `/internal/identity/v1/memberships/_remove` | WRK | control-plane token | NEW | 11 | — |
| 34 | POST | `/internal/identity/v1/bindings/_ensure` | WRK | control-plane token | NEW | 8, 11 | — |
| 35 | POST | `/internal/identity/v1/role-assignments/_ensure` | OPS (tests only) | control-plane token | **DELETE** (D1) | 14 | `B/control-plane/routes.ts:359` |
| 36 | POST | `/internal/identity/v1/tenant-groups/_ensure` | OPS (tests only) | control-plane token | **DELETE** (D15) | 14 | `B/control-plane/routes.ts:220` |
| 37 | POST | `/internal/identity/v1/tenant-routes/_backfill` | OPS | control-plane token | **DELETE** (after ops job c) | 14 | `B/control-plane/routes.ts:107` |
| 38 | POST | `/internal/identity/v1/reconciliation/_run` | OPS | control-plane token | CHANGE (result shape; no projection or deactivation) | 12 | `B/control-plane/routes.ts:387` |
| 39 | POST | `/internal/identity/v1/account-links/_link` | OPS | control-plane token | **ALIAS→DELETE** for `EMPLOYEE`; KEEP for `CITIZEN` (§8) | 14 | `B/control-plane/routes.ts:124` |
| 40 | POST | `/internal/identity/v1/account-links/_unlink` | OPS | control-plane token | **ALIAS→DELETE** for `EMPLOYEE`; KEEP for `CITIZEN` | 14 | `B/control-plane/routes.ts:172` |
| 41 | GET | `/internal/identity/v1/account-links?subject=` | OPS | control-plane token | **ALIAS→DELETE** for `EMPLOYEE`; KEEP for `CITIZEN` | 14 | `B/control-plane/routes.ts:189` |

**Counts:**
- 31 handlers are registered today (grep of `app.get/post`; audit 12 counted 33).
- Target rows: 41 = KEEP 4 · CHANGE 19 · NEW 10 (2 with PROPOSED paths) · DELETE 5 · ALIAS→DELETE 3.
- After item 14, **36 routes remain**. Rows 39–41 survive as citizen-only routes.

---

## 2. Route contracts

### 2.0 Shared mechanisms (referenced below)

**Locks and leases.** Existing keys are cited by file. Every new key name is PROPOSED; the design names the lock but not the key.

| Lock / record | Key | Scope and semantics | Used by |
|---|---|---|---|
| Per-subject lease | today `{p}:digit-user-lease:{identityKey}` (`managed-account-service.ts:269`) and `{p}:identity:user-attributes-lease:{userId}` (`organization-service.ts:77`). Target `{p}:identity:subject-lease:{sub}` (PROPOSED) | §6: shared by `_select` and revocation. §4: also held by the Keycloak writer. §8: also held by provider `_unlink`. Renewed; a lost lease mid-mint revokes the mint | 18, 19, 23, 24, 25, 33, 38, revocation, poller |
| DIGIT-uuid lock | today `{p}:account-link-lease:{digitUuid}` (`account-links.ts:81`): SET NX EX, wait `digitUserLeaseWaitMs`, else 503 `ACCOUNT_LINK_BUSY` | §3: one uuid belongs to at most one person; the check and the write happen under the lock | 21, 23, 24, 34, 39 |
| Operation lock | `{p}:identity:operation:{operationId}` (PROPOSED) | §5: validation **and** mutation happen inside it; every workload primitive takes it | 30–34 |
| Slug lock, tenant lock | `{p}:identity:slug:{slug}`, `{p}:identity:tenant:{tenantId}` (PROPOSED) | §5: keep the slug and tenantId unique across operations | 30 |
| Phone lock | `{p}:identity:phone:{e164}` (PROPOSED) | §8: sign-in identity resolution, step-up and change | 14, 26, 27 |
| Revocation generation | `{p}:identity:revocation-gen:{sub}` (PROPOSED), an INCR counter, copied onto the session record at creation | §6: incremented by logout-all and credential change; `_select` compares it after re-reading the session | 6, 14, 15, 18, 19, poller |
| Session record | `{p}:identity:session:{sid}` (`session-store.ts:55`) | Target: saves and touches are **update-only** (`SET … XX`); today they overwrite (`session-store.ts:272-277,312-314`) | all SES routes |
| Token inventory | `{p}:digit-user-token:{key}` and `…-holders:{key}` (`managed-account-service.ts:261-264`) | Target: kept until the token's **actual** expiry, separate from the refresh-skew window | 16, 18, 19, 23, revocation |
| Revocation retry set | `{p}:identity:revocation-retry` (PROPOSED) | Failed egov-user logouts stay here until they succeed or the token expires | revocation |
| Self-password-change marker | `{p}:identity:pwd-change:{sub}` (PROPOSED), short TTL, holds the initiating `sid` | §6: on the matching credential event, revoke every **other** session and token | 5, poller |
| Event checkpoint | `{p}:identity:kc-events:checkpoint` (PROPOSED) | §6: advances only after each effect or its retry job is recorded | poller |
| Reconcile lease | `{p}:identity-reconciliation-lease` (`reconciliation-service.ts:32`) | One run at a time; renewed (§4) | 38 |

**Session predicate (§3).**
- Staff: the Keycloak user is enabled, AND has an `active` binding at the tenant, AND has Organization membership there.
- Citizen: the Keycloak user is enabled AND holds a verified phone.
- DIGIT `active` is checked in addition (D4).
- Until D13 (item 14), the staff DIGIT account is resolved as **binding, else managed `kcbff-`**.
- Only `ACTIVE` Organizations (an absent lifecycle counts as `ACTIVE`) are routed, discovered or selectable.

**`digit.accounts` v1 entry (§4, frozen by item 0):**

```
{tenantId, uuid, kind: "STAFF"|"CITIZEN", boundAt, roles: [{code, tenantId}], active,
 credential?: {keyVersion}}   // credential: staff only
```

- `kind` values are PROPOSED; the design writes `kind` without listing them.
- Binding `state` (`pending|active|removed`), `invitationVersion` and the tombstone must live either in this entry or beside it. The design does not place them: see Q-B4.

---

### 2.1 `GET /livez`: KEEP

- **Response:** `200 {status:"ok"}`.
- **Caller:** Gatus.
- **Side effects:** none.

### 2.2 `GET /healthz`: KEEP (design silent)

- **Response:** `200 {status:"ok", redis:"connected"}`, or `503 {status:"unhealthy", redis:"disconnected"}`.
- **Callers:** none found (audit 12 §1c). PROPOSED: delete at item 15.

### 2.3 `GET /readyz`: CHANGE (item 15)

| | Current (`operations/routes.ts:17-62`) | Target (item 15) |
|---|---|---|
| Checks | `redis`, `keycloak` (JWKS fetch), `mdms` (if configured), `userService` (5xx = down) | Redis, JWKS, **Keycloak admin token**, **each surface's method catalogue**, DIGIT reachability, **event-poller lag** |
| 200 | `{status:"ready", checks:{…:"connected"}}` | `{status:"ready", checks:{redis, jwks, keycloakAdmin, catalog:{configurator,employee,citizen}, digit, poller:{lagSeconds}}}` (PROPOSED shape) |
| 503 | `{status:"not_ready", checks, error}`, fails on the first error | Same envelope. PROPOSED: run every check and report each; poller lag above `IDENTITY_POLLER_MAX_LAG_SECONDS` counts as not-ready (threshold PROPOSED) |

- After branding and tenant-foundation are deleted, MDMS is still read by `mobileValidationForRoute` and the tenant directory. Whether "DIGIT reachability" includes MDMS is unspecified.

### 2.4 `GET /identity/v1/auth-methods`: CHANGE (item 2)

- **Purpose:** the method policy of a surface's Keycloak client (`digit.auth.signin.methods` / `digit.auth.signup.methods`), intersected with live capability. Cached in-process for 10 s.
- **Callers:**
  - digit-ui `citizenOtp.js:28` (citizen);
  - configurator `LoginPage.tsx`, `SignupPage.tsx` (configurator).

| | Current | Target |
|---|---|---|
| Query | `surface?` = `configurator` (default) \| `employee` \| `citizen`; `intent?` = `signin` \| `signup` | Same. With item 1, `surface` is validated against the surface registry instead of a TS union |
| 200 | `{methods:[{id, label, type:"password"\|"oauth"\|"magic_link"\|"phone_otp", idpHint?, intents:["signin"\|"signup"]}]}` | `type` becomes `"password"\|"idp"\|"magic_link"\|"phone_otp"\|"hosted"` (**`oauth`→`idp`, breaking**). "Codes, not copy": PROPOSED to add `labelKey` (e.g. `IDENTITY_METHOD_PASSWORD`) and keep `label` only as the IdP displayName for `idp` |
| Citizen without a configured or enabled client | 503 `{error:"Sign-in methods are temporarily unavailable"}` | **`200 {methods:[]}`** |
| 400 | `{error}` for an unsupported intent or surface | `UNSUPPORTED_INTENT`, `UNSUPPORTED_SURFACE` (PROPOSED codes) |
| 503 | Any `IdentityAdminError` | `SIGNIN_METHODS_UNAVAILABLE` (PROPOSED). PROPOSED: only a transient Admin API failure on a non-citizen surface |

- **Declared `hosted` method:** a Keycloak-hosted authenticator; `/authorize` sends the user to Keycloak with no `kc_idp_hint`. How it is declared in the client attribute is unspecified. PROPOSED: `hosted:<id>`.
- **Side effects:** none (Admin API reads only).

### 2.5 `GET /identity/v1/authorize`: CHANGE (items 1, 4)

**Purpose:** start Authorization Code + PKCE. In the target it also starts a Keycloak required action (Application-Initiated Action) for a signed-in person.

**Query, current shape (`authentication/routes.ts:185-305`):**

| Param | Type | Rule |
|---|---|---|
| `surface` | enum | Default `configurator` |
| `intent` | `signin\|signup` | Default `signin` |
| `tenantSlug` | string | **Required** for employee/citizen, resolved server-side (`resolvePublicTenantRoute`); **forbidden** for configurator |
| `returnTo` | string | Bound surfaces: the normalized path must start with `/{slug}/digit-ui/{surface}/`. Configurator: relative, or an allowlisted origin |
| `method` | method id | Default: configurator → `password`; others → the first method that is not `phone_otp` or `magic_link`. `phone_otp` and `magic_link` are refused with 400 |
| `ui_locales` | string ≤ 64 | BCP 47-ish |

**Response:**
- 302 to Keycloak with `state`, `code_challenge` and `nonce`.
- Also sends `kc_idp_hint` for IdPs, and `digit_tenant` + `prompt=login` on bound surfaces.
- Sets the per-surface login cookie.
- Redis: the login attempt `{p}:identity:login:{state}`.

**Target diff:**

| Change | Detail |
|---|---|
| `prompt=login` literal removed (item 1) | Comes from the surface registry entry; `null` means none. Re-authentication policy moves to the Keycloak flow per client (§9) |
| New `action` param (item 4) | One of `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `delete_credential`, `UPDATE_EMAIL`, `idp_link`, and only if it is listed in the surface client's `digit.auth.account.actions`. Sent as `kc_action` |
| Action parameters | `delete_credential` takes the credential id; `idp_link` takes the provider alias (§8). Param names PROPOSED: `credentialId`, `provider` |
| Session required for `action` | Pinned to the starting person (§8). The attempt stores `{sid, sub, action}`. PROPOSED: `action` and `intent` are mutually exclusive |
| Validation for `action` | `delete_credential`: the id must be a **second-factor** credential (OTP or WebAuthn) of this person. `idp_link`: the alias must be an enabled IdP not already linked |
| Side effect, `UPDATE_PASSWORD` | Writes the self-password-change marker `{sid}` with a short TTL (§6) |
| Errors (PROPOSED codes) | `UNSUPPORTED_SURFACE` · `UNSUPPORTED_INTENT` · `UNSUPPORTED_METHOD` · `UNSUPPORTED_RETURN_TO` · `INVALID_REQUEST` (tenantSlug or ui_locales) · `TENANT_ROUTE_NOT_FOUND` 404 · `TENANT_ROUTE_UNAVAILABLE` 503 · `SIGNIN_METHODS_UNAVAILABLE` 503 · `ACTION_NOT_ALLOWED` 400 · `SESSION_REQUIRED` 401 · `CREDENTIAL_NOT_SECOND_FACTOR` 409 · `PROVIDER_ALREADY_LINKED` 409 |

- **Callers:** digit-ui `identityBffLogin.js:82`; configurator login. In the target, also both account menus (§12).

### 2.6 `GET /identity/v1/callback`: CHANGE (items 4, 6, 15)

**Current behaviour (`:307-412`):**
1. Validates `state`, the login cookie (magic-link attempts are exempt) and the attempt (consumed with GETDEL).
2. Exchanges the code, verifies the access and id tokens, and checks that `sub` matches between them.
3. For a magic-link signup draft, PUTs the Keycloak profile (`applyVerifiedSignupIdentityProfile`).
4. Creates the session and sets the cookie, then answers 303 to `returnTo`.
5. Configurator only: runs `resolveTenantOptions` and **discards** the result (`:396-400`).
6. Every failure answers 303 to `returnTo?…authResult=<id>` with `SIGN_IN_FAILED`, `AUTH_ATTEMPT_EXPIRED` or a provider code. Provider codes come from **substring matching** `error_description` (`:137-151`).

**Target diff:**

| Change | Detail |
|---|---|
| Discarded discovery removed | item 15 (performance) |
| Action attempts | Handle `kc_action_status` = `success\|cancelled\|error`. Return to `returnTo` with an auth result: PROPOSED codes `ACTION_COMPLETE` / `ACTION_CANCELLED` / `ACTION_FAILED`. PROPOSED: verify the returned `sub` equals the pinned subject; on success, replace the tokens of the **same** session (update-only) and create no new session |
| Session record | Stores the subject's current revocation generation (§6) |
| Stable codes (item 6) | The design lists `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `INVITATION_STALE` and `PENDING_INVITATION` for `callback`. Callback mints no DIGIT token today, so it cannot observe these: see Q-E2 |
| Magic-link profile PUT | Must follow the §4 writer rules: fresh read, preserve email/emailVerified/username, never send `enabled`. Note that the realm makes names user-read-only, which this admin write bypasses |

### 2.7 `GET /identity/v1/auth-results/:id`: CHANGE (items 2, 6)

- **Current:**
  - `200 {status:"failed"|"complete", code, message, actions:["TRY_AGAIN"|"TRY_EXISTING_METHOD"|"SETUP_PASSWORD"]}`;
  - 404 `{error}` when the id is consumed or expired;
  - one-time read with GETDEL (`{p}:identity:auth-result:{id}`).
- **Target:**
  - "codes, not copy": PROPOSED `{status, code, actions}`, with `message` deprecated, then dropped once the consumers localize;
  - the union gains `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `PENDING_INVITATION`, `INVITATION_STALE`, `ACTION_COMPLETE|CANCELLED|FAILED` (PROPOSED);
  - 404 gets `AUTH_RESULT_NOT_FOUND` (PROPOSED).
- **Callers:**
  - digit-ui `identityBffLogin.js:111`;
  - configurator `onboarding.ts`.

### 2.8 `POST /identity/v1/authentication/magic-link-requests`: KEEP

- **Purpose:** configurator self-signup. Saves a draft profile and sends a non-enumerating verification link.
- **Body:**
  - `email` (string, ≤ 254, lower-cased, regex);
  - `firstName`, `lastName` (trimmed, whitespace collapsed, 1–100);
  - `returnTo?` (safe relative path, or an allowlisted origin).
- **Responses:**
  - `202 {message}`, always: existing, new, rate-limited or failed are indistinguishable;
  - 400 `{error}` for missing fields or a bad `returnTo`;
  - 403 for an untrusted Origin;
  - 503 when `magic_link` is not enabled.
- **Side effects, asynchronous via `setImmediate`:**
  - a login attempt with `requiresLoginCookie:false` and `identityProfileDraft`;
  - Keycloak user ensure;
  - a phasetwo magic-link send.
- **Rate limits:** per IP and per HMAC(email), at `{p}:identity:magic-link-signup-limit:*`.
- **Target:** unchanged, apart from the PROPOSED codes `INVALID_REQUEST`, `UNTRUSTED_ORIGIN` and `SIGNUP_UNAVAILABLE`.

### 2.9 `POST /identity/v1/password/setup-requests`: CHANGE (item 5)

- **Current:**
  - body `{email?, returnTo?}`;
  - reads only the **configurator** session cookie (`currentSession(cookie)` with the default surface);
  - always `202 {message}`, also when rate-limited;
  - asynchronous `execute-actions-email` with `UPDATE_PASSWORD` (+ `VERIFY_EMAIL`), and a `{p}:identity:password-setup:{state}` attempt.
- **Target (item 5, which unblocks #2191):** the `client_id` in the setup email is chosen per surface, so the Keycloak action pages render with the right theme and `setup-complete` returns to that surface.
  - PROPOSED: a body `surface?` (default `configurator`);
  - for bound surfaces, `tenantSlug` is required and `returnTo` is checked against the surface prefix, exactly as in `/authorize`.
- **Signed-in mode:** kept. The design does not retire it in favour of `/authorize?action=UPDATE_PASSWORD`, although audit 10 proposed that. See Q-A3.
- **Also called in-process** by `_link` for new users (§5, `organization-service.ts:1176,1198`).

### 2.10 `GET /identity/v1/password/setup-complete/:state`: CHANGE (minor)

- **Current:** 303 to `attempt.returnTo` with an auth result: `PASSWORD_SETUP_COMPLETE`, `PASSWORD_SETUP_FAILED` or `AUTH_ATTEMPT_EXPIRED`. It does not burn the state during an Admin API outage.
- **Target:** returns to the surface recorded at the request (item 5), and the result carries codes only (item 2/6 convention).

### 2.11 `GET /identity/v1/tenant-contexts/:urlSlug`: CHANGE (items 11, 15)

- **Current:**
  - `200 {tenant:{urlSlug, tenantId, rootTenantId, parentTenantId, fallbackTenantIds[], name}}`;
  - 404 `{error}` for unmapped, invalid, or DIGIT-inactive;
  - 503.
- **Target:**
  - **visibility:** only `ACTIVE` Organizations (absent lifecycle = `ACTIVE`); `PROVISIONING` and `FAILED` give 404;
  - **`Cache-Control`:** cacheable (item 15). PROPOSED `public, max-age=60, stale-while-revalidate=300`;
  - `parentTenantId` / `fallbackTenantIds` become `null` / `[]` once tenant-groups are deleted. PROPOSED: keep the fields for compatibility;
  - codes: `TENANT_ROUTE_NOT_FOUND` 404, `TENANT_ROUTE_UNAVAILABLE` 503 (reused from citizen OTP).
- **Callers:** digit-ui `tenantRoute.js:55` on every boot. A slug→context cache in digit-ui is required (§12).

### 2.12 `POST /identity/v1/citizen/otp/_send`: CHANGE (items 3, 13)

- **Body:**
  - `tenantSlug` (required);
  - `mobileNumber` (`^\d{4,15}$`, national; it must pass the route tenant's `MobileNumberValidation`);
  - `locale?` (`^[a-z]{2,3}_[A-Z]{2}$`).
- **Response:**
  - `202 {challengeId, expiresIn, resendAfter}`;
  - 429 carries a `Retry-After` header.
- **Codes:** `UNTRUSTED_ORIGIN` 403 · `INVALID_REQUEST` 400 · `TENANT_ROUTE_NOT_FOUND` 404 · `TENANT_ROUTE_UNAVAILABLE` 503 · `PHONE_OTP_DISABLED` 400 · `CITIZEN_SIGNIN_NOT_CONFIGURED` 503 · `INVALID_MOBILE_NUMBER` 400 · `OTP_RESEND_TOO_SOON` 429 · `OTP_RATE_LIMITED` 429 · `OTP_CHANNEL_UNAVAILABLE` 503 · `IDENTITY_UNAVAILABLE` 503.
- **Redis:**
  - `{p}:identity:citizen-otp:*`: an HMAC'd code, the challenge bound to `(challengeId, phone, tenant)`, cooldown and per-phone and per-IP counters, with a refund when a send fails;
  - audit stream `{p}:identity:audit`.
- **Target:** delivery goes through **`HttpOtpSender`** (novu-bridge, #2203); `log` stays as the dev sender. The request and response are unchanged. The design says nothing about any lock at send.

### 2.13 `POST /identity/v1/citizen/otp/_verify`: CHANGE (item 13)

- **Body:**
  - `tenantSlug`;
  - `challengeId` (`^[A-Za-z0-9_-]{16,64}$`);
  - `code` (`^\d{6}$`).
- **Response:** `200 {authenticated:true, tenant:{urlSlug, tenantId}}`, plus the `Set-Cookie` citizen session (`authMethod:"phone_otp"`, no Keycloak tokens).
- **Codes:** `UNTRUSTED_ORIGIN` · `INVALID_REQUEST` · `TENANT_ROUTE_*` · `OTP_EXPIRED` 400 · `OTP_INVALID` 400 (+ `attemptsRemaining`) · `IDENTITY_DISABLED` 403 · `IDENTITY_CONFLICT` 409 · `IDENTITY_UNAVAILABLE` 503.
- **Claim semantics:** one Redis script claims the code; it is consumed only after the session exists; a transient Keycloak failure releases it.
- **Target diff:**
  - identity resolution and creation run **under the phone lock**;
  - **new** phone identities get an **opaque** Keycloak username; existing `phone-hash` usernames stay;
  - ownership always follows the current verified phone attribute;
  - the session stores the revocation generation.
  - The response is unchanged.

### 2.14 `GET /identity/v1/session`: CHANGE (items 4, 9, 10, 15)

**Current response (`sessions/routes.ts:22-57`):**

```
200 {authenticated:true,
     user:{id, email, name, preferredUsername, [citizen: phoneNumber, phoneNumberVerified]},
     context:{tenantId, name, organizationAlias}|null,
     [non-configurator: surface, tenant:{urlSlug, tenantId, name}|null],
     expiresAt}
```

- 401 `{authenticated:false}`.
- 400 for an unsupported surface.
- A refresh failure **deletes** the session (`current-session.ts:58-95`).

**Target additions (field names PROPOSED unless quoted from the design):**

| Field | Contents | Source |
|---|---|---|
| `pendingInvitations` (design name) | `[{tenantId, invitationVersion, name?, invitedAt?}]`. No workspace needs to be selected | §5 |
| `account.actions` | Allowed required actions for this surface's client (`digit.auth.account.actions` ∩ the frozen set) | §8 |
| `account.credentials` | `[{id, type, label}]` (design shape) | §8 |
| `account.providers` | `[{alias}]` (design shape) | §8 |

**Semantics changes:**
- **Keycloak blip (item 15):** a refresh failure caused by Keycloak being unavailable keeps the session. PROPOSED: delete only on `invalid_grant`.
- **Update-only writes (§6):** a session that revocation deleted never comes back.
- **Revocation generation behind:** PROPOSED 401 `SESSION_REVOKED`.
- **Phone-only citizens:** the `account.*` arrays are empty.

**Performance tension:** `credentials` and `providers` need Keycloak Admin reads per call, while §1 says the BFF "is never called on a signed-in page load". PROPOSED: `?include=account`, so only the account menu pays for those reads (Q-S1).

**Callers:**
- digit-ui `identityBffLogin.js`;
- configurator (the session, the pending-invite screen, the account menu).

### 2.15 `POST /identity/v1/logout`: CHANGE (item 10)

- **Request:** body or query `surface`.
- **Responses:** `204`, always (plus the cleared cookie); 403 for an untrusted Origin; 400 for a bad surface.
- **Current side effects:**
  - deletes the session;
  - releases this session's DIGIT token claim (citizen: `revokeCitizenLogin`; otherwise `revokeManagedUserLogins`), with failures **only logged**;
  - Keycloak logout with the session's refresh token.
- **Target:**
  - revocation goes through the inventory, and failures go on the **retry set**;
  - this is not logout-all: logout-all is a Keycloak event that increments the generation.
- **Consumers:** the configurator must call it (§12); digit-ui drops its direct `/user/_logout` call.

### 2.16 `GET /identity/v1/tenants`: CHANGE (items 8, 11, 15)

- **Current (configurator cookie only):**
  - `200 {tenants:[{organizationAlias, tenantId, name, roles[]}], selectionRequired, onboardingRequired}`;
  - 401;
  - 503 via `digitFailure`;
  - probes **every** mapped Organization (`tenant-directory.ts:114-125`).
- **Target:**
  - options = `ACTIVE` Organizations where the §3 staff predicate holds and DIGIT is `active`;
  - the read is targeted per subject, from `digit.accounts` and memberships (item 15);
  - `roles` come from the mirrored `digit.accounts[].roles` (PROPOSED; the design does not say);
  - pending invitations are **not** listed here; they are in `/session`.

### 2.17 `POST /identity/v1/contexts/_select`: CHANGE (items 6, 7, 8, 10, 12)

**Request (unchanged):**
- body `{surface: "configurator"|"employee", tenantId: string (trimmed, required)}`;
- `citizen` is rejected;
- an employee's `tenantId` must equal the session's bound tenant.

**Response (unchanged, the DIGIT login shape):**

```
200 {access_token, token_type:"bearer", expires_in, scope:"read", UserRequest:{…egov-user user…}}
```

**Current flow (`access-context/routes.ts:111-185`):**
1. Employee **account link**, if any: `managedUserLogin`. There is **no membership check**, and the password is rotated on every login.
2. Otherwise, a membership-based `resolveTenantOption`, then `syncSubjectTenant`. This **projects Keycloak roles and can create or update a `kcbff-` DIGIT account**. Then a managed login.

**Target flow (§6 ordering):**
1. Take the **per-subject lease**.
2. **Re-read the session.** A missing session gives 401; a generation mismatch gives 401 `SESSION_REVOKED` (PROPOSED code).
3. Predicate: Keycloak enabled, **binding** `active` (else managed `kcbff-` until D13), Organization membership (D10), Organization `ACTIVE`, DIGIT `active`.
   - A `pending` binding at this tenant → 403 **`PENDING_INVITATION`**.
   - No binding or no membership → 403 `EMPLOYEE_ACCOUNT_NOT_LINKED` (existing code, kept for both surfaces, PROPOSED).
4. Return the cached token after **cheap validation** against egov-user. An invalid token is evicted and a new one minted. A dependency error is **not** treated as invalid.
5. Otherwise, mint with the **derived credential** (`encode_v1(HMAC(key[v], "v1"‖uuid‖tenantId))`):
   - set it lazily the first time (DIGIT writer), and record `credential.keyVersion`;
   - parse typed login failures:
     - invalid credentials → **one repair** per lease, then retry;
     - locked → 403 **`ACCOUNT_LOCKED`**, no repair;
     - inactive → 403 **`ACCOUNT_INACTIVE`**, no repair;
     - unknown or malformed → 503 `DIGIT_UNAVAILABLE`.
6. Record the token in the inventory until its actual expiry.
7. If the lease was lost, revoke the minted token and return 503 `SUBJECT_BUSY` (PROPOSED).
8. Mirror DIGIT→Keycloak (`digit.accounts`, name/locale per D12) and propagate KC→DIGIT identifiers (verified email).

The target removes per-login password rotation, role projection, and any DIGIT account creation.

**Status codes:**
- 400 `UNSUPPORTED_SURFACE` / `INVALID_REQUEST`;
- 401 `SESSION_REQUIRED` / `SESSION_EXPIRED` / `SESSION_REVOKED`;
- 403 `TENANT_CONTEXT_UNAVAILABLE` / `EMPLOYEE_ACCOUNT_NOT_LINKED` / `PENDING_INVITATION` / `ACCOUNT_LOCKED` / `ACCOUNT_INACTIVE`;
- 503 `TENANT_ROLES_MISSING` / `DIGIT_PII_MASKED` / `DIGIT_UNAVAILABLE` / `SUBJECT_BUSY`.

**Personas:**
- configurator founder and admin (`surface:"configurator"`);
- employee (digit-ui, `surface:"employee"`).

### 2.18 `POST /identity/v1/contexts/citizen/_select`: CHANGE (items 6, 10, 12, 13)

**Request:** `surface?` must be `citizen`; the tenant comes **only** from the session's bound tenant.

**Response (unchanged):** the `_select` token shape plus `tenant:{urlSlug, tenantId}`.

**Current checks, in order:**
1. A citizen session with `azp` equal to the citizen client, or 403.
2. A verified phone, or 403.
3. The DIGIT tenant is active, or 403.
4. A `MobileNumberValidation` rule exists, or 503.
5. `splitE164`, or 403.
6. `ensureCitizenRegistration`: existing link → managed → legacy search by phone.
   - An ambiguous match gives 409 **`CITIZEN_ACCOUNT_AMBIGUOUS`**.
   - A blocked link gives 409 `CITIZEN_ACCOUNT_LINK_BLOCKED`.
   - A registration `DISABLED` gives 403.
7. Mint with the egov-otp grant.
8. Wrong account type or tenant → 502.

**Target diff:**
- per-subject lease, plus the session re-read and generation check;
- citizen predicate: Keycloak enabled + verified phone;
- the citizen account written to `digit.accounts` as `kind: CITIZEN`, which is the D12 profile source;
- KC→DIGIT verified-phone propagation (DIGIT writer: read-modify-write; skip when masked);
- **D6** forbids per-city suspension, so the registration `DISABLED` branch (`citizen-registration.ts:142,193`) should be removed (PROPOSED; the design does not mention the code);
- codes for today's code-less 403s: `PHONE_NOT_VERIFIED`, `CITIZEN_CONTEXT_UNAVAILABLE`, `INVALID_MOBILE_NUMBER`, `DIGIT_ACCOUNT_MISMATCH` (502) (PROPOSED).

### 2.19 `POST /identity/v1/workspace-members/_link`: NEW (items 8, 9)

**Purpose:** a configurator admin binds a person, by email, to an HRMS-created DIGIT employee. This replaces `_invite`. The flow is HRMS `_create` followed by `_link`.

**Request:**

| Field | Type | Req | Validation |
|---|---|---|---|
| `tenantId` | string | ✓ | The `ACTIVE` Organization's tenant; the caller has a live **DIGIT `ACCOUNT_ADMIN`** there (D5, read live, not from Keycloak groups) |
| `digitUuid` | string | ✓ | An active `EMPLOYEE` account at `tenantId`; not a `kcbff-` managed account (current rule `DIGIT_ACCOUNT_MANAGED`) |
| `email` | string | ✓ | Normalized like `normalizedEmail` (≤ 254, lower-case) |
| `requestId` | string (UUID) | PROPOSED ✓ | Identifies "the **same** request" for resume (§5 step 4). The design stores it in `digit.linkPending` but never says where it comes from (Q-B1) |

**Authorization rules (§3):**
- A self-bind → 403 `SELF_BINDING_FORBIDDEN` (PROPOSED code).
- The target uuid holds a role the caller lacks at `tenantId` → 403 `ROLE_ESCALATION_FORBIDDEN` (PROPOSED).

**Flow:**
- **New Keycloak user:**
  1. Create it with `digit.linkPending={tenantId, digitUuid, email, requestId}` in the create call.
  2. Add Organization membership.
  3. Create the binding as `active`.
  4. Set the derived credential and `keyVersion` (§6, "at binding").
  5. Send the password-setup email (existing activation machinery; client per item 5).
  6. Clear the marker.
- **Existing user**, including one created by an unfinished link from **another** request or workspace: create a binding `pending` with a fresh `invitationVersion`. There is **no** membership until accept.
- **Repeat semantics:**
  - same `requestId` → resume on the new-user branch;
  - never demote an `active` binding;
  - never resurrect a `removed` one (tombstone).
  - **Re-invite** = an explicit new request on a `removed` or `pending` key, which issues a new `invitationVersion` and invalidates the old one. How the client signals "explicit re-invite" is unspecified: PROPOSED `reinvite: true`.

**Response (all PROPOSED):**
- `201 {binding:{subject, tenantId, digitUuid, state:"active", boundAt}, identityUserCreated:true, activationEmailSent:true}`;
- `200 {binding:{…, state:"pending", invitationVersion}, identityUserCreated:false}`;
- a repeat returns `200` with the current state.

**Errors:**
- 401 `SESSION_REQUIRED`;
- 403 `ADMIN_REQUIRED` / `SELF_BINDING_FORBIDDEN` / `ROLE_ESCALATION_FORBIDDEN`;
- 404 `DIGIT_ACCOUNT_NOT_FOUND`;
- 409 `DIGIT_ACCOUNT_LINKED_ELSEWHERE` (the uuid is bound to another person), `BINDING_CONFLICT` (this person already has a different uuid at the tenant), `DIGIT_ACCOUNT_MANAGED`, `BINDING_REMOVED` (a tombstone without a re-invite; PROPOSED);
- 503 `ACCOUNT_LINK_BUSY` (rename to `BINDING_BUSY`, PROPOSED) / `DIGIT_UNAVAILABLE` / `IDENTITY_UNAVAILABLE`.

**Locks:** the uuid lock covers the uniqueness check and the write; the per-subject lease covers the Keycloak attribute writes.

**Side effects:**
- Keycloak: user create, attributes, membership, execute-actions email;
- egov-user: the derived password (the DIGIT writer, with its masking guard);
- Redis: none beyond locks.

**Notifying an existing user:** whether an existing user gets an email about a pending invite is not specified (Q-B3).

### 2.20 `GET /identity/v1/workspace-members?tenantId=`: NEW (item 9)

- **Auth:** session + live `ACCOUNT_ADMIN` at `tenantId`.
- **Response (PROPOSED):** `200 {members:[{subject, email, name, digitUuid, state:"active"|"pending", invitationVersion?, boundAt}], next?}`.
- **Paging:** `first` / `max` (PROPOSED).
- **Errors:** 401 · 403 `ADMIN_REQUIRED` · 503.
- **Implementation gap:** Keycloak cannot query inside a JSON attribute. A Redis index or a per-tenant exact-value attribute is needed (today `usersWithAccountLink` uses an exact-value `q=` search). See Q-B5.

### 2.21 `POST /identity/v1/workspace-members/_remove`: NEW (items 9, 10)

- **Request (PROPOSED):** `{tenantId, subject}`. The design does not name the key; `digitUuid` would also work.
- **Effect (§5):**
  - an `active` or `pending` binding → `removed` (tombstone);
  - the uuid reservation is released;
  - Organization membership is removed;
  - **tokens are revoked** (inventory, then the derived-credential fallback, then the retry set);
  - BFF sessions for that subject end.
  - The design does not scope session termination: a configurator session may hold other workspaces (Q-B6).
- **Response:** idempotent. PROPOSED `200 {removed:boolean, state:"removed"}`.
- **Errors:** 403 `ADMIN_REQUIRED`; PROPOSED 409 `SELF_REMOVAL_FORBIDDEN` (to avoid locking out the last admin).
- **Locks:** the per-subject lease (shared with revocation) + the uuid lock.

### 2.22 `POST /identity/v1/workspace-invitations/_accept`: NEW (item 9)

- **Request:** `{tenantId: string, invitationVersion: string|number}`. The type of `invitationVersion` is unspecified; PROPOSED an opaque string.
- **Rules:**
  - bound to the authenticated subject;
  - the binding must be `pending` with that version;
  - on success: grant membership, make the binding `active`, set the derived credential, and mirror.
- **Response (PROPOSED):** `200 {binding:{tenantId, digitUuid, state:"active", boundAt}}`. A repeat on an already-`active` binding with the same version returns `200` (PROPOSED).
- **Errors:**
  - 409 **`INVITATION_STALE`**: the invitation was removed, replaced or superseded. PROPOSED: also when no invitation exists, to avoid enumeration;
  - 401;
  - 503.
- **Open point:** does the inviter's `ACCOUNT_ADMIN` need to still hold at accept time, and do the escalation rules re-run? (Q-B7)
- **Locks:** the per-subject lease + the uuid lock.

### 2.23 `POST /identity/v1/account/providers/_unlink`: NEW (item 4)

- **Request:** `{alias: string}`. The caller's own account only.
- **Rules (§8):**
  - under the per-subject lease, read the person's **primary** methods fresh: a password, linked providers, and the phone for citizens (TOTP does not count);
  - removing the last one → 409 `LAST_SIGNIN_METHOD` (PROPOSED code; the design states the rule but no code).
- **Response:** PROPOSED `200 {providers:[{alias}]}`. A provider that is not linked → `200` (idempotent) or 404 `PROVIDER_NOT_LINKED` (Q).
- **Side effect:** Keycloak `DELETE /users/{id}/federated-identity/{alias}`.
- **Callers:** the configurator and digit-ui account menus.

### 2.24 Citizen phone step-up and change: NEW (item 13; **paths and shapes PROPOSED**)

The design (§8) specifies the behaviour but not the routes:
- challenges are bound to `(subject, session, purpose, newNumber)`;
- the phone lock is held;
- step-up returns 409 if **another person** owns the phone;
- change keeps every citizen uuid: it updates Keycloak, then each citizen account across the person's roots, from the current Keycloak value; reconcile retries failures;
- sessions carrying the old number are invalidated.

| Route (PROPOSED) | Request | Response | Codes |
|---|---|---|---|
| `POST /identity/v1/citizen/phone/_send` | `{purpose:"STEP_UP"\|"CHANGE", mobileNumber, locale?}`. Tenant rule from the session's bound tenant | `202 {challengeId, expiresIn, resendAfter}` | `OTP_*` as in `_send`, `SESSION_REQUIRED`, `PHONE_IN_USE` 409 (PROPOSED) |
| `POST /identity/v1/citizen/phone/_verify` | `{challengeId, code}` | `200 {phoneNumber, phoneNumberVerified:true}`. Other sessions of the subject that carry the old number are deleted | `OTP_INVALID`, `OTP_EXPIRED`, `PHONE_IN_USE` 409, `IDENTITY_UNAVAILABLE` |

### 2.25 `POST /internal/identity/v1/sessions/_introspect`: KEEP

- **Request:** forwards the configurator session cookie.
- **Response:** `200 {active:true, identity:{issuer, subject, email, name, preferredUsername}}`, or 401 `{error}`.
- **Caller:** PGR `IdentitySessionClient.java:24`.
- §5 says "before `IDENTITY_READY` only". Nothing in the BFF can enforce that, so PROPOSED it is a PGR-side rule (Q-W4).

### 2.26 `POST /internal/identity/v1/identifiers/_check`: CHANGE (batched)

| | Current (`:313-326`) | Target (§5 "batched") |
|---|---|---|
| Request | `{type: ORGANIZATION_NAME\|ORGANIZATION_ALIAS\|URL_SLUG\|ACCOUNT_CODE\|TENANT_ID, value}` | PROPOSED `{identifiers:[{type, value}]}` (1–20) |
| Response | `{type, value (as sent), available}`. `type` is upper-cased | PROPOSED `{results:[{type, value, available}]}`, in request order |
| Cost | Pages **every** Organization (and its groups) per call (`organization-service.ts:409-451`) | One pass over the Organizations per batch |
| Semantics | Advisory only | Same; the real uniqueness comes from the slug and tenant locks in `organizations/_ensure` |
| Errors | 400 for an unsupported type (no code); 401 | `INVALID_REQUEST`, `WORKLOAD_UNAUTHORIZED` (PROPOSED) |

- PGR's `IdentitySessionClient.java:128` must change in step with this. PROPOSED: accept the single-item body as well until it does.

### 2.27 `POST /internal/identity/v1/organizations/_ensure`: CHANGE (item 11)

| | Current (`:198-218`) | Target (§5) |
|---|---|---|
| Body | `{tenantId, alias (^[a-z0-9][a-z0-9-]{1,62}$), name}` | `{operationId, restartNo:int≥0, tenantId, slug, name, rootTenantId}` |
| Precondition | DIGIT tenant active, else 409 | Same (PROPOSED `TENANT_FOUNDATION_MISSING` 409); the saga order guarantees the foundation exists |
| Semantics | Upsert; `adoptExisting:true` | See the outcome table below |
| Response | `{organization}` | PROPOSED `{organization:{id, alias, urlSlug, tenantId, rootTenantId, lifecycle, operationId, restartNo}, created:boolean}` |

**Target outcomes:**

| Case | Result |
|---|---|
| Same operationId, same restartNo, same `operationHash` | 200, the existing Organization |
| Same restartNo, different hash | 409 `OPERATION_CONFLICT` (PROPOSED code) |
| Higher restartNo on this operation's Organization in `PROVISIONING` or `FAILED` | Re-stamp every field, back to `PROVISIONING`; the match is on `digit.operationId` |
| Higher restartNo and the slug changed | A **new** Organization; the old one is set to `FAILED` |
| Lower restartNo | 409 `ATTEMPT_STALE` |
| Another operation holds the slug or tenantId | 409 `SLUG_TAKEN` / `TENANT_TAKEN` (PROPOSED) |

**Hash:** the canonical JSON of `{slug: lower, name: trimmed, tenantId, rootTenantId}`.

**Locks:** the operation lock, then the slug lock + the tenant lock (lock order PROPOSED: operation → slug → tenant).

**Stored on the Organization:** `digit.operationId`, `digit.restartNo`, `digit.operationHash`, `digit.lifecycle=PROVISIONING`.

### 2.28 `POST /internal/identity/v1/organizations/_lifecycle`: NEW (item 11)

- **Body:** `{operationId, restartNo, state:"ACTIVE"|"FAILED"}`.
- **Rules:**
  - `PROVISIONING → ACTIVE|FAILED`, for the current restartNo only;
  - repeating the recorded transition → 200;
  - a conflicting transition → 409 `LIFECYCLE_CONFLICT` (PROPOSED);
  - a lower restartNo → 409 `ATTEMPT_STALE`;
  - an unknown operation → 404 `OPERATION_NOT_FOUND` (PROPOSED).
- **Response (PROPOSED):** `200 {organization:{tenantId, lifecycle, restartNo}}`.
- **Lock:** the operation lock.
- **Caller:** PGR, which replays the call until the BFF acknowledges it.

### 2.29 `POST /internal/identity/v1/memberships/_ensure`: CHANGE (items 11, 14)

| | Current (`:331-357`) | Target (§5) |
|---|---|---|
| Body | `{organizationId, userId, mobileNumber?, countryCode?}`; `digitUserUuid` rejected | `{operationId, restartNo, subject, tenantId}` |
| Effect | Organization membership + `syncSubject`: **projects roles; creates or updates a managed `kcbff-` DIGIT account** | Organization membership **only**; idempotent |
| Response | `{tenantId, digitUserUuid, created}` | PROPOSED `{tenantId, subject, member:true}` |
| Errors | 400 / 404 / 409 / 502 (no codes) | `ATTEMPT_STALE` 409 · `OPERATION_NOT_FOUND` 404 · `IDENTITY_NOT_FOUND` 404 (PROPOSED for an unknown subject) |

- **Lock:** the operation lock. Whether it requires the Organization to be in `PROVISIONING` is unspecified (Q-W2).

### 2.30 `POST /internal/identity/v1/memberships/_remove`: NEW (item 11)

- **Body:** `{operationId, restartNo, subject, tenantId}`.
- **Effect:** removes a previous founder's membership **and binding** when a restart brings a different founder; revokes their tokens (PROPOSED, consistent with `_remove`).
- **Idempotent:** a membership that is already absent → 200.
- **Response (PROPOSED):** `200 {removed:boolean}`.
- **Codes:** `ATTEMPT_STALE` 409, `OPERATION_NOT_FOUND` 404.
- **Open point:** does it leave a tombstone that would block a later `bindings/_ensure` for the same founder on a further restart? (Q-W3)

### 2.31 `POST /internal/identity/v1/bindings/_ensure`: NEW (items 8, 11)

- **Body:** `{operationId, restartNo, subject, tenantId, digitUuid}`.
- **Effect:**
  - the founder binding becomes `active` at once;
  - **the actor rules are skipped**, but uuid uniqueness still applies (uuid lock);
  - the DIGIT writer sets the derived credential and records `keyVersion`.
- **Outcomes:**
  - the same key with the same uuid → 200;
  - the same key with a **different** uuid → 409 **`BINDING_CONFLICT`**;
  - the uuid is bound to another person → 409 `DIGIT_ACCOUNT_LINKED_ELSEWHERE`;
  - a stale restart → 409 `ATTEMPT_STALE`.
- **Response (PROPOSED):** `200 {binding:{subject, tenantId, digitUuid, state:"active", boundAt}, created:boolean}`.
- **Locks:** the operation lock → the uuid lock → the per-subject lease.

### 2.32 `POST /internal/identity/v1/reconciliation/_run`: CHANGE (item 12)

- **Current:**
  - `200` (lease acquired) or `202` (another run holds it);
  - `{acquired, organizations, subjects, accounts, updated, deactivated, unchanged, unprovisioned, failures[{subject, error}]}`;
  - it **deactivates** former members' DIGIT accounts.
- **Target (§4):** mirror DIGIT→Keycloak, revoke, and retry identifier propagation. It **never writes DIGIT `active`** and never creates or restores a membership or binding.
  - PROPOSED result: `{acquired, subjects, mirrored, revoked, propagated, unchanged, failures[], lagSeconds}`.
  - `deactivated` and `unprovisioned` disappear.
- **Lease:** the reconcile lease (renewed); cursor batches.

### 2.33 `/internal/identity/v1/account-links*`: ALIAS→DELETE for staff, KEEP for citizens

| Route | Current shape |
|---|---|
| `POST …/account-links/_link` | `{links:[{userType?:"EMPLOYEE"\|"CITIZEN", tenantId, subject?\|email?, digitUserUuid?\|digitUserName?(EMPLOYEE)}] (1–500), actor?}` → `200 {results:[{index, status:"LINKED"\|"ALREADY_LINKED"\|"REFUSED", code?, error?, subject?, userType?, tenantId?, digitUserUuid?}]}` (per-item codes; see §3) |
| `POST …/account-links/_unlink` | `{subject, userType?, tenantId, digitUserUuid, block?:bool, actor?}` → `{removed:boolean}`; revokes the cached login |
| `GET …/account-links?subject=` | `{links:[{userType, tenantId, digitUuid}], blocks:[…]}` |

**Target:**
- Until item 14, the `EMPLOYEE` items act as compatibility aliases of the binding model. PROPOSED: an `EMPLOYEE` `_link` writes an `active` binding and requires membership via ops job (a); `_unlink` equals `workspace-members/_remove`.
- After item 14, `userType` must be `CITIZEN`; `EMPLOYEE` → 400 `INVALID_REQUEST` (PROPOSED).
- The citizen routes are how an admin resolves `CITIZEN_ACCOUNT_AMBIGUOUS` (§8).

### 2.34 Deleted routes (for completeness)

| Route | Replacement | Delete when |
|---|---|---|
| `GET /tenant-contexts/:slug/branding` | The Keycloak theme reads public MDMS directly (§12) | Theme change deployed |
| `POST /organization-members/_invite` | `workspace-members/_link` + `_accept` | Configurator consumers on every box (§13 step 4) |
| `POST …/role-assignments/_ensure` | None (D1: DIGIT is the role authority) | Item 14 |
| `POST …/tenant-groups/_ensure` | None (D15) | Item 14 |
| `POST …/tenant-routes/_backfill` | Ops job (c), run once | After job (c) on every box |

---

## 3. Stable error-code catalogue

**Legend:**
- **Src:** E = exists in code today. D = named in the design. P = PROPOSED by this document.
- **Retry:** Y = retry the same request with back-off; N = do not retry; C = retry only after the condition changes.
- "AR" = delivered through `auth-results` (a 303 redirect plus a one-time result), not an HTTP error body.

### 3a. Sign-in results (auth-results)

| Code | HTTP | Src | Meaning | Emitted by | Retry | Client action |
|---|---|---|---|---|---|---|
| `AUTH_CANCELLED` | AR | E | The user cancelled at Keycloak (`access_denied`) | callback | N | Offer TRY_AGAIN |
| `AUTH_ATTEMPT_EXPIRED` | AR | E | The state was missing, expired or already used | callback, setup-complete | N | Restart sign-in or setup |
| `IDENTITY_PROVIDER_UNAVAILABLE` | AR | E | IdP error (the fallback mapping) | callback | Y | Try again, or another method |
| `ACCOUNT_LINK_REQUIRED` | AR | E | The email already belongs to an existing account | callback | C | Sign in with the existing method, or set a password |
| `ACCOUNT_LINK_FAILED` | AR | E | Broker linking failed | callback | C | Same |
| `IDENTITY_ALREADY_LINKED` | AR | E | That IdP identity is linked to another user | callback | N | Contact an admin |
| `EMAIL_VERIFICATION_REQUIRED` | AR | E | The existing account's email is unverified | callback | C | Verify, or set a password |
| `SIGN_IN_FAILED` | AR | E | Generic callback failure (cookie mismatch, token verification) | callback | Y | Try again |
| `PASSWORD_SETUP_FAILED` | AR | E | The setup link was used but no password exists | setup-complete | C | Request another link |
| `PASSWORD_SETUP_COMPLETE` | AR (`status:"complete"`) | E | Success | setup-complete | — | Sign in |
| `ACCOUNT_LOCKED` | 403, or AR | D | egov-user reports the account locked; no credential repair | `_select`, (callback, AR: Q-E2) | C | Show "locked, contact admin or wait"; no retry |
| `ACCOUNT_INACTIVE` | 403, or AR | D | egov-user reports the account inactive | `_select`, (callback, AR) | N | Contact an admin |
| `PENDING_INVITATION` | 403, or AR | D | The binding at this tenant is `pending` | `_select`, (callback, AR) | C | Configurator: go to accept. digit-ui: "accept in the configurator" |
| `INVITATION_STALE` | 409, or AR | D | The invitation was removed or replaced, or its version is old | `_accept`, (callback, AR) | N | Ask the admin to re-invite |
| `ACTION_COMPLETE` / `ACTION_CANCELLED` / `ACTION_FAILED` | AR | P | Outcome of a required action (`kc_action_status`) | callback | N / C / Y | Return to the account menu |

### 3b. Browser JSON errors

| Code | HTTP | Src | Meaning | Emitted by | Retry | Client action |
|---|---|---|---|---|---|---|
| `INVALID_REQUEST` | 400 | E (OTP, links) | Malformed body or query | OTP routes, account-links; P: all routes | N | Fix the input |
| `UNTRUSTED_ORIGIN` | 403 | E (OTP) | The `Origin` is not allowlisted | OTP routes; P: every browser POST | N | Configuration bug |
| `UNSUPPORTED_SURFACE` / `UNSUPPORTED_INTENT` / `UNSUPPORTED_METHOD` / `UNSUPPORTED_RETURN_TO` | 400 | P (text-only today) | — | auth-methods, authorize, session, `_select`, logout | N | Bug |
| `SIGNIN_METHODS_UNAVAILABLE` | 503 | P | The Keycloak client catalogue is unreadable | auth-methods, authorize | Y | Retry later |
| `SIGNUP_UNAVAILABLE` | 503 | P | Magic link not enabled | magic-link-requests | Y | — |
| `ACTION_NOT_ALLOWED` | 400 | P | `action` is not in the client's `digit.auth.account.actions` | authorize | N | Hide the menu item |
| `CREDENTIAL_NOT_SECOND_FACTOR` | 409 | P | `delete_credential` on a primary credential | authorize | N | — |
| `PROVIDER_ALREADY_LINKED` / `PROVIDER_NOT_LINKED` | 409 / 404 | P | — | authorize (idp_link), providers/_unlink | N | Refresh `/session` |
| `LAST_SIGNIN_METHOD` | 409 | P (the rule is D) | It would remove the last primary method | providers/_unlink | C | Add another method first |
| `AUTH_RESULT_NOT_FOUND` | 404 | P | The result was consumed or expired | auth-results | N | Ignore |
| `TENANT_ROUTE_NOT_FOUND` | 404 | E (OTP) | Slug unmapped, inactive, or Organization not `ACTIVE` | tenant-contexts, authorize, OTP | N | Show "unknown workspace" |
| `TENANT_ROUTE_UNAVAILABLE` | 503 | E (OTP) | Keycloak or DIGIT error resolving the slug | same | Y | Retry |
| `SESSION_REQUIRED` | 401 | P | No or invalid session cookie | every SES route | N | Start sign-in |
| `SESSION_EXPIRED` | 401 | P (text today: "Identity session expired") | The session vanished mid-request | `_select` | N | Sign in again |
| `SESSION_REVOKED` | 401 | P | The session's revocation generation is behind (logout-all, credential change) | `/session`, `_select`, citizen `_select` | N | Sign in again |
| `SUBJECT_BUSY` | 503 + `Retry-After` | P | Per-subject lease contention, or the lease was lost mid-mint | `_select`, `_accept`, `_remove`, providers/_unlink | Y | Retry after the delay |
| `TENANT_CONTEXT_UNAVAILABLE` | 403 | P (text today) | Wrong tenant for the bound employee session, or not selectable | `_select` | N | — |
| `EMPLOYEE_ACCOUNT_NOT_LINKED` | 403 | E | No active binding (or managed account), or no membership (D10) | `_select` | C | Contact an admin |
| `TENANT_ROLES_MISSING` | 503 | E | egov-user `INVALID_ROLE`: the tenant baseline is not seeded | `_select` | C | Operations: seed the baseline |
| `DIGIT_ACCOUNT_INACTIVE` | 403 | E | The linked DIGIT account is inactive (pre-mint check) | `_select` | N | **Merge into `ACCOUNT_INACTIVE`?** (Q-E1) |
| `DIGIT_PII_MASKED` | 503 | E | The DIGIT writer refused a masked read-modify-write | `_select`, citizen `_select` | C | Operations |
| `DIGIT_UNAVAILABLE` | 503 (502 in control-plane today) | E | egov-user/MDMS unreachable, or a malformed login error (§6 "dependency error") | all DIGIT-touching routes | Y | Retry |
| `IDENTITY_UNAVAILABLE` | 503 | E | Keycloak Admin unreachable | OTP routes; P: all | Y | Retry |
| `PHONE_OTP_DISABLED` | 400 | E | — | otp/_send | N | Hide phone sign-in |
| `CITIZEN_SIGNIN_NOT_CONFIGURED` | 503 | E | No `MobileNumberValidation` rule for the tenant | otp/_send; P: citizen `_select` | C | Operations |
| `INVALID_MOBILE_NUMBER` | 400 (403 in citizen `_select`) | E | The number fails the tenant rule | otp/_send, phone/_send; P: citizen `_select` | N | Re-enter the number |
| `OTP_RESEND_TOO_SOON` | 429 + `Retry-After` | E | Per-phone cooldown | otp/_send, phone/_send | C | Wait `retryAfter` |
| `OTP_RATE_LIMITED` | 429 + `Retry-After` | E | Per-phone or per-IP window quota | same | C | Wait |
| `OTP_CHANNEL_UNAVAILABLE` | 503 | E | Sender failed; challenge dropped, quota refunded | same | Y | Retry |
| `OTP_INVALID` | 400 (+ `attemptsRemaining`) | E | Wrong code | otp/_verify, phone/_verify | C | Re-enter |
| `OTP_EXPIRED` | 400 | E | Challenge missing, expired, exhausted, or for another route | same | N | Request a new code |
| `IDENTITY_DISABLED` | 403 | E | The phone's Keycloak user is disabled (D6 block) | otp/_verify | N | Contact support |
| `IDENTITY_CONFLICT` | 409 | E | Two verified Keycloak owners of a phone | otp/_verify | N | Operations |
| `PHONE_IN_USE` | 409 | P (the rule is D) | Another person owns the phone (step-up or change) | phone/_send, phone/_verify | N | Use another number |
| `PHONE_NOT_VERIFIED` | 403 | P (text today) | The citizen session has no verified phone | citizen `_select` | C | Phone step-up |
| `CITIZEN_CONTEXT_UNAVAILABLE` | 403 | P (text today) | Wrong client, inactive tenant, or account not active | citizen `_select` | N | — |
| `CITIZEN_ACCOUNT_AMBIGUOUS` | 409 | E + D | More than one legacy CITIZEN uses the number, or the account is linked elsewhere | citizen `_select` | C | Admin links via the internal citizen route |
| `CITIZEN_ACCOUNT_LINK_BLOCKED` | 409 | E | An admin removed this phone link with `block` | citizen `_select` | C | Admin |
| `DIGIT_ACCOUNT_MISMATCH` | 502 | P (text today) | egov-user returned the wrong account type or tenant | citizen `_select` | N | Operations |
| `ADMIN_REQUIRED` | 403 | P | The caller lacks live DIGIT `ACCOUNT_ADMIN` at the tenant (D5) | `_link`, members list, `_remove` | N | — |
| `SELF_BINDING_FORBIDDEN` | 403 | P (the rule is D) | A browser caller tried to bind themselves | `_link` | N | — |
| `ROLE_ESCALATION_FORBIDDEN` | 403 | P (the rule is D) | The target account holds a role the caller lacks | `_link` | N | — |
| `SELF_REMOVAL_FORBIDDEN` | 409 | P | Removing your own binding | `_remove` | N | — |
| `BINDING_REMOVED` | 409 | P | A tombstoned key without an explicit re-invite | `_link` | C | Re-invite explicitly |

### 3c. Binding, account-link and workload codes

| Code | HTTP | Src | Meaning | Emitted by | Retry | Client action |
|---|---|---|---|---|---|---|
| `BINDING_CONFLICT` | 409 | D | The same `(subject, tenant)` key with a different uuid | bindings/_ensure; P: `_link` | N | PGR: reuse the HRMS uuid; investigate |
| `DIGIT_ACCOUNT_LINKED_ELSEWHERE` | 409 | E | The uuid already belongs to another person | account-links/_link; P: `_link`, bindings/_ensure | N | Admin |
| `DIGIT_ACCOUNT_MANAGED` | 409 | E | A `kcbff-` account cannot be linked | account-links/_link; P: `_link` | N | — |
| `DIGIT_ACCOUNT_NOT_FOUND` | 404 | E | No active DIGIT account matches | account-links/_link; P: `_link` | C | Check the HRMS record |
| `SUBJECT_ALREADY_LINKED` | 409 | E | The person already has a link of that type at the tenant | account-links/_link | N | Unlink first |
| `ACCOUNT_LINK_BUSY` | 503 | E | uuid lock wait timed out | account-links, citizen `_select`; P: `_link` (rename to `BINDING_BUSY`) | Y | Retry |
| `TENANT_NOT_FOUND` | 404 | E | Unknown or inactive DIGIT tenant | account-links/_link | N | — |
| `IDENTITY_NOT_FOUND` | 404 | E | No enabled Keycloak user | account-links/_link; P: memberships/bindings | N | — |
| `ATTEMPT_STALE` | 409 | D | `restartNo` lower than the stored one | organizations/_ensure, _lifecycle, memberships/_ensure, _remove, bindings/_ensure | N | PGR: drop the stale attempt |
| `OPERATION_CONFLICT` | 409 | P (the 409 is D) | Same restartNo, different payload hash | organizations/_ensure | N | PGR bug |
| `SLUG_TAKEN` / `TENANT_TAKEN` | 409 | P (the 409 is D; `SLUG_TAKEN` exists as a backfill reason) | Another operation holds the slug or tenant | organizations/_ensure | N | User picks another slug |
| `LIFECYCLE_CONFLICT` | 409 | P (the 409 is D) | Conflicting transition (e.g. `ACTIVE` after `FAILED`) | _lifecycle | N | PGR |
| `OPERATION_NOT_FOUND` | 404 | P | No Organization carries this operationId | _lifecycle, memberships/*, bindings/_ensure | N | PGR: call `_ensure` first |
| `TENANT_FOUNDATION_MISSING` | 409 | P (409 exists, text only) | The DIGIT tenant does not exist yet | organizations/_ensure | C | PGR: order the saga |
| `WORKLOAD_UNAUTHORIZED` | 401 | P (text today) | Bad bearer token | all `/internal` | N | Fix the token |
| `CONTROL_PLANE_NOT_CONFIGURED` | 503 | P (text today) | Token env unset | all `/internal` | N | Deploy configuration |

**Non-error enums kept as-is (not error codes):**
- link result `LINKED` / `ALREADY_LINKED` / `REFUSED`;
- backfill reasons `NOT_ROOT` / `NOT_ACTIVE` / `ALREADY_MAPPED` / `INVALID_SLUG` / `SLUG_TAKEN` / `ALIAS_TAKEN` (deleted with the route);
- audit events.

**Totals:** 82 codes.
- **39 exist in code:** 10 auth-result, 15 citizen-OTP, and 14 from `_select`, account-links and citizen-link. This count includes `CITIZEN_ACCOUNT_AMBIGUOUS`, which the design also names.
- **6 are named only in the design:** `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `PENDING_INVITATION`, `INVITATION_STALE`, `BINDING_CONFLICT`, `ATTEMPT_STALE`.
- **37 are PROPOSED.** About 20 of them only add a code to an error that today returns display text; about 10 enforce rules the design states without naming a code.

---

## 4. Gaps the design leaves unspecified

### 4a. Contract shape

| # | Gap | What I assumed (PROPOSED) |
|---|---|---|
| A1 | **The error envelope and "codes, not copy"**: does `message`/`error` stay, and does `label` stay on methods? | `{code, error}` on every JSON error; `message` deprecated on auth-results; `labelKey` added to methods |
| A2 | **HTTP status of the new codes** (`ACCOUNT_LOCKED` 403 vs 423; `INVITATION_STALE` 409 vs 410) | 403 / 403 / 403 / 409 |
| A3 | Is the signed-in mode of `password/setup-requests` retired in favour of `/authorize?action=UPDATE_PASSWORD` (audit 10 item 10)? | Kept (design silent) |
| A4 | Item 5 "client_id per surface": which request field picks the surface; does it need `tenantSlug`? | `surface?` + `tenantSlug` for bound surfaces |
| A5 | The `/authorize` `action` parameter names, and whether `action` with `intent` is legal | `credentialId`, `provider`; mutually exclusive |
| A6 | Action completion: a new session, or update the existing one? Subject-pinning check at callback? | Update the same session; refuse a mismatched `sub` |
| A7 | How a `hosted` method is declared in `digit.auth.*.methods` | `hosted:<id>` |
| A8 | "Citizen methods return `[]`, not 503": only for "not configured", or also for transient failures? | Only for "not configured" |
| A9 | `tenant-contexts` `Cache-Control` value | `public, max-age=60, stale-while-revalidate=300` |
| A10 | `/readyz` shape, the poller-lag threshold, and whether MDMS is still a dependency | Per-check report; env threshold |
| A11 | `/healthz` (dead) | Delete at item 15 |

### 4b. Bindings and members (items 8 and 9)

| # | Gap | PROPOSED |
|---|---|---|
| B1 | **Where `requestId` for `_link` resume comes from** (client body, `Idempotency-Key` header, or derived) | Required client UUID in the body |
| B2 | Response bodies and status codes of `_link`, `_accept`, the member list and `_remove` | As in §2.19–2.22 |
| B3 | Is an **existing** user notified of a pending invite (email), or only via `/session` `pendingInvitations`? | Only `/session` (design text) |
| B4 | Where binding `state`, `invitationVersion` and the tombstone live in `digit.accounts` v1 (item 0 must freeze this) | Fields on the staff entry: `state`, `invitationVersion`, `removedAt` |
| B5 | How the member list finds bindings (Keycloak cannot query JSON attributes) | A Redis index per tenant, or an exact-value attribute `digit.binding.{tenantId}` |
| B6 | `_remove` key (`subject` vs `digitUuid`) and which BFF sessions end | `{tenantId, subject}`; end every session of that subject (conservative) |
| B7 | `_accept`: re-check the inviter's authority and the escalation rule at accept time? | No re-check (the invite was authorized when made) |
| B8 | Explicit re-invite signal, and whether re-inviting a `removed` key is allowed | `reinvite:true`; allowed |
| B9 | Self-removal or last-admin protection | 409 `SELF_REMOVAL_FORBIDDEN` |
| B10 | `/session` `pendingInvitations` fields beyond `{tenantId, invitationVersion}` (workspace name, inviter) | `name`, `invitedAt` |
| B11 | Migration of existing `digit.accountLinks` (EMPLOYEE), `digit.managedTenants` and `digit.citizenRegistrations` into `digit.accounts` v1 | Lazy on `_select` plus a reconcile pass |

### 4c. Workload primitives (item 11)

| # | Gap | PROPOSED |
|---|---|---|
| W1 | Codes for the unnamed 409s (same restartNo with a different hash, slug or tenant held, conflicting lifecycle) | `OPERATION_CONFLICT`, `SLUG_TAKEN`/`TENANT_TAKEN`, `LIFECYCLE_CONFLICT` |
| W2 | Can `memberships/_ensure`, `bindings/_ensure` and `memberships/_remove` run when the Organization is `ACTIVE` or `FAILED`, or only in `PROVISIONING`? | Any state for the current restartNo |
| W3 | After `memberships/_remove`, can the same founder be re-bound on a later restart (tombstone semantics for the workload)? | Workload removal leaves **no** tombstone |
| W4 | `_introspect` "before `IDENTITY_READY` only": who enforces it? | PGR (the BFF has no saga state) |
| W5 | The `identifiers/_check` batch shape and limit, and the transition for PGR | `{identifiers:[…]}` ≤ 20; accept the single form until PGR ships |
| W6 | `slug` vs Keycloak Organization `alias` vs `digit.urlSlug`; how `tenantId` relates to `rootTenantId` | alias = slug = urlSlug; `rootTenantId` = tenantId for a root workspace |
| W7 | Response bodies of every primitive | As in §2.27–2.31 |
| W8 | Lock acquisition order (operation, slug, tenant, uuid, subject) to avoid deadlock | operation → slug → tenant → uuid → subject |

### 4d. Sessions, revocation and citizens

| # | Gap | PROPOSED |
|---|---|---|
| S1 | `/session` must return credential and provider metadata, but §1 says the BFF is not called on a signed-in page load | `?include=account` |
| S2 | Code and status for a session whose revocation generation is behind | 401 `SESSION_REVOKED` |
| S3 | **The citizen phone step-up and change routes are not named** | `/citizen/phone/_send` and `/_verify` with `purpose` |
| S4 | D6 versus the existing per-tenant citizen registration `DISABLED` status (`citizen-registration.ts:142,193`) | Remove the `DISABLED` branch |
| S5 | Can citizen issuance hit `ACCOUNT_LOCKED`? (egov-user locks citizens too) | Yes; map it the same way, with no repair (citizens have no derived credential) |
| S6 | Are there codes for the lease-lost or lease-busy cases? | `SUBJECT_BUSY` 503 + `Retry-After` |
| S7 | Does the magic-link profile PUT at callback conflict with "names read-only, mirrored from DIGIT" (§4/§12)? | Allowed, because it happens before any binding; D12 overwrites it later |

### 4e. Scope

| # | Gap | PROPOSED |
|---|---|---|
| X1 | PGR gets the **control-plane token**, which also authorizes operator routes (account-links, reconcile). There is no least-privilege split (audit 12 §1c) | Split into a third token, `IDENTITY_WORKLOAD_TOKEN` |
| X2 | `DIGIT_ACCOUNT_INACTIVE` (existing) vs `ACCOUNT_INACTIVE` (design) | Keep `ACCOUNT_INACTIVE` and alias the old code until consumers move |
| X3 | Item 6 lists `callback` and `auth-results` as emitters of the DIGIT-side codes, but callback never touches DIGIT | Only `_select` emits them; `auth-results` would carry them only if callback gains a predicate check |

### 4f. Questions for the owner (top first)

1. **Q-B1/B2:** what is the idempotency key for `_link` resume, and what are the response shapes of the four member routes? They are the configurator's main new contract.
2. **Q-S3:** what are the citizen phone step-up and change routes? The behaviour is frozen, but there is no endpoint.
3. **Q-A1/A2/X2/X3:** the error envelope and HTTP statuses for the new codes. Does `ACCOUNT_INACTIVE` replace `DIGIT_ACCOUNT_INACTIVE`? Can `callback` emit DIGIT-side codes at all?
4. **Q-X1/W4:** should PGR get a dedicated workload token, rather than the operator-level control-plane token? Who enforces "introspect before `IDENTITY_READY` only"?
5. **Q-B4/B5/B11:** where do binding state, `invitationVersion` and tombstones sit in `digit.accounts` v1? How is the member list indexed? How do existing links and registrations migrate? All three must be frozen at item 0, before items 7–13.

Further questions:
- W2/W3: workload primitives against non-`PROVISIONING` Organizations, and founder re-binding after `_remove`.
- S1: credential metadata cost on `/session`.
- S4: the citizen `DISABLED` status versus D6.
- A3: retiring the signed-in password-setup mode.
