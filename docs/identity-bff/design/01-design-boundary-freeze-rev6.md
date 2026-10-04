# Identity BFF: service boundary and completion plan

**Revision:** 6.1 (2026-10-04): revision 6 plus the owner's line comments on fork PR #36. Revision 6 replaced revisions 1–5. Revisions 4 and 5 were each reviewed by Astra and Fable; all four verdicts were "ready with changes". The review loop closes here: further detail is left to implementation and the §11 gate.
**Inputs:**
- a 12-agent audit (`_identity-bff-audit-2026-10-01/`);
- three review rounds:
  - revision 1: Astra and Fable;
  - revision 2: Opus and Codex;
  - revision 3: Astra and Fable, both "ready with changes";
- the owner's decisions.

The reviews are `review*.md` in the session scratchpad.

## 0. What "done" means

"Never push BFF code again for this category of work" is a test of **completeness**, not a ban on code changes. The BFF is done when:
- it offers a **stable API contract for the system as it is today**: login, signup, onboarding identity steps, profile, sign-in method management and Keycloak↔DIGIT sync;
- it is low-complexity and modular;
- every path has executed test coverage (§11);
- all of this sits inside `backend/identity-bff`.

**Constraints:**
- No changes to any egov service.
- Storage stays in Keycloak attributes plus Redis. Every Redis key family must be one of these (each family is tagged in the state schema):
  - **re-derivable:** rebuilt from Keycloak or DIGIT, e.g. the derived staff credential, or mirrors rebuilt by reconcile;
  - **restartable:** losing it only means the person or process starts again: sign in again, resend an OTP, resubmit onboarding; leases simply expire;
  - **documented limit:** citizen tokens and inactive or locked staff tokens can't be revoked once their inventory is lost, and live until expiry (§6).
- DIGIT3 is a planned reopen (§7).
- **Test coverage never drops.** The existing integration and e2e specs that sign in through the legacy flows are migrated onto the BFF flows (item 18). No spec is removed without a replacement.
- Deployment hardening of legacy egov-user endpoints is tracked separately.

## 1. The boundary

The BFF is a **credential-to-account broker**. In short, it does three things:
1. It turns a Keycloak sign-in, or a verified citizen phone, into one DIGIT account and its token, for the tenant the URL names.
2. It keeps that binding, and Keycloak's mirror of DIGIT roles, profile and status, consistent.
3. It enforces and revokes access.

**Its full set of capabilities:**

| Capability | What the BFF does | Where |
|---|---|---|
| Sign up | Configurator founder sign-up (magic link, password setup). The tenant itself is created by PGR's onboarding steps | §5 |
| Sign in | Keycloak sign-in per surface; citizen phone OTP; picking the tenant from the URL | §1, §8 |
| Tenant selection | `_select`: the live access check, then a DIGIT token for that tenant | §3, §6 |
| My signed-in sessions | Show my sessions; sign out this one; sign out everywhere | §6 |
| Edit my profile | Phone (citizens) and email (staff) through the BFF or Keycloak. Descriptive fields (name, photo, gender…) are edited in the DIGIT profile UI and mirrored | §4, §8 |
| My credentials and providers | Password, TOTP, remove a second factor, link or unlink Google and similar, with last-method protection | §8 |
| Workspace members | Admins link, invite, list and remove staff; invitees accept | §5 |
| DIGIT writes with its own admin credential | Exactly three: set or repair a staff account's derived credential; write identifiers through (phone, email); log out and revoke tokens. It never writes roles, `active`, HR data or MDMS | §4, §6 |
| Sync | Mirror DIGIT roles, status and profile into Keycloak; write Keycloak identifiers into DIGIT | §4, sync matrix |
| Revocation | React to Keycloak events, reconcile and logout | §6 |
| Onboarding primitives | Identity steps that PGR calls during tenant creation | §5 |

| Owner | Owns |
|---|---|
| **Keycloak** | Credentials, identity providers, MFA, sign-in flows, the person record, Organization membership |
| **BFF** | Browser sessions; tenant binding; account bindings; token issuance and revocation; citizen phone OTP; the DIGIT→Keycloak mirror; Keycloak→DIGIT login identifiers |
| **DIGIT** (egov-user, HRMS) | Roles, employment status, descriptive profile, everything a token is allowed to do |
| **PGR onboarding** | The onboarding steps (§5) and their order, tenant foundation, platform baseline, readiness, retries |

**The BFF never:**
- writes MDMS, encryption keys or HRMS records;
- runs the onboarding steps (the ordered, resumable steps that create a tenant at signup, §5);
- holds a role catalogue;
- accepts a **person's** password (it does set the derived DIGIT credential of a bound staff account, §6);
- knows an SMS or WhatsApp provider;
- proxies DIGIT business calls;
- is called on a signed-in page load;
- writes DIGIT `active` or DIGIT roles;
- modifies realm configuration.

## 2. Decisions (final)

| # | Decision |
|---|---|
| D1 | DIGIT (egov-user roles, written by HRMS) is authoritative for roles, mirrored DIGIT→Keycloak. The Keycloak→DIGIT role projection, the allowlist and the role `_ensure` endpoints are deleted |
| D2 | Onboarding (worker, tenant foundation, PLATFORM_BASELINE) moves to PGR. The BFF exposes identity primitives (§5) |
| D3 | DIGIT is authoritative for the descriptive profile, mirrored DIGIT→Keycloak. Keycloak is authoritative for credentials and verified login identifiers, written Keycloak→DIGIT |
| D4 | Access = DIGIT `active` AND the identity-side predicate (§3). The BFF enforces it and never flips either side |
| D5 | Organization-admin authority = the caller's **live DIGIT `ACCOUNT_ADMIN`** at that tenant. `TENANT_ADMIN` is retired. This needs code (`member-invitation-service.ts:39-51` reads Keycloak groups today) |
| D6 | No per-city citizen suspension. Blocking a citizen = disabling their Keycloak user |
| D7 | The sync is a BFF module with explicit projections |
| D8 | No egov service changes |
| D9 | Storage stays in Keycloak attributes + Redis |
| D10 | Staff sign-in requires an `active` binding AND live Organization membership |
| D11 | Founders keep `SUPERUSER` for now (O1) |
| D12 | The Keycloak profile comes from the person's first binding; if that one is inactive or unbound, the next active one |
| D13 | Existing `kcbff-` managed employees are cleaned out, after a per-box listing confirms they are unused |
| D14 | Adding an existing Keycloak user to a workspace creates a `pending` binding that they must accept |
| D15 | `tenant-groups/_ensure` is deleted. It has no caller, and §4 does not use Organization-group roles |

## 3. Account model

- **Staff:** one kind, the **linked** account. HRMS creates the employee, then the BFF binds the person to that DIGIT uuid. PGR scoping requires the HRMS record (`PolicyDrivenScopeResolver.java:155`).
- **Founders:** PGR creates the founder through HRMS, then binds via the workload primitive (§5).
- **Citizens:** one CITIZEN account per root tenant, found by verified phone. It has a `digit.accounts` entry, which is its D12 profile source, but it is not bound through the staff binding routes.
- **Binding key:** `(keycloakSubject, DIGIT account tenant) → DIGIT uuid`. There is no surface in the key, so one binding serves the configurator and the employee surface.
- **Binding states and rules:**
  - states: `pending` → `active` → `removed`;
  - one DIGIT uuid belongs to at most one person, checked under a Redis lock on the uuid;
  - **browser** callers can't bind themselves, and can't bind someone to an account holding a role the caller lacks at that tenant;
  - the **workload** caller (PGR founder binding) is trusted and skips the actor rules.
- **Identity-side predicate (used in discovery, `_select` and revocation):**
  - staff: the Keycloak user is enabled, has an `active` binding at the tenant, and has Organization membership there;
  - citizen: the Keycloak user is enabled and holds a verified phone.
- **Transition until the clean-out (D13):** the D5 check and `_select` resolve the caller's DIGIT account as **binding, else managed `kcbff-`**, as `_select` does today. Item 14 removes the managed branch.

## 4. Sync module

| Fact | Direction | Keycloak representation | Trigger |
|---|---|---|---|
| Roles, employment status | DIGIT→KC | Admin-only attribute `digit.accounts` (versioned JSON): one entry per binding or citizen account `{tenantId, uuid, kind, boundAt, roles:[{code, tenantId}], active}`. Staff entries also carry `credential:{keyVersion}`. `boundAt` gives D12 its ordering | `_select`, reconcile |
| Descriptive profile (name, locale) | DIGIT→KC | `firstName`/`lastName`/`locale` from the D12 primary entry. User-read-only in the realm | Same |
| Verified phone (citizen), verified email (staff) | KC→DIGIT | — | `_select`, phone change, and Keycloak events for Keycloak-side changes only (email verified, IdP-linked phone) |
| Keycloak enabled, membership, binding | not written to DIGIT | — | Events + reconcile → revoke |

Rules:
- **Reconcile mirrors, revokes, and retries identifier propagation.** It never creates or restores a membership or binding.
- **The Keycloak writer:**
  - reads the user fresh immediately before each PUT;
  - sends `attributes` plus the mirrored name and locale, and **preserves** the freshly read `email`, `emailVerified`, `username` and other profile fields, because a Keycloak PUT that omits writable profile fields can erase them (`organization-service.ts:237-248`);
  - never sends `enabled`, and never derives email from DIGIT;
  - runs under a per-subject Redis lease.

  Echo suppression ignores only admin events whose `authDetails.clientId` is the BFF service account **and** which touch only mirrored fields. A residual race with Keycloak administrators editing the same user at the same moment is documented.
- **The DIGIT writer** is used only for identifier propagation and credential setup and repair. It does read-modify-write with an explicit field map from the response to the request:
  - DOB `yyyy-MM-dd` → `dd/MM/yyyy`;
  - the write is skipped if any required field comes back masked;
  - a concurrent HRMS edit landing in that instant can be overwritten; this residual race is documented.
- **Reconcile capacity:** cursor batches, bounded concurrency, a renewed lease, skipping unchanged entries, a lag metric, and inactive accounts read explicitly.

## 5. Onboarding primitives for PGR (D2)

These are internal. PGR holds the existing two tokens: introspection for reads, control-plane for writes.

| Primitive | Contract |
|---|---|
| `sessions/_introspect` | Who the founder is (before `IDENTITY_READY` only) |
| `identifiers/_check` (batched) | Advisory check that an alias is free |
**Attempt ordering:**
- Every workload mutation carries `{operationId, restartNo}`. `restartNo` is a counter PGR keeps on the operation row. It starts at 0 and goes up **only** when a terminal resubmission is authorized; ordinary retries keep it.
- The PGR `attempt` column is not used for this, because ordinary retries bump it too (`OnboardingRepository.java:142-144,169-171`).
- All primitives for one operation run under one Redis lock keyed by operationId. **Validation and mutation both happen inside the lock.** A `restartNo` lower than the stored one gets 409 `ATTEMPT_STALE`.

| Primitive | Contract |
|---|---|
| `organizations/_ensure {operationId, restartNo, tenantId, slug, name, rootTenantId}` | Also takes Redis locks on the slug and the tenantId, which keeps both unique. Stores `digit.operationId`, `digit.restartNo` and `digit.operationHash`. The hash is over canonical JSON of the normalized fields: lower-cased slug, trimmed name, `tenantId`, `rootTenantId`.<br>• Same operationId, same restartNo, same hash → returns the existing Organization.<br>• Same restartNo, different hash → 409.<br>• **Higher** restartNo on this operation's Organization in `PROVISIONING` or `FAILED` → re-stamps every field and returns to `PROVISIONING`. The match is on `digit.operationId`, not the slug. If the slug changed, a new Organization is created and the old one is set to `FAILED`.<br>• Lower restartNo → `ATTEMPT_STALE`.<br>• Another operation holding the slug or tenantId → 409 |
| `organizations/_lifecycle {operationId, restartNo, state}` | `PROVISIONING → ACTIVE` or `FAILED`, for the current restartNo only. Repeating the recorded transition returns success. A conflicting transition or a stale restartNo gets 409 |
| `memberships/_ensure {operationId, restartNo, subject, tenantId}` | Organization membership only. Idempotent |
| `memberships/_remove {operationId, restartNo, subject, tenantId}` | Removes a previous founder's membership and binding when a restart has a different founder. Idempotent if already absent |
| `bindings/_ensure {operationId, restartNo, subject, tenantId, digitUuid}` | Founder binding, `active` at once. Skips the actor rules; uuid uniqueness still applies. Same key with a different uuid → 409 `BINDING_CONFLICT`. PGR searches HRMS for the founder before `_create`, so a retry reuses the same uuid |

**Visibility:** routing, discovery and `_select` show only `ACTIVE` Organizations. **Absent lifecycle = `ACTIVE`**, so existing tenants are unaffected.

**Configurator routes (session-authenticated, live DIGIT `ACCOUNT_ADMIN`):**
- **`POST /identity/v1/workspace-members/_link {tenantId, digitUuid, email}`:**
  1. Find or create the Keycloak user by email.
  2. **New user:** add Organization membership, create an `active` binding, and send the password-setup email using the existing activation machinery (`organization-service.ts:1176,1198`). Keycloak's required actions block any session until the password is set.
  3. **Existing user:** create a `pending` binding with an `invitationVersion`. Membership is granted only at accept.
  4. **Resumable:** the user-creation request itself writes `digit.linkPending = {tenantId, digitUuid, email, requestId}`, using the existing create-with-attributes call (`organization-service.ts:1176-1186`).
     - Repeating that **same** request resumes it, still on the new-user branch, and clears the marker when done.
     - An invite from any **other** workspace takes the existing-user branch.
     - A repeat never demotes an `active` binding and never resurrects a removed one; a removal leaves a tombstone.
     - An explicit re-invite issues a new `invitationVersion` and invalidates the old one.
- **`GET /identity/v1/session`** returns `pendingInvitations`. No workspace needs to be selected.
- **Invitees are never pulled into onboarding.** Owning a tenant and belonging to one are independent. The configurator decides where to send a signed-in person in this order:
  1. workspaces they are a member of (active binding + membership) → that workspace;
  2. pending invitations → the accept screen;
  3. their own signup draft or operation → onboarding status;
  4. **only if none of these exist** → the signup wizard.

  A new invitee who sets their password from the email lands directly in the inviting workspace (configurator) or its inbox (employee).
- **`POST /identity/v1/workspace-invitations/_accept {tenantId, invitationVersion}`:**
  - bound to the authenticated subject;
  - grants membership and turns the binding `active`;
  - a removed or replaced invitation gets 409 `INVITATION_STALE`.
- **`GET /identity/v1/workspace-members?tenantId`** and **`POST .../workspace-members/_remove`**. Remove works on `active` **and** `pending` bindings: binding `removed`, the uuid reservation released, membership removed, tokens revoked. These replace the account-link list/unlink routes, which are kept as internal compatibility aliases until item 14.

**Deleted:**
- `role-assignments/_ensure`;
- the role projection in `memberships/_ensure`;
- `organization-members/_invite`, after `_link`/`_accept` and their configurator consumers are deployed on every box;
- `tenant-groups/_ensure`;
- the onboarding worker, tenant-foundation and the provisioner credential.

**PGR owns:**
- **Onboarding step order:** tenant foundation → `PLATFORM_BASELINE` → founder via HRMS → `organizations/_ensure` → `memberships/_ensure` → `bindings/_ensure` → `_lifecycle ACTIVE`.
- **Per-record progress and lease fencing.**
- **`restartNo`** (above).
- **Lifecycle publication:** PGR records its decision on the operation row with the publication still pending, then replays `_lifecycle` until the BFF acknowledges it. A terminal restart waits until the previous publication is settled. `FAILED` is published only for terminal abandonment, never for a retryable failure.
- **Readiness:** served from the workspace row (#2103).
- **Seed:** MCP `tenant_bootstrap` uses the same seed.
- **Baseline prerequisite:** the baseline must hold everything HRMS `_create` needs for the founder (department, designation, root boundary). This is validated on a fresh baseline.

## 6. Token issuance and revocation

- **Staff credential:** derived, never stored.
  - **Encoding:** `password = encode_v1(HMAC(key[keyVersion], "v1" ‖ uuid ‖ tenantId))`, where `encode_v1` produces 15 characters: one each from upper, lower, digit and `@#$%`, the rest from their union, all driven by HMAC bytes. This uses the same alphabets as today's `oneTimePassword` (`managed-account-service.ts:225-240`) and satisfies egov-user's policy (8–15 characters, all four classes).
  - **Setting it:** at binding, and at first issuance for links created before this change, the DIGIT writer sets it and records `credential.keyVersion` on the account's `digit.accounts` entry.
  - **Crash safety:** the value is deterministic, so re-running is idempotent.
  - **Login-failure parsing:** the egov-user adapter must keep the OAuth error body. Today it is discarded (`digit-user-client.ts:74-89`, including the early-401 branch). The adapter maps `error_description` to a typed outcome: invalid credentials, locked or inactive (`CustomAuthenticationProvider.java:122-147`). Anything unknown or malformed counts as a dependency error.
  - **Repair:**
    - at most once per lease, and only on the typed "invalid credentials" outcome;
    - never when the account is locked or inactive; these map to stable codes `ACCOUNT_LOCKED` and `ACCOUNT_INACTIVE`;
    - never on dependency errors.
  - **Key rollover:** a new `keyVersion` is adopted lazily at the next issuance.
- **Citizen issuance:** the egov-otp-backed citizen grant, unchanged. Its real, non-fixed OTP run is a gate item (§11, O2).
- **Ordering:** `_select` takes the same per-subject Redis lease that revocation takes. Inside it, it:
  1. **re-reads the requesting session** and compares the subject's revocation generation with the one stored on that session record. Logout-all and credential change increment the generation, which is a Redis counter;
  2. checks the §3 predicate and DIGIT `active`;
  3. returns the cached token or mints a new one, and records it.

  A revocation either finishes before step 1, or waits and revokes the newly recorded token. Session saves and touches are **update-only** (Redis `SET … XX`; today they always overwrite, `session-store.ts:272-277,312-314`), so a session that revocation deleted is never recreated. If the lease is lost mid-mint, the mint result is revoked rather than returned.
- **Cache validity:**
  - reconcile revokes the cached token of any account whose DIGIT roles changed, because the token's stored principal still carries the old roles;
  - `_select` validates a cached token cheaply against egov-user before returning it. An invalid token is evicted and a new one minted; a dependency failure is not treated as invalid.
- **Changing your own password (decided 2026-10-03):** when the person changes their password through `/authorize?action=UPDATE_PASSWORD`, the BFF records the initiating session in Redis with a short TTL. When the matching credential-change event arrives, every **other** session and token for that person is revoked, and the initiating session stays signed in. A credential change with no matching record (an admin reset, or a change made outside the BFF) revokes everything.
- **Token inventory:** kept in Redis until the token's **actual** expiry, separate from the refresh-skew window.
- **Revocation:**
  - for every inventoried token, egov-user logout, then the BFF sessions end;
  - **if the inventory is missing** (Redis loss, or a crash between mint and record), the BFF signs in with the derived credential, which returns the account's live token, and logs that token out. It may repair the credential once to do so. This works only for **grant-eligible** staff accounts (active, not locked) whose mapping survives. Key versions are retained until no account uses them. The BFF never reactivates an account in order to revoke it;
  - failed revocations go on a Redis retry set, kept until success or expiry.
- **Keycloak event poller:**
  - polls user and admin events in overlapping time windows, pages through them, and dedupes by `(time, id)`;
  - advances its Redis checkpoint only after each effect, or its retry job, is recorded;
  - reacts to disable, delete, logout-all, credential change and membership removal by revoking;
  - if the checkpoint falls outside retention, revokes conservatively for every affected subject, because current state can't reconstruct a missed logout-all;
  - `/readyz` reports poller lag.
- **Documented limits:**
  - tokens issued outside the BFF before binding live until they expire;
  - while the BFF is down, revocation pauses;
  - these tokens can't be found once Redis is lost, and live until they expire:
    - citizen tokens (citizens have no derived credential);
    - tokens of DIGIT-inactive or locked staff accounts (they can't sign in, and deactivating does not purge their tokens);
    - tokens of a Keycloak user that is deleted in the same window as the Redis loss.

## 7. DIGIT3 migration (planned reopen)

This is a one-time, versioned migration.
- **Prerequisite:** the `digit.accounts` mirror is complete, with no drift.
- **Steps:** stop the old writers → drain → compare inventories → reshape into the DIGIT3 grant model → switch authority under a migration epoch → invalidate sessions.
- **Rollback:** defined before cut-over.
- **Blocked on:** the DIGIT3 identity and role design.

## 8. Citizens and self-service

- **Citizen OTP:** the BFF owns phone possession: generating, hashing, rate-limiting and checking codes. Delivery goes through one `HttpOtpSender` contract:
  - the BFF POSTs `{phone, code, purpose, tenantId, locale, expiresIn}` to one configured URL (`IDENTITY_CITIZEN_OTP_SENDER=http` plus its URL), and expects a fixed set of response codes;
  - the service at that URL (novu-bridge, #2203) picks the provider, template and per-tenant settings, and sends the SMS or WhatsApp;
  - so a new provider or channel is a novu-bridge change, never a BFF change;
  - `log` stays as the dev-box sender.
- **Usernames for phone identities:**
  - new phone identities get an **opaque** username;
  - existing `phone-hash` usernames are left as they are;
  - lookup and ownership always follow the current verified phone attribute, so a released number can be claimed by someone else (`organization-service.ts:1059-1093`).
- **Phone login, step-up and change all take one Redis lock per normalized phone.**
  - Anonymous sign-in challenges are bound to the challenge and the phone.
  - Step-up and change challenges are bound to the subject, the session, the purpose and the new number.
  - Step-up returns 409 if another person owns the phone.
  - Change keeps every citizen account's uuid. It updates Keycloak, then each citizen account across the person's roots, from the current Keycloak value. Reconcile retries any failure. Sessions carrying the old number are invalidated.
- **Legacy citizens:** they are resolved in this order: existing link, then managed account, then a legacy CITIZEN search by the verified phone. An ambiguous match fails closed with `CITIZEN_ACCOUNT_AMBIGUOUS` (`account-links.ts:190-237`, `citizen-registration.ts:148-164`). Admins resolve it through the **retained** internal citizen link, unlink and list routes. Keycloak phone uniqueness does not make DIGIT citizen records globally unique.
- **People with a Keycloak credential:** self-service actions are Keycloak required actions, started by `/authorize?action=`, allowlisted per client attribute `digit.auth.account.actions` and pinned to the person who started them. `GET /session` lists them.

  The frozen supported set is `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `delete_credential`, `UPDATE_EMAIL` and `idp_link` (link Google or another provider). Each one's availability on Keycloak 26.7.3 is verified as a gate item.
  - **Parameters:** `GET /session` also returns credential metadata `[{id, type, label}]` and linked providers `[{alias}]`. `delete_credential` takes the credential id, and `idp_link` takes the provider alias.
  - **Unlinking a provider:** `POST /identity/v1/account/providers/_unlink {alias}` (session-authenticated, the person's own account only).
  - **Last-method protection:**
    - only **primary** sign-in methods count: a password, a linked provider, and the phone for citizens; TOTP does not count;
    - `delete_credential` is offered only for second-factor credentials (TOTP, WebAuthn), so it can never remove a primary method;
    - provider unlinking runs under the per-subject lease against a fresh read of the person's primary methods, so two concurrent removals can't both pass.
  - **Cancellation and errors:** a cancelled or failed action returns to `returnTo` with a stable `code`. Profile actions that would edit DIGIT-mirrored fields are excluded, and #2208 is rescoped to match.
- **Phone-only citizens:** they edit their profile in DIGIT and change their phone through the BFF.
- **My signed-in sessions (all personas):**
  - `GET /session` returns `sessions[]`: surface, created and last seen, and the current one marked;
  - `POST /identity/v1/logout {scope: "current" | "others" | "all"}` signs out this session, every other one, or everything, and revokes the matching DIGIT tokens;
  - for people with a Keycloak credential, "others" and "all" also end their Keycloak sessions.
- **Keycloak account console:** hidden.

## 9. Where future changes land

| Future change | Lands in | Holds within |
|---|---|---|
| New identity provider | Realm config + client attribute | Same claims and linking rules |
| Keycloak-hosted authenticator | Realm config + declared `hosted` method | Hosted entirely in Keycloak |
| New browser surface | Surface registry + Keycloak client | An existing context kind |
| Staff SSO policy | Keycloak flow per client | — |
| New DIGIT role | MDMS roles + role-actions; mirrored automatically | — |
| New OTP channel | Sender endpoint | Same send contract |
| New self-service action | Realm required action + `digit.auth.account.actions` + theme | A person with a Keycloak credential |
| New descriptive profile field | DIGIT UI | DIGIT-owned field |
| New signup field, country or onboarding step | Configurator + PGR + seed | Not an identity-proof change |
| New login-page string | Theme + localization | — |

Anything outside "holds within" is a new identity capability and a legitimate reopen.

## 10. BFF work list

**Modules (as organization guidance, not a mandatory rewrite):**
- `authentication`
- `sessions`
- `access-context`
- `citizen-otp`
- `bindings`
- `accounts`
- `sync`
- `revocation`
- `control-plane`
- `operations`

**No big-bang refactor.** The large files (`organization-service.ts`, 1,581 lines, and `managed-account-service.ts`) are not reorganized up front. When a work item has to change Keycloak or egov-user client code, that code moves into a small client file (e.g. `keycloak/users.ts`, `digit/egov-user.ts`) as part of the same change.

| # | Item | Size |
|---|---|---|
| 0 | Freeze, **before** items 7–13: route, state and error schemas (`docs/identity-bff.md`); the `digit.accounts` v1 shape (staff-only `credential`, `boundAt`); the `encode_v1` test vectors; the canonical payload hash; the `restartNo` contract; the event id and representation probe | S |
| 1 | Surface registry; remove the `prompt=login` literal | M |
| 2 | Declared `hosted` method; `oauth`→`idp`; codes, not copy; citizen methods return `[]`, not 503 | S |
| 3 | `HttpOtpSender` | S |
| 4 | `action` passthrough with parameters; `account.actions`, credential metadata, linked providers and `sessions[]` in `/session`; provider `_unlink`; last-method protection; `logout {scope}` (§8) | M |
| 5 | Password-setup email `client_id` per surface (unblocks #2191) | S |
| 6 | Stable error `code`s on `_select`, `callback`, `auth-results`, including `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `INVITATION_STALE`, `PENDING_INVITATION` | S |
| 7 | Derived staff credential (§6) with typed login-failure parsing, the safe DIGIT writer and the `digit.accounts` metadata it needs; delete per-login rotation | M |
| 8 | Bindings (§3): key, states, rules, uuid lock, D10 predicate everywhere, binding-else-managed resolution until D13 | M |
| 9 | D5 live `ACCOUNT_ADMIN` check; `_link`, `_accept`, member list and remove; `pendingInvitations` in `/session` | M |
| 10 | Revocation (§6): shared lease with session re-read; revocation generation on the session record; update-only session writes; inventory to actual expiry; cached-token validation; role-change revocation; derived-credential fallback; retry set; event poller; self-password-change exemption; the minimal enabled/membership/role revocation sweep | M |
| 11 | Onboarding primitives (§5): operation lock, `restartNo` and `ATTEMPT_STALE`, slug and tenant locks, canonical hash, re-open from `PROVISIONING` or `FAILED`, idempotent lifecycle, visibility rule, `memberships/_remove`, `BINDING_CONFLICT` | M |
| 12 | Sync module (§4) | M |
| 13 | Phone lock, opaque usernames for new identities, challenge binding, step-up, change | M |
| 14 | Delete: worker, tenant-foundation, `_invite`, role projection, role `_ensure`, allowlist, provisioner env, managed-`kcbff-` path, branding relay, `tenant-groups/_ensure`, permanent backfill route, the **staff** account-link compatibility aliases. The internal citizen link, unlink and list routes stay (§8) | M |
| 15 | Fixes: session kept on a Keycloak blip; citizen phone memo drift; remove the `admin/admin` fallback; `/readyz` (Redis, JWKS, Keycloak admin token, each surface's catalogue, DIGIT reachability, poller lag); `Cache-Control` on `tenant-contexts`; perf (callback discovery, `syncSubject` full scan, `/tenants` probe) | M |
| 16 | In-flight PR fixes (#2190, #2201, #2206), excluding code that item 14 deletes | M |
| 17 | Final docs: `docs/identity-bff.md` + `architecture.md` as the frozen contract | S |
| 18 | **Test migration:** the 33 specs in `tests/integration-tests` that sign in through legacy flows (the `auth.setup`/`api.setup` fixtures, `utils/auth`, `citizen-login`, `citizen-otp-login`, `admin/login`, `keycloak/kc-*` and others), and `backend/identity-bff/tests`, move onto the BFF flows: employee `/authorize`→`_select`, citizen OTP→`_select`. Afterwards the spec count and pass rate must be ≥ today's | M |

## 11. Completion gate (executed tests)

**Contract:** a test per frozen route asserting its schema and error codes.

**Normal paths:**
- each persona (configurator founder, configurator admin, employee, Keycloak citizen, phone-only citizen) through sign-in, `_select`, self-service and logout;
- an admin creates an employee in the configurator, and that employee signs in **and lands in the inviting workspace, never the signup wizard**;
- an existing user accepts an invite;
- a person lists their sessions, signs out others, and signs out everywhere.

**Existing coverage:** the migrated legacy-flow specs (item 18) pass, with a spec count no lower than before.

**Failure and recovery:**
- concurrent HRMS edit during a mirror pass, and during credential setup;
- Keycloak disable, delete or logout-all, and membership removal → revoked; re-enabling restores access with no DIGIT write;
- **Keycloak disable, logout-all and credential change during `_select` and during session refresh**;
- a token revoked externally while still cached; a DIGIT role change revokes the cached token;
- mirror writes preserve email, `emailVerified` and username (real Keycloak);
- revocation with Redis inventory lost: grant-eligible staff are revoked; inactive or locked staff, and a deleted mapping, follow the documented limit;
- a crash between mint and record;
- event checkpoint outside retention; duplicate and out-of-order events; an admin disabling the user during a mirror pass (`enabled` never re-sent);
- the derived credential passes egov-user validation; out-of-band password change → one repair; a locked account → no repair, `ACCOUNT_LOCKED`;
- binding rules: self-bind, escalation, a uuid racing two binds;
- a stale or removed invitation; removing a `pending` binding releases the uuid;
- `_link` crashing between user creation, membership, binding and email → a repeat resumes;
- a person created by an unfinished link to workspace A is invited to workspace B → existing-user branch; remove, then re-invite → the old acceptance is rejected;
- D5: role removed mid-session; cross-tenant admin denied;
- slug race; tenantId race; the same restartNo with a different payload;
- repeated `ACTIVE`; delayed `_ensure`, `_lifecycle`, `memberships/_ensure` and `bindings/_ensure` from a lower restartNo → `ATTEMPT_STALE`, including after the newer restart itself failed;
- PGR's real resubmit endpoint re-opening a `FAILED` Organization after the founder was bound, with the same founder and with a different one (`memberships/_remove`), and with a changed slug;
- a retried founder with a different uuid → `BINDING_CONFLICT`;
- a PGR crash just before and just after persisting its decision, before the lifecycle acknowledgement, and during a terminal resubmission → the Organization ends `ACTIVE` or `FAILED`, never stuck in `PROVISIONING`;
- an existing Organization without a lifecycle attribute stays visible;
- a PGR crash at every onboarding boundary;
- two subjects claiming one phone; a phone change across multiple roots; an old session racing the change; one person changes A→B, then another person verifies A;
- TOTP enrolment, **then enforcement at the next employee sign-in**; removing a second-factor credential; unlinking a provider; two concurrent provider unlinks against last-method protection;
- a self-service password change keeps the initiating session and signs out the others; an admin password reset signs out everything;
- a legacy citizen with an ambiguous phone match → `CITIZEN_ACCOUNT_AMBIGUOUS`, then resolved by an admin through the citizen link route; unlink blocking;
- a cached token revoked outside the BFF → detected at `_select` and a new one minted; an egov-user outage is not treated as an invalid token;
- real Keycloak representations of membership-removal and logout-all events; a retention-gap recovery covering every recoverable subject;
- existing admin-linked employees still sign in after the D10 backfill;
- BFF stopped → signed-in users keep working until expiry (needs the digit-ui slug cache);
- every §9 row exercised as a config-only change;
- each §8 self-service action works on Keycloak 26.7.3.

**Real dependencies:** at least one suite runs against real Keycloak, Redis, egov-user and egov-otp, including a **real non-fixed citizen OTP mint**. That run is a prerequisite for declaring §0 complete; the owner decides when it happens (O2).

## 12. Outside the BFF (our apps and config only)

- **PGR onboarding:**
  - port of the onboarding steps, seed, founder via HRMS (validated on a fresh baseline), readiness;
  - #2169 rescoped to PGR, #2103.
- **Configurator:**
  - staff create = HRMS `_create` + `_link`;
  - pending-invite accept screen;
  - member list and remove;
  - an account menu: password, TOTP, remove second factor, link and unlink a provider (from `/session` metadata);
  - Logout calls `/identity/v1/logout`;
  - delete `tenantBootstrap.ts`;
  - routing order for signed-in people (§5): memberships → pending invitations → own draft → signup wizard;
  - **signup code and slug derivation fix** (`api/onboarding.ts:587-623`, `SignupPage.tsx:296-306,395-400`):
    - today the account code (which becomes the tenant id) is the country plus the initials of the first three words;
    - both fields stop updating once "touched", and resuming a draft marks them touched;
    - the fix: re-derive while the user hasn't typed in the field (a separate user-edited flag), and derive from more than initials, with a collision suffix.
- **digit-ui:**
  - slug→context cache in `tenantRoute.js`;
  - drop the direct `/user/_logout` call;
  - identifiers read-only on the profile page;
  - an account menu for staff (same as the configurator's) and a "change phone number" flow for citizens;
  - remove Change Password;
  - delete the dead Keycloak adapter;
  - delete the legacy login screens after #2072.
- **Keycloak config:**
  - move the realm script, themes and the magic-link image to the top-level `keycloak/` with its own CI;
  - declarative realm;
  - event store: `eventsEnabled` + `adminEventsEnabled`, types including LOGOUT, UPDATE_PASSWORD and UPDATE_CREDENTIAL, retention longer than the longest tolerated BFF outage;
  - name fields read-only;
  - a conditional OTP step in the employee flow, so a person who enrolled TOTP must use it (today the flow is username and password only, `configure-keycloak.sh:209-213`);
  - the theme reads branding directly from public MDMS.
- **Runtime config:** correct `EGOV_OTP_HOST` so egov-user's OTP URL resolves. This is login functionality, needed for O2.
- **Ops one-time jobs:**
  - (a) ensure Organization membership for every existing `active` binding, run on **every** box (8c, naipepea, bomet, moz), before D10 is enforced;
  - (b) list `kcbff-` managed employees per box, then clean them out (D13);
  - (c) tenant-route backfill.
- **Deployment hardening:** tracked separately.

## 13. Sequencing

1. Item 0 (schemas, test vectors, hash fields). Provision the credential HMAC key in deploy config. Land the in-flight PRs (#16, #5, #6), skipping fixes to code that item 14 deletes.
2. Keycloak config: event store and retention, read-only name fields, employee conditional OTP. The theme reads branding directly.
3. Ops job (a) → item 7 → item 8 → item 9 → item 10, which includes reconcile-based revocation.
4. Configurator consumers: HRMS→`_link`, the accept screen, member list and remove. digit-ui slug cache and logout. These are **deployed on every box** before anything they replace is deleted.
5. Item 11 → PGR port, with `restartNo`, lifecycle publication and founder via HRMS validated on a fresh baseline, **deployed on every box** → ops jobs (b) and (c) → item 14 deletions.
6. Item 12 (sync), item 13 (phone), items 1–4, item 15, item 17. Account-menu and phone-change consumers in our apps. Item 18 (test migration) runs alongside steps 3–6, and each legacy spec moves when its flow lands.
7. Run the §11 gate.

## 14. Open items

- **O1:** `SUPERUSER` for founders. Revisit after checking that every workspace-setup write is granted to `ACCOUNT_ADMIN`, `MDMS_ADMIN`, `LOC_ADMIN` or `GRO`.
- **O2:** the real non-fixed citizen OTP mint (gate item; timing set by the owner).
- **O3:** the DIGIT3 identity and role design (blocks §7 only).
