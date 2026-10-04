# Identity BFF: service boundary and completion plan

**Revision:** 7.1 (2026-10-04). Revision 7 plus the remaining walkthrough decisions (D25–D26). Revision 7 was revision 6.1 plus:
- the owner's decisions on the PR #36 comments (`08-decisions-2026-10-04.md`);
- two checks: the legacy citizen default name, and where tenant names are stored.

The review loop closed at revision 6. Revisions 4 and 5 were each reviewed by Astra and Fable, and all four verdicts were "ready with changes". Further detail is left to implementation and the §11 gate.

## 0. What "done" means

"Never push BFF code again for this category of work" is a test of **completeness**, not a ban on code changes. The BFF is done when:
- it offers a **stable API contract for the system as it is today**: login, signup, onboarding identity steps, profile, sign-in method management and Keycloak↔DIGIT sync;
- it is low-complexity and modular;
- every path has executed test coverage (§11);
- all of this sits inside `backend/identity-bff`.

**Principles:**
- **Minimal disruption.** Keep existing behaviour wherever the new design doesn't need to change it.
- **Forward-only.** BFF-created `kcbff-` and `kcbffc-` accounts never reached production; they are deleted, not migrated, and the rules only need to be right going forward.
- **No sub-tenants.** Every tenant is a plain id, with no `tenant.city` children. Any exception is handled by hand.
- **One phone rule per deployment.** Cross-country phone numbers are not served.

**Constraints:**
- No changes to any egov service.
- Storage stays in Keycloak attributes plus Redis. Every Redis key family must be one of:
  - **re-derivable:** rebuilt from Keycloak or DIGIT;
  - **restartable:** losing it only means someone signs in again, resends an OTP or resubmits onboarding; leases simply expire;
  - **documented limit:** some tokens can't be revoked once their inventory is lost, and live until they expire (§6).
- DIGIT3 is a planned reopen (§7).
- **Test coverage never drops.** The legacy-flow integration and e2e specs are migrated onto the BFF flows (item 18). No spec is removed without a replacement.
- **Legacy native password paths** (direct egov-user calls, the old change and forgot password screens, the password HRMS sends by SMS) are **tracked separately**. They do not block D10.

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
| My signed-in sessions | Show my sessions; sign out this one, the others, or everywhere | §8 |
| Edit my profile | Phone (citizens) and email (staff) through the BFF or Keycloak. Descriptive fields (name, photo, gender…) are edited in DIGIT (profile, HRMS) and mirrored | §4, §8 |
| My credentials and providers | Password, TOTP, remove a second factor, link or unlink Google and similar, with last-method protection | §8 |
| Workspace members | Admins link, invite, list and remove staff; invitees accept | §5 |
| DIGIT writes with its own admin credential | Exactly three: set or repair a staff account's derived credential; write verified identifiers through (phone, email); log out and revoke tokens. It never writes roles, `active`, account locks, HR data or MDMS | §4, §6 |
| Sync | Mirror DIGIT roles, status, name and the tenant name into Keycloak; write Keycloak identifiers into DIGIT | §4, `07-sync-matrix.md` |
| Revocation | React to Keycloak events, reconcile, HRMS deactivation and logout | §6 |
| Onboarding primitives | Identity steps that PGR calls during tenant creation | §5 |

| Owner | Owns |
|---|---|
| **Keycloak** | Credentials, identity providers, MFA, sign-in flows, the person record, Organization membership |
| **BFF** | Browser sessions; tenant binding; account bindings; token issuance and revocation; citizen phone OTP; the DIGIT→Keycloak mirror; Keycloak→DIGIT login identifiers |
| **DIGIT** (egov-user, HRMS, MDMS) | Roles, employment status, descriptive profile, the tenant's name, everything a token is allowed to do |
| **PGR onboarding** | The onboarding steps (§5) and their order, tenant foundation, platform baseline, readiness, retries |

**The BFF never:**
- writes MDMS, localisation, encryption keys or HRMS records;
- runs the onboarding steps (the ordered, resumable steps that create a tenant at signup, §5);
- holds a role catalogue;
- accepts a **person's** password (it does set the derived DIGIT credential of a bound staff account, §6);
- knows an SMS or WhatsApp provider;
- proxies DIGIT business calls;
- is called on a signed-in page load;
- writes DIGIT `active`, roles, `accountLocked` or `accountLockedDate`, and never unlocks an account;
- modifies realm configuration;
- uses session claims as a source for writes: every write comes from a fresh Keycloak read under the person's lease.

## 2. Decisions (final)

| # | Decision |
|---|---|
| D1 | DIGIT (egov-user roles, written by HRMS) is authoritative for roles, mirrored DIGIT→Keycloak. The Keycloak→DIGIT role projection, the allowlist and the role `_ensure` endpoints are deleted |
| D2 | Onboarding (worker, tenant foundation, PLATFORM_BASELINE) moves to PGR. The BFF exposes identity primitives (§5) |
| D3 | DIGIT is authoritative for the descriptive profile and the tenant name, mirrored DIGIT→Keycloak. Keycloak is authoritative for credentials and verified login identifiers, written Keycloak→DIGIT |
| D4 | Access = DIGIT `active` AND the identity-side predicate (§3). The BFF enforces it and never flips either side; reactivation happens on the side that deactivated |
| D5 | Organization-admin authority = the caller's **live DIGIT `ACCOUNT_ADMIN`** at that workspace's tenant. `TENANT_ADMIN` is retired. This needs code |
| D6 | No per-city citizen suspension. Blocking a citizen = disabling their Keycloak user |
| D7 | The sync is a BFF module with explicit projections |
| D8 | No egov service changes. Each box is checked for a stock egov-user image; the tables of the `feat/keycloak-identity-exchange` fork, if present, are ignored |
| D9 | Storage stays in Keycloak attributes + Redis |
| D10 | Staff sign-in requires an `active` binding AND live Organization membership |
| D11 | Founders keep `SUPERUSER` for now (O1) |
| D12 | The Keycloak profile comes from the person's oldest active **staff** binding, else their citizen account |
| D13 | Every existing `kcbff-` managed account is deleted, used or not (dev boxes only). No migration path |
| D14 | Adding an existing Keycloak user to a workspace creates a `pending` binding that they must accept. It expires after a per-tenant period (D22) |
| D15 | `tenant-groups/_ensure` is deleted |
| D16 | **No sub-tenants.** Bindings, membership, citizen accounts and role tenants all use the workspace's tenant id |
| D17 | **Names:**<br>• **staff:** set by the admin in HRMS, or by the employee in their profile; mirrored to Keycloak `firstName` (whole name), `lastName` empty. The founder's name comes from signup and is written into HRMS once<br>• **citizens:** their given name, or the national mobile number (no country code, no `+`) when none is given, matching legacy digit-ui<br>• a masked value (`****`) is never copied |
| D18 | **Email:** the Keycloak verified email is authoritative and reaches DIGIT only after verification. People change it themselves (verify the new address; the old one is notified), or an admin does when the old address is lost. Configurator employee screens send email changes to the BFF, never to HRMS. **An employee needs an email to be linked** |
| D19 | **Identity providers** use IMPORT mode: name and email are filled once at first sign-in and never overwritten. An IdP never sets a verified phone |
| D20 | **Person locale is not synced** in v1. Each system keeps its own; the tenant's languages come from onboarding |
| D21 | **Tenant name** (D3): MDMS `tenant.tenants.name` is the authority. Onboarding writes the same name to the Keycloak Organization, the localisation key `TENANT_TENANTS_<ID>` in every tenant language, and StateInfo. A rename updates MDMS and localisation on the DIGIT side, and the BFF mirrors it into the Organization |
| D22 | **Invitation expiry** is a per-tenant MDMS setting the owner edits in the configurator, between 1 hour and 90 days, defaulting to 14 days |
| D23 | **Removing a member** in the configurator = HRMS deactivate + BFF remove, as one action. Founder replacement does the same |
| D24 | **Rollout safety:** the flag `IDENTITY_STAFF_CREDENTIAL_MODE=rotate\|derived` is set per box, and `eg_user` + HRMS are snapshotted before the first rollout on each box |
| D25 | **Decided by design** (walkthrough README; any can be overridden):<br>• **A1** binding state in a `digit.bindings` attribute plus a searchable `digit.boundUuids` index<br>• **A2** one renewable lease per person; lock order: operation → tenant → slug → person → phone → uuid<br>• **A3** token inventory keyed by DIGIT account `(tenantId, uuid)`, plus a per-person index<br>• **A4** `_link` resume key = `sha256(admin, tenantId, uuid, normalized email)`<br>• **A5** `encode_v1` uses HKDF expansion and rejection sampling, with test vectors in item 0<br>• **A6** `organizations/_ensure` drops the separate root-tenant field (always equal to `tenantId`)<br>• **B2** invitees can accept from digit-ui as well as the configurator<br>• **B3** a self password change is matched by the Keycloak event's `sessionId` and `clientId`<br>• **B4** phone step-up and change use the existing `citizen/otp/_send\|_verify` with `purpose: signin \| stepup \| change_phone`<br>• **B5** the error envelope stays `{code, error}`; the existing `DIGIT_ACCOUNT_INACTIVE` name is kept<br>• **B6** PGR gets a dedicated onboarding token that can call only the §5 primitives<br>• **B7** the BFF never returns refresh tokens; the embedded dashboard calls `_select` again on expiry (checked in item 18)<br>• **B8** the founder's credential is set at their first `_select`, not inside the PGR call<br>• **B9** a signup's founder can't change (signups are owned per Keycloak person), so `memberships/_remove` is dropped<br>• **C1** one person may be both a citizen and staff; staff entries win for the profile<br>• **C3** escalation through HRMS role assignment is outside the BFF, and is noted for HRMS role-actions<br>• **C6** a phone-only citizen's tokens can't be revoked after Redis loss (D9 limit) |
| D26 | **Old paths go when identity is complete:** the tenantless legacy sign-in, digit-ui-v2's citizen login, the legacy native password paths and the legacy identity screens are removed **after** the §11 gate passes, as the final step (§13 step 8, #2072). They are not a precondition for the gate |

## 3. Account model

- **Staff:** one kind, the **linked** account. HRMS creates the employee at the workspace's tenant, then the BFF binds the person to that DIGIT uuid. PGR scoping requires the HRMS record (`PolicyDrivenScopeResolver.java:155`).
- **Founders:** PGR creates the founder through HRMS, then binds via the workload primitive (§5).
- **Citizens:** one CITIZEN account per tenant, found by verified phone. It has a `digit.accounts` entry but is not bound through the staff routes.
- **Binding key:** `(keycloakSubject, tenantId) → DIGIT uuid`. A binding's tenant must be the workspace's tenant (D16), and `_link` rejects anything else. The key has no surface, so one binding serves the configurator and the employee surface.
- **Binding states and rules:**
  - states: `pending` → `active` → `removed`; a pending binding past its expiry (D22) becomes `removed`;
  - one DIGIT uuid belongs to at most one person (Redis uuid lock plus a searchable `digit.boundUuids` attribute);
  - **browser** callers can't bind themselves, and can't bind someone to an account holding a role the caller lacks;
  - the **workload** caller (PGR founder binding) is trusted and skips the actor rules.
- **Identity-side predicate (used in discovery, `_select` and revocation):**
  - **staff:** the Keycloak user is enabled, has an `active` binding at the tenant, and is a member of that tenant's Organization;
  - **citizen:** the Keycloak user is enabled and holds a verified phone.
- **Inactive staff** still see the tenant in discovery, with `code: ACCOUNT_INACTIVE`, so they know why and an admin can reactivate them.
- **Transition until D13 runs:** the D5 check and `_select` resolve the caller as **binding, else managed `kcbff-`**. Item 14 removes the managed branch.
- **Not served for now (O4):** employees whose HRMS record sits at a city-level tenant.

## 4. Sync module

The field-by-field matrix (106 fields, four phases) is `07-sync-matrix.md`. Its rules, as decided:

| Fact | Owner → copy | Keycloak representation | When |
|---|---|---|---|
| Roles, employment status | DIGIT → KC | Admin-only attribute `digit.accounts` (versioned JSON), one entry per binding or citizen account: `{tenantId, uuid, kind, boundAt, roles:[{code, tenantId}], active}`. Staff entries also carry `credential:{keyVersion}` | Immediately on link, accept and remove; otherwise `_select` and reconcile |
| Name | DIGIT → KC (D17) | `firstName` = whole name, `lastName` = empty and not required. Taken from the D12 primary entry. User-read-only in the realm | Same |
| Email (staff) | KC (verified) → DIGIT (D18) | — | Email change, `VERIFY_EMAIL` and admin update events. Reconcile also **compares** and re-propagates on drift; it never clears the DIGIT email |
| Phone (citizens) | KC (verified) → DIGIT | — | Phone change; `_select` |
| Tenant name | MDMS → KC Organization `name` (D21) | — | Onboarding; reconcile on rename |
| Person locale | not synced (D20) | — | — |
| Keycloak enabled, membership, binding | not written to DIGIT | — | Events + reconcile → revoke |
| IdP-provided name and email | IdP → KC once (D19) | IMPORT mappers | First sign-in only |

Rules:
- **Reconcile** mirrors, revokes and retries identifier propagation. It never creates or restores a membership or binding. It skips unchanged accounts using a fingerprint of the last mirrored state (egov-user `lastModifiedDate` + the entry hash). HRMS-originated changes arrive within one reconcile interval (default 5 minutes), which `/readyz` reports.
- **A DIGIT account that disappears** (e.g. after a dev-box data reset) is marked `missing` on its entry, its tokens are revoked, and it shows in the member list. The binding is never silently deleted.
- **The Keycloak writer:**
  - reads the user fresh immediately before each PUT;
  - sends `attributes` plus the mirrored name, and **preserves** the freshly read `email`, `emailVerified`, `username` and other profile fields;
  - never sends `enabled`;
  - runs under the person's Redis lease.

  Echo suppression ignores only the BFF service account's own mirror-only writes.
- **The DIGIT writer** is used only for identifiers and the derived credential. It does read-modify-write with an explicit field map:
  - DOB `yyyy-MM-dd` → `dd/MM/yyyy`;
  - the write is skipped if a required field comes back masked;
  - a concurrent HRMS edit landing in that instant can be overwritten; this residual race is documented.

## 5. Onboarding primitives for PGR (D2)

These are internal. PGR uses a dedicated onboarding token (D25/B6) that can call only these primitives.

| Primitive | Contract |
|---|---|
| `sessions/_introspect` | Who the founder is, including `emailVerified` (before `IDENTITY_READY` only). PGR copies the founder's email into HRMS only when it is verified |
| `identifiers/_check` (batched) | Advisory check that an alias is free |

**Attempt ordering:**
- Every workload mutation carries `{operationId, restartNo}`. `restartNo` is a counter on the PGR operation row. It goes up **only** when a terminal resubmission is authorized; ordinary retries keep it.
- All primitives for one operation run under one Redis lock keyed by operationId, with validation and mutation both inside it.
- A lower `restartNo` gets 409 `ATTEMPT_STALE`.

| Primitive | Contract |
|---|---|
| `organizations/_ensure {operationId, restartNo, tenantId, slug, name}` | Takes Redis locks on the slug and the tenant id, which keeps both unique. Stores `digit.operationId`, `digit.restartNo` and `digit.operationHash` (over canonical, normalized fields).<br>• Same operationId, restartNo and hash → returns the existing Organization.<br>• Same restartNo, different hash → 409.<br>• Higher restartNo on this operation's Organization in `PROVISIONING` or `FAILED` → re-stamps it and returns it to `PROVISIONING`. A changed slug creates a new Organization and marks the old one `FAILED`.<br>• Another operation holding the slug or tenant id → 409 |
| `organizations/_lifecycle {operationId, restartNo, state}` | `PROVISIONING → ACTIVE` or `FAILED`, for the current restartNo only. Repeating the recorded transition returns success |
| `memberships/_ensure {operationId, restartNo, subject, tenantId}` | Organization membership only. Idempotent |
| `bindings/_ensure {operationId, restartNo, subject, tenantId, digitUuid}` | Founder binding, `active` at once. Uuid uniqueness applies. Same key with a different uuid → 409 `BINDING_CONFLICT`. PGR searches HRMS for the founder before `_create` |

**Visibility:** routing, discovery and `_select` show only `ACTIVE` Organizations. **Absent lifecycle = `ACTIVE`**. Disabling an Organization, or marking it `FAILED`, revokes its members' tokens, and so does deactivating the tenant in MDMS.

**Configurator routes (session-authenticated, live DIGIT `ACCOUNT_ADMIN` at the tenant):**
- **`POST /identity/v1/workspace-members/_link {tenantId, digitUuid, email}`.** `email` is required (D18).
  1. Find or create the Keycloak user by email (also matching the username, so a person whose email has changed isn't duplicated; the mismatch case returns `IDENTITY_EMAIL_CHANGED`).
  2. **New user:** membership, an `active` binding, and the password-setup email. Keycloak blocks any session until the password is set.
  3. **Existing user:** a `pending` binding with an `invitationVersion` and an expiry (D22). Membership is granted only at accept.
  4. **Resumable:** the user-creation request writes `digit.linkPending = {tenantId, digitUuid, email, requestId}`. Only that same request resumes on the new-user branch; invites from other workspaces take the existing-user branch. A repeat never demotes an `active` binding or resurrects a removed one. An explicit re-invite issues a new `invitationVersion`.
  5. The new entry is mirrored at once (§4).
- **`GET /identity/v1/session`** returns `pendingInvitations`.
- **Invitees are never pulled into onboarding.** The configurator sends a signed-in person to:
  1. workspaces they belong to;
  2. otherwise, pending invitations;
  3. otherwise, their own signup draft or operation;
  4. and only if none of these exist, the signup wizard.
- **`POST /identity/v1/workspace-invitations/_accept {tenantId, invitationVersion}`:**
  - bound to the authenticated subject;
  - grants membership and turns the binding `active`;
  - a removed, replaced or expired invitation gets 409 `INVITATION_STALE`.
- **`GET /identity/v1/workspace-members?tenantId`** and **`POST .../workspace-members/_remove`.** Remove works on `active` and `pending` bindings: the binding becomes `removed`, the uuid is released, membership is removed and tokens are revoked. The configurator calls it right after the HRMS deactivation (D23).

**Deleted:**
- `role-assignments/_ensure`;
- the role projection in `memberships/_ensure`;
- `organization-members/_invite`, once `_link`, `_accept` and their configurator screens are deployed on every box;
- `tenant-groups/_ensure`;
- the onboarding worker, tenant-foundation and the provisioner credential.

**PGR owns:**
- **Step order:** tenant foundation → `PLATFORM_BASELINE` → founder via HRMS → `organizations/_ensure` → `memberships/_ensure` → `bindings/_ensure` → `_lifecycle ACTIVE`.
- **Progress and fencing:** per-record progress, lease fencing and `restartNo`.
- **Lifecycle publication:** PGR replays its recorded decision until the BFF acknowledges it. `FAILED` is published only for terminal abandonment.
- **Readiness:** served from the workspace row (#2103).
- **Seed:** MCP `tenant_bootstrap` uses the same seed.
- **Tenant name at onboarding (D21):** MDMS `tenant.tenants.name`, `TENANT_TENANTS_<ID>` in every tenant language, and StateInfo.
- **Baseline prerequisite:** the baseline must hold everything HRMS `_create` needs for the founder.

## 6. Token issuance and revocation

- **Staff credential:** derived, never stored.
  - **Encoding:** `password = encode_v1(HMAC(key[keyVersion], "v1" ‖ uuid ‖ tenantId))`, giving 15 characters, one from each required class, which satisfies egov-user's policy.
  - **Setting it:** it is set **only when a binding becomes `active`** (new-user `_link`, `_accept`), at the founder's first `_select` (D25/B8), or at first issuance for converted links, never while `pending`.
  - **At activation, logout-once:** the BFF signs in with the new credential, logs out the live token it gets back (which may be the person's existing native DIGIT token), and only then mints the token it hands out.
  - **Failure handling:** the egov-user adapter keeps the OAuth error body and maps it to invalid credentials, locked, inactive or dependency error.
  - **Repair:** at most once per lease, only on "invalid credentials", never when the account is locked or inactive (`ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`).
  - **Key rollover:** a new key version is adopted lazily at the next issuance.
  - **Rollout:** behind `IDENTITY_STAFF_CREDENTIAL_MODE` (D24).
- **Citizen issuance:** the egov-otp-backed citizen grant, unchanged. The real non-fixed OTP run is a gate item (O2).
- **Ordering:** `_select` takes the person's Redis lease, the same one revocation takes. Inside it, it:
  1. re-reads the requesting session and compares the revocation generation stored on it;
  2. checks the §3 predicate and DIGIT `active`;
  3. returns the cached token (validated cheaply against egov-user) or mints a new one, and records it.

  Session writes are update-only (`SET … XX`), so a revoked session is never recreated.
- **Revocation triggers:**
  - Keycloak events (via the poller): disable, delete, logout-all, credential change, membership removal;
  - reconcile: an HRMS deactivation, a role change, an Organization disabled or `FAILED`, an MDMS tenant deactivated, or a DIGIT account missing;
  - logout.

  Each one logs out every inventoried token and ends BFF sessions. Failed revocations go on a Redis retry set.
- **Changing your own password** keeps the initiating session and signs out the others; matching uses the Keycloak event's `sessionId` and `clientId`. Any other credential change signs out everything.
- **Token inventory** is kept to the token's actual expiry. If it is missing, grant-eligible staff are found again through the derived credential. The BFF never reactivates an account in order to revoke it.
- **Keycloak event poller:**
  - polls in overlapping windows, dedupes by `(time, id)`, and advances its Redis checkpoint only after each effect is recorded;
  - revokes conservatively if the checkpoint falls outside retention;
  - writes an audit record before revoking on a Keycloak user deletion;
  - `/readyz` reports its lag.
- **Documented limits:**
  - native refresh tokens issued before binding (up to 14 days) can't be revoked without an egov-user change;
  - while the BFF is down, revocation pauses;
  - once Redis is lost, these tokens live until they expire: citizen tokens, inactive or locked staff tokens, and tokens of a Keycloak user deleted in the same window.

## 7. DIGIT3 migration (planned reopen)

This is a one-time, versioned migration.
- **Prerequisite:** a complete `digit.accounts` mirror with no drift.
- **Steps:** stop the old writers → drain → compare inventories → reshape into the DIGIT3 grant model → switch authority under a migration epoch → invalidate sessions.
- **Rollback:** defined before cut-over.
- **Blocked on:** the DIGIT3 identity and role design (O3).

## 8. Citizens and self-service

- **Citizen OTP:** the BFF owns phone possession. Delivery goes through one `HttpOtpSender` contract:
  - the BFF POSTs `{phone, code, purpose, tenantId, locale, expiresIn}` to one configured URL;
  - novu-bridge (#2203) picks the provider and template and sends the SMS or WhatsApp;
  - `log` stays as the dev-box sender.
- **Citizen name:** their given name, or the national mobile number when none is given (D17). Never empty, because egov-user rejects an empty name.
- **Phone change:**
  - allowed for every citizen, including legacy ones once PGR's citizen lookup is fixed (§12);
  - the new number must pass the tenant's mobile rule, or the change is rejected up front;
  - it keeps the citizen account's uuid, updates Keycloak and then DIGIT, and invalidates sessions carrying the old number;
  - one Redis lock per normalized phone covers sign-in, step-up and change. Step-up returns 409 if another person owns the phone.
- **Usernames:** new phone identities get an opaque username; existing usernames are left as they are; lookup always follows the current verified phone.
- **Legacy citizens:** resolved by existing link, then a CITIZEN search by the verified phone. An ambiguous match fails closed (`CITIZEN_ACCOUNT_AMBIGUOUS`), and admins resolve it through the retained internal citizen link, unlink and list routes. Going forward, an admin citizen link never silently replaces an existing BFF-created citizen account.
- **Email change (staff, D18):**
  - self-service through Keycloak `UPDATE_EMAIL`: verify the new address while signed in, and the old address is notified;
  - an admin path in the configurator member screen;
  - written to DIGIT only after verification.
- **People with a Keycloak credential:** self-service actions are Keycloak required actions, started by `/authorize?action=`, allowlisted per client and pinned to the person who started them.
  - **Supported:** `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `delete_credential` (second factors only), `UPDATE_EMAIL`, `idp_link`.
  - `GET /session` lists the actions, credential metadata and linked providers.
  - **Unlinking a provider:** `POST /identity/v1/account/providers/_unlink {alias}`.
  - **Last-method protection** counts primary methods only (password, linked provider, citizen phone).
  - Profile actions that would edit DIGIT-owned fields are excluded.
- **One Keycloak password per person**, the same for every tenant and surface. Accepting an invite includes setting it up when the person is new.
- **My signed-in sessions:** `GET /session` returns `sessions[]`, and `POST /identity/v1/logout {scope: "current" | "others" | "all"}` signs out accordingly and revokes the matching DIGIT tokens.
- **Keycloak account console:** hidden.

## 9. Where future changes land

| Future change | Lands in | Holds within |
|---|---|---|
| New identity provider | Realm config + client attribute | Same claims and linking rules; IMPORT mappers |
| Keycloak-hosted authenticator | Realm config + declared `hosted` method | Hosted entirely in Keycloak |
| New browser surface | Surface registry + Keycloak client | An existing context kind |
| Staff SSO policy | Keycloak flow per client | — |
| New DIGIT role | MDMS roles + role-actions; mirrored automatically | — |
| New OTP channel | novu-bridge | Same send contract |
| New self-service action | Realm required action + client attribute + theme | A person with a Keycloak credential |
| New descriptive profile field | DIGIT UI | DIGIT-owned field |
| New signup field, country or onboarding step | Configurator + PGR + seed | Not an identity-proof change |
| New login-page string | Theme + localisation | — |
| Tenant rename | Configurator → MDMS + localisation; BFF mirrors | — |
| Invitation expiry change | Configurator → MDMS | 1 hour – 90 days |

Anything outside "holds within" is a new identity capability and a legitimate reopen.

## 10. BFF work list

**Modules (organization guidance, not a mandatory rewrite):**
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

**No big-bang refactor.** Keycloak and egov-user client code moves into small client files only when a work item touches it.

| # | Item | Size |
|---|---|---|
| 0 | Freeze, before items 7–13: route, state and error schemas; `digit.accounts` and `digit.bindings` v1; `encode_v1` test vectors; canonical payload hash; the `restartNo` contract; probe of the event shapes | S |
| 1 | Surface registry; remove the `prompt=login` literal | M |
| 2 | Declared `hosted` method; `oauth`→`idp`; codes, not copy; citizen methods return `[]`, not 503 | S |
| 3 | `HttpOtpSender` | S |
| 4 | `action` passthrough; `/session` actions, credentials, providers, `sessions[]`; provider `_unlink`; last-method protection; `logout {scope}` | M |
| 5 | Password-setup email `client_id` per surface (unblocks #2191) | S |
| 6 | Stable error codes on `_select`, `callback`, `auth-results` (`ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `INVITATION_STALE`, `PENDING_INVITATION`, `IDENTITY_EMAIL_CHANGED`) | S |
| 7 | Derived staff credential: activation-only, logout-once, typed failure parsing, safe DIGIT writer, the `IDENTITY_STAFF_CREDENTIAL_MODE` flag; delete per-login rotation | M |
| 8 | Bindings: key, states, rules, uuid lock + `boundUuids`, D10 predicate everywhere, tenant must equal the workspace tenant, inactive staff shown with a code, binding-else-managed until D13 | M |
| 9 | D5 live `ACCOUNT_ADMIN` check; `_link` (email required, username match, resumable), `_accept`, member list and remove; invitation expiry from MDMS (D22); `pendingInvitations` | M |
| 10 | Revocation: shared lease, session re-read, update-only sessions, inventory to expiry, cached-token validation, all §6 triggers (HRMS deactivation, role change, Organization or tenant disabled, missing account), derived-credential fallback, retry set, event poller with deletion audit, self-password-change exemption | M |
| 11 | Onboarding primitives (§5) | M |
| 12 | Sync module (§4): roles and status, names (D17), email compare and re-propagation (D18), tenant-name mirror (D21), immediate mirror on link, accept and remove, the fresh-read rule | M |
| 13 | Phone: lock, opaque usernames, challenge binding, step-up, change validated against the tenant rule; citizen default name (D17) | M |
| 14 | Delete: worker, tenant-foundation, `_invite`, role projection, role `_ensure`, allowlist, provisioner env, the managed-`kcbff-` path, branding relay, `tenant-groups/_ensure`, permanent backfill route, staff account-link aliases. The citizen link, unlink and list routes stay | M |
| 15 | Fixes: session kept on a Keycloak blip; citizen phone memo drift; remove the `admin/admin` fallback; `/readyz` (Redis, JWKS, Keycloak admin token, catalogues, DIGIT, poller lag, reconcile interval); `Cache-Control` on `tenant-contexts`; perf fixes | M |
| 16 | In-flight PR fixes (#2190, #2201, #2206), excluding code that item 14 deletes | M |
| 17 | Final docs: `docs/identity-bff.md` + `architecture.md` as the frozen contract | S |
| 18 | Test migration: the 33 legacy-flow specs plus `backend/identity-bff/tests` move onto BFF flows; spec count and pass rate ≥ today's | M |
| 19 | **One-time conversion job:** old account links → bindings + Organization membership + `digit.accounts` entries, on every box, before D10 is enforced. Deleted afterwards | S |

## 11. Completion gate (executed tests)

**Contract:** a test per frozen route asserting its schema and error codes.

**Normal paths:**
- each persona (configurator founder, configurator admin, employee, Keycloak citizen, phone-only citizen) through sign-in, `_select`, self-service and logout;
- an admin creates an employee, who signs in and lands in the inviting workspace, never the signup wizard;
- an existing user accepts an invite; an expired invite is rejected;
- a person lists their sessions, signs out others, and signs out everywhere;
- a staff email change (self-service and admin) reaches DIGIT only after verification;
- a tenant rename in the configurator appears in the Keycloak Organization, the sign-in picker and digit-ui;
- "remove member" deactivates in HRMS and removes the binding;
- a citizen without a given name gets the national mobile number as their name.

**Existing coverage:** the migrated legacy-flow specs (item 18) pass, with a spec count no lower than before.

**Failure and recovery:**
- concurrent HRMS edit during a mirror pass, and during credential setup;
- an HRMS deactivation revokes cached tokens within one reconcile interval; reactivation in HRMS restores access with no BFF write;
- Keycloak disable, delete or logout-all, and membership removal → revoked; re-enabling restores access;
- Keycloak disable, logout-all and credential change during `_select` and during session refresh;
- a token revoked externally while cached; a DIGIT role change revokes the cached token;
- mirror writes preserve email, `emailVerified` and username (real Keycloak); a masked name is never mirrored;
- binding activation logs out the existing native token once;
- revocation with Redis inventory lost: grant-eligible staff are revoked; the documented limits hold for the rest;
- a crash between mint and record;
- event checkpoint outside retention; duplicate and out-of-order events; an admin disabling the user during a mirror pass;
- the derived credential passes egov-user validation; an out-of-band password change → one repair; a locked account → no repair;
- binding rules: self-bind, escalation, a uuid racing two binds, a binding at a non-workspace tenant rejected;
- a stale, removed or expired invitation; removing a `pending` binding releases the uuid;
- `_link` crashing at each step → a repeat resumes; a cross-workspace invite takes the existing-user branch; a changed email is not duplicated;
- D5: role removed mid-session; cross-tenant admin denied;
- onboarding:
  - slug race; tenant-id race; the same restartNo with a different payload;
  - repeated `ACTIVE`; delayed calls from a lower restartNo;
  - a terminal restart keeps the same founder (D25/B9);
  - re-opening a `FAILED` Organization; a retried founder with a different uuid;
  - a PGR crash at every boundary, including around lifecycle publication;
- an existing Organization without a lifecycle attribute stays visible; disabling an Organization revokes its members;
- two people claiming one phone; a phone that fails the tenant rule is rejected; an old session racing a phone change; a released number claimed by someone else;
- TOTP enrolment, then enforcement at the next employee sign-in; second-factor removal; provider unlink; concurrent unlinks against last-method protection;
- a self-service password change keeps the initiating session; an admin reset signs out everything;
- a legacy citizen with an ambiguous match → resolved by an admin;
- the one-time conversion job (item 19): existing admin-linked employees still sign in after D10;
- the credential-mode flag rolls a box back from `derived` to `rotate` and forward again;
- expired-token re-select; forgot/set password; revocation retry set; key rollover; `/readyz`;
- BFF stopped → signed-in users keep working until expiry;
- every §9 row exercised as a config change;
- each §8 self-service action works on Keycloak 26.7.3.

**Real dependencies:** at least one suite runs against real Keycloak, Redis, egov-user and egov-otp, including a real non-fixed citizen OTP mint. That run is required before §0 is declared complete; the owner decides when (O2).

## 12. Outside the BFF (our apps and config only)

- **PGR:**
  - port of the onboarding steps, seed, founder via HRMS (email copied only if verified), readiness; #2169 rescoped, #2103;
  - tenant name at onboarding: MDMS name, `TENANT_TENANTS_<ID>` in every tenant language, StateInfo (D21);
  - an MDMS master for invitation expiry, seeded with 14 days (D22);
  - **citizen lookup fix (minimal):** when an employee files a complaint for a citizen, PGR also finds BFF-created citizens by mobile, so no duplicates are created. Its other behaviour is unchanged.
- **Configurator:**
  - staff create = HRMS `_create` + `_link` (email required);
  - "remove member" = HRMS deactivate + `_remove` (D23);
  - employee screens send email changes to the BFF; email is read-only in HRMS forms for bound employees;
  - pending-invite accept screen; member list and remove; invitation-expiry setting (1 hour – 90 days);
  - account menu: password, TOTP, second factor, link and unlink a provider;
  - Logout calls `/identity/v1/logout`;
  - routing order: memberships → pending invitations → own draft → signup wizard;
  - **tenant rename** writes MDMS `name` + `TENANT_TENANTS_<ID>` in **every** tenant language (today en_IN only), busts the localisation cache, and moves PGR's name reservation;
  - delete `tenantBootstrap.ts`;
  - signup code and slug derivation: **done in #2250** (#2249).
- **digit-ui:**
  - slug→context cache in `tenantRoute.js`;
  - drop the direct `/user/_logout` call;
  - identifiers read-only on the profile page; staff account menu; citizen "change phone number";
  - remove Change Password; delete the dead Keycloak adapter;
  - delete the legacy login screens after #2072.
- **Keycloak config:**
  - move the realm script, themes and the magic-link image to the top-level `keycloak/`;
  - declarative realm;
  - event store: user and admin events, including `VERIFY_EMAIL`, LOGOUT, UPDATE_PASSWORD and UPDATE_CREDENTIAL, with retention longer than the longest tolerated outage, plus `view-events` for the service account;
  - name fields read-only, `lastName` not required;
  - IdP mappers in IMPORT mode;
  - employee conditional OTP;
  - the theme reads branding from public MDMS.
- **Runtime config:** correct `EGOV_OTP_HOST` (needed for O2).
- **Ops, per box:**
  - snapshot `eg_user` + HRMS before the first rollout;
  - set the credential-mode flag;
  - confirm the egov-user image is stock;
  - run item 19 before D10;
  - delete every `kcbff-` account (D13);
  - tenant-route backfill;
  - clean up leftover Keycloak groups and roles after item 14, with a test that nothing reads them.
- **Deployment hardening of legacy endpoints:** tracked separately; not a D10 blocker.

## 13. Sequencing

1. Item 0. Provision the credential HMAC key and the flag in deploy config. Land the in-flight PRs (items 16, 5, 6), skipping fixes to code that item 14 deletes.
2. Keycloak config: event store, retention and `view-events`; read-only names; IMPORT mappers; employee conditional OTP. The theme reads branding directly.
3. Per box: snapshot → item 7 (flag `rotate`) → item 8 → item 19 → item 9 → item 10 → switch the flag to `derived`.
4. Configurator and digit-ui consumers (link, accept, remove, email change, rename, routing order, slug cache, logout), **deployed on every box** before anything they replace is deleted.
5. Item 11 → the PGR port (including tenant names, invitation-expiry master and citizen lookup fix), **deployed on every box** → delete `kcbff-` accounts (D13) → tenant-route backfill → item 14 deletions → Keycloak group clean-up.
6. Items 12, 13, 1–4, 15, 17. Item 18 runs alongside steps 3–6, and each legacy spec moves when its flow lands.
7. Run the §11 gate.
8. **Remove the old paths (D26):** tenantless legacy sign-in, digit-ui-v2 citizen login, legacy native password paths, legacy identity screens (#2072). Identity is complete only after this step.

## 14. Open items

- **O1:** `SUPERUSER` for founders. Revisit after checking that every workspace-setup write is granted to `ACCOUNT_ADMIN`, `MDMS_ADMIN`, `LOC_ADMIN` or `GRO`.
- **O2:** the real non-fixed citizen OTP mint (gate item; timing set by the owner).
- **O3:** the DIGIT3 identity and role design (blocks §7 only).
- **O4:** employees whose HRMS record sits at a city-level tenant aren't served by the new identity system; clarify later.
- **Walkthrough decisions:** all settled (D16, D17, D20, D25, D26).
