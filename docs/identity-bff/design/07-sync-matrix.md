# 07: Keycloak↔DIGIT sync matrix

**Purpose:** every field and every lifecycle phase that has to stay consistent between Keycloak, the BFF and DIGIT (egov-user, HRMS, PGR), with an explicit owner, direction and trigger. Where nothing is synced, the row says so and gives the reason. Anything that today's code or the rev-6 design leaves silent, inconsistent or one-way is listed in §4 as a GAP.

**Target design:** `IDENTITY-BFF-BOUNDARY-FREEZE.md` rev 6 (cited `F §n`, `Dn`). **State draft:** `03-state-schema.md` (cited `S §n`).

**Code read** (read-only):

| Prefix | Path |
|---|---|
| `B/` | `wt-bff` @ `8d2f2057a` (includes merged #2206), `backend/identity-bff/src/modules/` |
| `I/`, `A/` | `backend/identity-bff/src/infrastructure/`, `backend/identity-bff/src/app/` |
| `PG/` | `wt-bff` `backend/pgr-services/src/main/java/org/egov/pgr/` |
| `U/` | `_worktrees/Digit-Core-keycloak-identity/core-services/egov-user/src/main/java/org/egov/user/` (branch `feat/keycloak-identity-exchange`). The stock-egov-user parts (`User`, `UserRequest`, `UserRepository.update`, the auth provider) are what this matrix relies on. The fork-only `identity/` package is covered by GAP-32 |
| `UP` | the same egov-user's `src/main/resources/application.properties` |
| `H/` | `egovernments/DIGIT-OSS` `business-services/egov-hrms/src/main/java/org/egov/hrms/service/EmployeeService.java` (master, via `gh api`) |

**Account kinds (applicability columns):**

| Code | Kind | Today | Target |
|---|---|---|---|
| **MF** | managed founder | `kcbff-` EMPLOYEE created by the BFF onboarding worker (`B/onboarding/worker.ts:146-200`). Roles are projected from Keycloak groups | HRMS employee created by PGR, bound by `bindings/_ensure` (F §5). After D13 it is a linked staff account with `createdBy.kind=workload` |
| **LS** | linked staff | existing DIGIT employee linked by `account-links/_link` (`B/control-plane/routes.ts:124-170`), stored in `digit.accountLinks` | `digit.bindings` entry via `_link`/`_accept` (F §5) |
| **MC** | managed citizen | `kcbffc-` CITIZEN at the state root, created at the first citizen `_select` (`B/citizens/citizen-registration.ts:131-204`) | same, as a `digit.accounts` citizen entry, `origin:"managed"` |
| **LC** | legacy-linked citizen | pre-existing CITIZEN (usually `userName` = mobile) linked by a verified phone or an admin (`B/account-links/account-links.ts:197-240`) | same, as a `digit.accounts` citizen entry, `origin:"linked"`/`"legacy-phone"` |

**Direction vocabulary:**
- `KC→DIGIT`, `DIGIT→KC`: one-way projections, written by the BFF.
- `seed KC→DIGIT once`: copied at DIGIT account creation only; afterwards the other side owns the field.
- `none`: deliberately not synced. The reason is in the row.
- `BFF-owned`: state that lives in Keycloak attributes or Redis and has no DIGIT counterpart.

---

## 1. Field matrix

### 1.1 egov-user `User` (every field of `U/domain/model/User.java:38-90` + contract `U/web/contract/UserRequest.java:29-153`)

Update semantics are from `U/persistence/repository/UserRepository.java:200-345` (cited `UR:n`). SQL is from `U/repository/builder/UserTypeQueryBuilder.java:294-299`.

| # | Field | Systems | Owner | Dir | When synced | Drift handling | MF / LS / MC / LC | Today (code) | Target (design) | GAP |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | `id` (Long) | DIGIT | DIGIT | none: an internal key that only egov-user needs | — | immutable | all | copied back on writes (`B/managed-accounts/managed-account-service.ts:330`, raw spread `:163`) | copy on the safe writer (S §6) | — |
| U2 | `uuid` | DIGIT; KC `digit.accounts[].uuid`, `digit.bindings[].uuid`, `digit.boundUuids` | DIGIT | DIGIT→KC | binding create (`_link`, `bindings/_ensure`, migration); citizen resolution | immutable. If a search returns nothing (data wiped or restored), behaviour is **unspecified** | all | `digit.accountLinks` value `<type>\|<tenant>\|<uuid>` (`B/account-links/account-links.ts:48-50`); citizen in `digit.citizenRegistrations` (`B/citizens/citizen-registration.ts:64-72`) | binding key `(sub, tenant)→uuid`, uuid lock (F §3) | GAP-23 |
| U3 | `tenantId` | DIGIT; KC entry `tenantId` | DIGIT | DIGIT→KC | same as U2 | immutable. Citizens live at the **first dotted segment** (`managed-account-service.ts:196-198`), not at the Organization `rootTenantId` | all | staff: link tenant; citizen: `digitCitizenTenantId` | "one CITIZEN account per root tenant" (F §3), which is ambiguous | GAP-17, GAP-25 |
| U4 | `userName` | DIGIT; KC `digit.accounts[].userName` (S §1.3, PROPOSED) | DIGIT | DIGIT→KC (informational) | binding; reconcile | **Immutable** in egov-user (`UR:205` keeps the old value). HRMS re-sets `userName=code` on update (`H/EmployeeService.java:377`), which is ignored | MF: `kcbff-…` today, HRMS code target · LS: HRMS code · MC: `kcbffc-…` · LC: usually = the **original mobile** | used as the grant username (`managed-account-service.ts:549-551`; citizen minter `B/managed-accounts/citizen-token-minter.ts` `passwordLogin(username: account.userName)`) | used by the revocation fallback (S §1.3) | GAP-19 (LC after phone change) |
| U5 | `password` | DIGIT (BCrypt) | **BFF** for bound staff (derived credential); DIGIT/native for everyone else | BFF→DIGIT (staff only); citizens none (the OTP grant) | today: **every** token mint; target: binding activation + first issuance + repair (F §6) | target: repair once per lease on typed "invalid credentials" | MF·LS: yes · MC·LC: **none**. The citizen grant is an OTP (`UP:37`); a native citizen password stays untouched | random rotation at each mint: managed `managed-account-service.ts:544-546`, linked `:545` (**destroys the native password at the first BFF sign-in**) | `encode_v1(HMAC(key[kv], uuid‖tenant))` (F §6) | GAP-13, GAP-14, GAP-15 |
| U6 | `pwdExpiryDate` | DIGIT | DIGIT | none: stored but **not enforced at login** (no reader outside persistence/contract) | — | `UR:306-309` keeps the old value when null | staff | not sent (managed); raw spread (linked) | omit (S §6) | — |
| U7 | `salutation` | DIGIT | DIGIT | none: descriptive and not in the Keycloak profile | — | `UR:311` **written as sent** (null wipes) | all | managed `editable()` (`managed-account-service.ts:328-343`) omits it → **wiped to null on every managed write** | copy; masked → skip write | GAP-10 |
| U8 | `title` | DIGIT domain only | — | none: not in the contract and not in the update SQL (`UR:313` puts it, the query has no column) | — | no effect | — | — | — | — |
| U9 | `name` (≤50, `@Pattern NAME`) | DIGIT; KC `firstName`/`lastName`; KC `digit.accounts[].name` | **DIGIT** (D3) | target **DIGIT→KC** from the D12 primary entry; **seed KC→DIGIT once** at creation | `_select`, reconcile (F §4); seed at founder HRMS create, `kcbffc-` create, `_link` new user | KC side read-only (F §12); admin edits in KC are reverted by the next mirror; IdP `FORCE` mappers fight the mirror | all | **KC→DIGIT only**, never DIGIT→KC: managed create from `readIdentityUserProfile` (`B/organizations/organization-service.ts:844-863`, via `B/reconciliation/subject-sync.ts:39`); citizen from `claims.name \|\| "Citizen"` (`B/access-context/routes.ts:244`); PGR CSR flow **renames** citizens (`PG/service/UserService.java:84-87,149-151`) | DIGIT→KC mirror, user-read-only names | GAP-03, GAP-04, GAP-05, GAP-06, GAP-07 |
| U10 | `gender` | DIGIT | DIGIT | none: descriptive | — | `UR:256-268` **null → 0** | all | managed `editable()` omits it → reset to 0 on every managed write | copy | GAP-10 |
| U11 | `mobileNumber` | DIGIT; KC `phoneNumber` | **citizen:** KC (BFF-verified). **staff:** DIGIT/HRMS | citizen: KC→DIGIT. staff: **none** (HRMS-mandatory contact, not a login identifier; a staff person's KC phone is a citizen identifier only) | citizen: `_select`, phone change, reconcile retry (F §4, §8) | citizen: DIGIT-side edits are blocked on `/profile/_update` (`nullifySensitiveFields`, `U/domain/model/User.java:196-206`) but possible via admin `_updatenovalidate`; reconcile compares unmasked values (S Q15). `UR:285-289` keeps the old value when null | MF·LS: none · MC·LC: KC→DIGIT | written when the Redis memo differs (`managed-account-service.ts:534-541`); memo permanent (`:454,540`); **source is the session claim** `claims.phone_number` (`routes.ts:162-166, 240-247`) | from a fresh KC read; memo retired (S §3.2) | GAP-18, GAP-19, GAP-33 |
| U12 | `countryCode` | DIGIT; derived from KC E.164 | as U11 | as U11 | as U11 | split by the tenant's `MobileNumberValidation` (`B/citizens/citizen-registration.ts:102-117`). The rule differs per state root | MC·LC | from the split at the citizen `_select` (`routes.ts:229`) | same | GAP-18 |
| U13 | `alternatemobilenumber` | DIGIT | DIGIT | none: descriptive | — | `UR:328` written as sent | all | managed `editable()` omits → wiped | copy | GAP-10 |
| U14 | `altContactNumber` | DIGIT | DIGIT | none | — | `UR:229` written as sent | all | wiped by managed writes | copy; masked → skip | GAP-10 |
| U15 | `emailId` | DIGIT; KC `email`+`emailVerified` | **staff:** KC (verified email) · **citizen:** DIGIT | staff: KC→DIGIT, all of the person's staff entries. citizen: **none** (design names staff only) | `_select`, Keycloak events (email verified), reconcile retry (F §4) | **Two DIGIT writers** besides the BFF: HRMS `_update` re-sends the whole embedded user (`H/EmployeeService.java:351-354`), and digit-ui `/profile/_update` (`U/domain/service/UserService.java:463-494`) | MF·LS: KC→DIGIT · MC·LC: none | managed create only, verified email only (`organization-service.ts:857`); never updated; linked untouched | KC→DIGIT on verified email | GAP-01, GAP-36, GAP-40 |
| U16 | `pan` | DIGIT | DIGIT | none: sensitive, descriptive | — | `UR:295` written as sent | all | wiped by managed writes | copy; masked → skip | GAP-10 |
| U17 | `aadhaarNumber` | DIGIT | DIGIT | none | — | `UR:213` written as sent | all | wiped by managed writes | copy; masked → skip | GAP-10 |
| U18 | `permanentAddress` | DIGIT (`eg_user_address`) | DIGIT | none | — | updated only if the address set is non-null (`UR:340-342`) | all | not sent (managed) → no change | copy flat; verify null → delete on the image (S §6) | — |
| U19 | `permanentCity` | DIGIT | DIGIT | none | — | as U18 | all | in the login profile only (`B/managed-accounts/digit-user-client.ts:108-111`) | copy | — |
| U20 | `permanentPinCode` | DIGIT | DIGIT | none | — | as U18 | all | — | copy | — |
| U21 | `correspondenceAddress` | DIGIT | DIGIT | none | — | as U18 | all | — | copy | — |
| U22 | `correspondenceCity` | DIGIT | DIGIT | none | — | as U18 | all | — | copy | — |
| U23 | `correspondencePinCode` | DIGIT | DIGIT | none | — | as U18 | all | — | copy | — |
| U24 | `addresses[]` (search only: id, type, address, city, pinCode, tenantId, userId) | DIGIT | DIGIT | none | — | read-only in the response | all | passed back verbatim by the linked raw spread (`managed-account-service.ts:163`) | omit (use flat fields) | — |
| U25 | `locale` (default `en_IN`, `User.java:73`) | DIGIT; KC `locale` attribute | **undecided:** F §4 says DIGIT→KC; S Q12 proposes leaving it out | F: DIGIT→KC; PROPOSED: none | — | `UR:284` written as sent (null wipes) | all | managed `editable()` omits → **null on every managed write** | F §4 vs S Q12 conflict | GAP-10, GAP-43 |
| U26 | `type` (EMPLOYEE/CITIZEN) | DIGIT; KC entry `kind` | DIGIT | DIGIT→KC (kind) | binding/resolution | `UR:316-324`: written **if sent** (old value only when null); the WHERE clause uses the old type | staff = EMPLOYEE, citizen = CITIZEN. A person who is both has **two** DIGIT accounts | sent unchanged | omit (S §6) | — |
| U27 | `roles[]` `{code, name, tenantId}` (+ role audit fields) | DIGIT (`eg_userrole_v1`); KC `digit.accounts[].roles`; today also KC Organization-group client roles | **DIGIT, written by HRMS** (D1) | target DIGIT→KC. **Today KC→DIGIT** for `kcbff-` | `_select`, reconcile; change → revoke the cached token (F §6) | `UR:336-339`: empty or equal → unchanged | MF·LS: HRMS · MC·LC: fixed `CITIZEN` (`B/managed-accounts/managed-account-service.ts:318-321`, `I/config.ts:181`) | projection: Organization groups → allowlist (`I/config.ts:243-247`) → egov-user (`B/reconciliation/reconciliation-service.ts:101-160`; `managed-account-service.ts:476-481`) every 300 s (`A/server.ts:15-35`). Linked accounts are never re-roled. No KC mirror | DIGIT→KC mirror only; projection deleted (item 14) | GAP-24, GAP-31 |
| U28 | `active` | DIGIT; KC `digit.accounts[].active` | **DIGIT** (HRMS `isActive`, `H/EmployeeService.java:378-382`) | DIGIT→KC (mirror only). KC `enabled` is **never** derived from it (D4) | `_select` live check; reconcile | `UR:225-228` keeps the old value when null. egov-user does **not** purge tokens on `active=false` via update (`U/domain/service/UserService.java:402-424` has no token removal) | all | the BFF **writes** `active=false` for former `kcbff-` members (`managed-account-service.ts:470-474`) and `active:true` on a role change (`:479`), which violates D4 until item 14. Linked: live check per `_select` (`:498-507`) | never written by the BFF; access = active ∧ predicate | GAP-08, GAP-22 |
| U29 | `accountLocked` | DIGIT | DIGIT (failed-login counter) | none: read at issuance as the typed outcome `ACCOUNT_LOCKED` (F §6) | — | auto-unlock after `account.unlock.cool.down.period.minutes=60` (`UP:59`) | staff (citizen OTP grant too) | not read: the 401 body is discarded (`digit-user-client.ts:70-73`) | typed parsing; never written | GAP-16 |
| U30 | `accountLockedDate` | DIGIT | DIGIT | none | — | as U29 | staff | — | omit | — |
| U31 | `eg_user_login_failed_attempts` (table) | DIGIT | DIGIT | none | — | derived-credential failures count toward the lock | staff | rotation at every mint hides failures | repair at most once per lease (F §6) | GAP-16 |
| U32 | `dob` | DIGIT | DIGIT | none | — | `UR:248-251` keeps the old value when null | all | linked raw spread re-sends `yyyy-MM-dd` while the request expects `dd/MM/yyyy` → **write fails** (S §6) | omit (S §6) | — |
| U33 | `photo` (fileStoreId) | DIGIT | DIGIT | none: Keycloak `picture` is not used | — | `UR:302-305`: an `http…` value keeps the old one, otherwise written as sent | all | managed `editable()` omits → **null** | copy | GAP-10 |
| U34 | `signature` | DIGIT | DIGIT | none | — | `UR:312` written as sent | all | wiped by managed writes | copy | GAP-10 |
| U35 | `identificationMark` | DIGIT | DIGIT; **today also the BFF ownership marker** | none | — | `UR:283` written as sent | MF: `keycloak-bff:v1:<subjectKey>:<tenant>` · MC: `keycloak-bff:citizen:v1:…` (`managed-account-service.ts:180,219`) · LS·LC: descriptive | the marker proves ownership (`:302-304`); `isBffManagedAccount` refuses to link such accounts (`:100-103`, `account-links.ts:132-134,213`) | marker meaning ends with D13 | GAP-20, GAP-27 |
| U36 | `bloodGroup` | DIGIT | DIGIT | none | — | old value kept when null (`UR:231-246`) | all | — | omit | — |
| U37 | `fatherOrHusbandName` (`guardian`) | DIGIT | DIGIT | none | — | `UR:270` written as sent | all | wiped by managed writes | copy | GAP-10 |
| U38 | `relationship` (`guardianRelation`) | DIGIT | DIGIT | none | — | `UR:272-282` null → `""` | all | wiped by managed writes | copy | GAP-10 |
| U39 | `otpReference` | request only | — | none: transient | — | — | citizen | the minter passes the OTP as the grant password (`citizen-token-minter.ts`) | — | — |
| U40 | `createdBy` / `createdDate` | DIGIT | DIGIT | none: audit. BFF creates are attributed to the DIGIT admin user | — | — | all | — | — | — |
| U41 | `lastModifiedBy` / `lastModifiedDate` | DIGIT | DIGIT | none. **PROPOSED:** used as the reconcile skip-unchanged key | — | `UR:330-331` | all | — | "skipping unchanged entries" (F §4) has no key yet | GAP-09 |
| U42 | `loggedInUserId`, `loggedInUserUuid`, `otpValidationMandatory`, `mobileValidationMandatory` | request-time flags | — | none: transient | — | — | — | — | — | — |
| U43 | egov-user **access token** (Redis token store) | DIGIT; BFF inventory (S N3) | DIGIT issues; BFF inventories | BFF tracks DIGIT | mint; revocation | 7-day validity (`UP:42`). egov-user returns the **same live token** to repeated grants (`managed-account-service.ts:242-249`), so a native session and the BFF share it | all | cache with a 60 s skew TTL (`:362-374`) | inventory to the actual expiry (F §6) | GAP-14 |
| U44 | egov-user **refresh token** | DIGIT | DIGIT | none | — | 14-day validity (`UP:43`); `/_logout` removes the **access token only** (`U/web/controller/LogoutController.java:36`) | all | the BFF discards the refresh token from its grants (`digit-user-client.ts:141-150`) | not mentioned | GAP-14 |
| U45 | PII encryption / masking (per-tenant `egov-enc` key) | DIGIT | DIGIT | none, but a **precondition** for every read | — | a masked read (`\*{2,}`) must never be written back **or mirrored** | all | write blocked on any masked string (`managed-account-service.ts:158-162`) | skip the write if masked (F §4) | GAP-06 (masked name mirrored into KC) |

### 1.2 HRMS employee (identity-relevant fields)

| # | Field | Systems | Owner | Dir | When | Drift | MF / LS / MC / LC | Today | Target | GAP |
|---|---|---|---|---|---|---|---|---|---|---|
| H1 | `code` (= egov-user `userName`) | HRMS, egov-user | HRMS | none | — | egov-user ignores a later code change (U4) | MF (target), LS | MF today has no HRMS record | founder via HRMS (F §5) | GAP-27 |
| H2 | `uuid` / `id` (= user uuid) | HRMS, egov-user, KC binding | HRMS | DIGIT→KC via U2 | binding | immutable | MF·LS | — | `bindings/_ensure` / `_link` take it | — |
| H3 | `tenantId` | HRMS | HRMS | DIGIT→KC (binding tenant) | binding | the employee's tenant may be a **city below the Organization root** | MF·LS | `_select` requires `boundTenant.tenantId === tenantId` (`B/access-context/routes.ts:129-131`) | — | GAP-25 |
| H4 | `isActive` + `deactivationDetails[]` / `reactivationDetails[]` | HRMS → egov-user `active` | HRMS | DIGIT→KC via U28 | reconcile; `_select` | HRMS sets `user.active` (`H/EmployeeService.java:378-382`); tokens are not purged | MF·LS | live check at linked `_select` only | mirror + `ACCOUNT_INACTIVE` | GAP-08, GAP-21 |
| H5 | `employeeStatus`, `employeeType`, `dateOfAppointment` | HRMS | HRMS | none: not identity | — | — | MF·LS | — | — | — |
| H6 | `assignments[]` (department, designation, fromDate/toDate, isCurrentAssignment, isHOD, reportingTo) | HRMS | HRMS | none: PGR reads HRMS live; the configurator member list should read HRMS, not KC | — | — | MF·LS | — | founder baseline must hold the department and designation (F §5) | — |
| H7 | `jurisdictions[]` (hierarchy, boundaryType, boundary, tenantId, isActive) | HRMS | HRMS | none: **not** Organization membership. PGR scoping (`PolicyDrivenScopeResolver.java:155`) | — | jurisdiction tenants can differ from the binding tenant | MF·LS | — | — | §3.3 |
| H8 | embedded `user` (all U-fields) | HRMS → egov-user `_update` | HRMS UI sends what it last searched | HRMS→DIGIT overwrites name, emailId, mobile, roles **as sent** | every HRMS edit | stale form → overwrites a KC-propagated email | MF·LS | — | — | GAP-01 |
| H9 | create-time password + SMS notification | HRMS → egov-user, SMS | HRMS | HRMS→DIGIT (native password) | HRMS `_create` | generated (`H/EmployeeService.java:246-252`) and **sent by SMS** (`:123,126`). It works natively until the derived credential replaces it | MF (target), LS | — | founder via HRMS (F §5) | GAP-15 |
| H10 | documents, serviceHistory, education, tests | HRMS | HRMS | none | — | — | — | — | — | — |

### 1.3 Keycloak user: core representation

| # | Field | Systems | Owner | Dir | When | Drift | MF / LS / MC / LC | Today | Target | GAP |
|---|---|---|---|---|---|---|---|---|---|---|
| K1 | `id` (subject) | KC; BFF bindings, sessions, revgen | KC | none to DIGIT: DIGIT has no back-reference (D8). "Who is bound to uuid X" = `q=digit.boundUuids` | — | KC delete removes all attributes with the user | all | `q=digit.accountLinks:<v>` (`B/organizations/organization-service.ts:174-180`) | `digit.boundUuids` index (S §1.2) | GAP-37 |
| K2 | `username` | KC | KC | none: never derived from DIGIT `userName` | create | email users keep `username=email` after an email change | staff: email (`organization-service.ts:1176-1186`); phone users: `phone-<sha256>` (`:1050-1107`) | — | opaque for new phone identities (F §8) | GAP-36 |
| K3 | `email` | KC; DIGIT `emailId` | KC | KC→DIGIT (staff, verified only) | events (UPDATE_EMAIL, VERIFY_EMAIL); `_select`; reconcile | preserved on every BFF PUT (F §4) | staff; citizens none | read for create only (`:857`) | as F §4 | GAP-01, GAP-40 |
| K4 | `emailVerified` | KC | KC | gates K3 | — | preserved on PUT | staff | `_link`/invite create users with `false` + `VERIFY_EMAIL` (`:1184-1185`) | — | GAP-01 (never clear DIGIT emailId) |
| K5 | `firstName` | KC; DIGIT `name` | DIGIT (D3) | DIGIT→KC; seed KC→DIGIT once | `_select`, reconcile | KC user-read-only (F §12); IdP mappers can overwrite | all | written at create from the signup/invite form (`:936-947`, `:1176-1186`; `B/organizations/member-invitation-service.ts:54-57`), then **read** into DIGIT | mirror | GAP-03, GAP-06, GAP-07 |
| K6 | `lastName` | as K5 | DIGIT | DIGIT→KC | as K5 | `required` → forces `VERIFY_PROFILE` on a non-editable field (S §2.4) | all | invite splits on the first space, with `"-"` when empty (`member-invitation-service.ts:54-57`) | Q11 open | GAP-06 |
| K7 | `enabled` | KC | KC | none (D4): the BFF never sends it, never derives it from DIGIT `active`, and never writes DIGIT from it | events + reconcile → revoke | full-user PUTs re-send a stale `enabled` (`organization-service.ts:107,888,927`) | all | phone-OTP sessions re-check every 60 s (`B/sessions/current-session.ts:37-51`); others: no check | predicate + revoke | (S Q18, in design) |
| K8 | `createdTimestamp` | KC | KC | none | — | — | all | — | — | — |
| K9 | `attributes.locale` | KC; DIGIT `locale` | undecided | F §4: DIGIT→KC; PROPOSED: none | — | DIGIT default `en_IN` vs KC tags (`en`, `fr`) | all | not written | — | GAP-43 |
| K10 | `attributes.phoneNumber` | KC; DIGIT `mobileNumber` | KC, written by the BFF OTP | KC→DIGIT (citizen) | phone change, `_select`, reconcile retry | admin-edit only (S §2.4); trust check `keycloakPhoneIsAdminControlled` (`organization-service.ts:207-221`) | citizens. Staff: none | created verified by phone OTP (`:1050-1107`) | step-up, change (F §8) | GAP-07, GAP-18 |
| K11 | `attributes.phoneNumberVerified` | KC | BFF | gates K10 | — | — | citizens | `"true"` at phone-user create | — | GAP-07 |
| K12 | credentials: `password` | KC | KC | none: never reaches DIGIT; the DIGIT staff password is derived (U5) | — | — | KC users with a password | — | — | — |
| K13 | credentials: `otp` (TOTP), `webauthn` | KC | KC | none | — | the employee flow does not enforce TOTP today (`configure-keycloak.sh:209-213`) | staff/KC users | — | conditional OTP (F §12) | — |
| K14 | `federatedIdentities[]` | KC | KC | none | — | IdP mapper `syncMode` decides whether name and email are overwritten at each IdP login | IdP users | inspected for password setup (`organization-service.ts:1101-1135`) | `idp_link`, `_unlink` (F §8) | GAP-07 |
| K15 | `requiredActions[]` | KC | KC | none | — | `VERIFY_PROFILE` trap (K6) | all | `VERIFY_EMAIL`, `UPDATE_PASSWORD` at invite (`:1185`, `:1199-1205`) | allowlisted actions (F §8) | GAP-06 |
| K16 | realm groups / Organization groups (`tenant-admins`, `employees`, `<group>--<userId>`) + their `digit-ui` client-role mappings | KC | today: the **role source** for `kcbff-` and the D5 admin check | today KC→DIGIT (roles); target none (inert) | — | after D1/D15 nothing must read them | MF (today) | `ensureOrganizationRoleAssignment` (`organization-service.ts:1385-1441`); D5 check reads them (`member-invitation-service.ts:39-52`, `TENANT_ADMIN` default `I/config.ts:238-240`) | deleted (D1, D15); D5 = live DIGIT `ACCOUNT_ADMIN` | GAP-31 |
| K17 | realm roles (`default-roles-<realm>`) | KC | KC | none | — | — | all | — | — | — |
| K18 | **Organization membership** (+ `membershipType`) | KC | KC; written by BFF primitives | none to DIGIT. It is the D10 gate | `memberships/_ensure`, `_accept`, `_link` new user; removal → revoke | removal is visible only as an admin event | MF·LS. Citizens: **never** (`B/citizens/citizen-registration.ts:16-22`) | `ensureOrganizationMembership` (`organization-service.ts:1233-1242`). **Linked-staff `_select` does not check it** (`routes.ts:138-152`); `account-links/_link` never grants it | D10 everywhere; ops job (a) | GAP-11, GAP-25 |
| K19 | user sessions / offline sessions | KC | KC | none | logout-all → revgen bump (F §6) | — | all | the BFF does not watch them | event poller | — |
| K20 | `notBefore` (admin "sign out all") | KC | KC | none | admin event → revoke | — | all | — | poller | — |
| K21 | brute-force status | KC | KC | none: independent of DIGIT `accountLocked` | — | — | all | — | — | — |
| K22 | consents | KC | KC | none | — | — | — | — | — | — |
| K23 | user-profile attribute declarations (view/edit permissions) | KC realm | KC config | — | deploy | must be `admin` for `digit.*`, phone and names | all | undeclared, `ADMIN_EDIT` (S §1.1) | declared (S §2.4) | GAP-06 |
| K24 | token claims snapshot in the BFF session (`email`, `name`, `phone_number`, `phone_number_verified`, `organization`, `groups`, `azp`) | BFF Redis | copy of KC at login/refresh | — | — | **stale** until refresh | all | **used as a DIGIT write source** (citizen phone, `routes.ts:240-247`; managed sync `:162-166`) and for the citizen name (`:244`) | §8: sessions with the old phone are invalidated | GAP-33 |

### 1.4 Keycloak user: `digit.*` attributes

| # | Attribute | Owner | Dir | When | Drift | MF / LS / MC / LC | Today | Target | GAP |
|---|---|---|---|---|---|---|---|---|---|
| A1 | `digit.accounts` (whole document, v1) | BFF, mirroring DIGIT | DIGIT→KC | `_select`, reconcile (F §4); PROPOSED also at binding activation | rewritten from live DIGIT; never authorizes on its own (S §1.2) | all | **does not exist** | S §1.3 | GAP-39 |
| A1a | `.v`, `.mirroredAt` | BFF | — | each pass | — | all | — | S §1.3 | — |
| A1b | `.entries[].kind` (staff/citizen) | from U26 | DIGIT→KC | as A1 | — | all | — | — | — |
| A1c | `.entries[].tenantId` | from U3 | DIGIT→KC | as A1 | — | all | — | — | GAP-17 |
| A1d | `.entries[].uuid` | from U2 | DIGIT→KC | as A1 | missing account → unspecified | all | — | — | GAP-23 |
| A1e | `.entries[].boundAt` | BFF (binding or first citizen resolution) | BFF-owned | set once | never rewritten | all | — | D12 ordering | GAP-04 (staff vs citizen precedence) |
| A1f | `.entries[].active` | from U28 | DIGIT→KC | as A1 | flip → revoke? (roles only today) | all | — | — | GAP-08 |
| A1g | `.entries[].roles[{code, tenantId}]` | from U27 | DIGIT→KC | as A1 | change → revoke the cached token (F §6) | all | — | — | GAP-24 |
| A1h | `.entries[].userName` | from U4 | DIGIT→KC | as A1 | immutable | all | — | S §1.3 PROPOSED | GAP-19 |
| A1i | `.entries[].name`, `.locale` | from U9, U25 | DIGIT→KC | as A1 | masked values | all | — | — | GAP-06, GAP-43 |
| A1j | `.entries[].credential.{keyVersion, setAt}` | BFF (credential writer) | BFF-owned | binding activation, first issuance, repair | — | MF·LS only | — | F §6 | GAP-13 |
| A1k | `.entries[].origin` (citizen) | BFF | BFF-owned | resolution | — | MC·LC | — | S §1.3 PROPOSED | GAP-42 |
| A2 | `digit.bindings` | BFF | BFF-owned; never written by the mirror | `_link`, `_accept`, `_remove`, `bindings/_ensure`, `memberships/_remove`, migration | — | MF·LS | — (`digit.accountLinks` today) | S §1.4 | GAP-11, GAP-38 |
| A3 | `digit.boundUuids` | BFF | BFF-owned | same PUT as A2 | — | MF·LS | `q=digit.accountLinks:<v>` | S §1.2 | GAP-37 |
| A4 | `digit.linkPending` | BFF | BFF-owned | inside the `_link` user create | — | LS | — (`digit.identityBffInvited`) | S §1.5 | — |
| A5 | `digit.accountLinks` | BFF | BFF-owned | admin link, phone link | — | LS, LC | `account-links.ts:114-188` | migrate → A2 (staff) / A1 (citizen) | GAP-11 |
| A6 | `digit.accountLinkBlocks` | BFF | BFF-owned | admin unlink with `block` | — | LC (staff blocks are moot) | `account-links.ts:144-153,172-175` | kept for citizens (F §8) | — |
| A7 | `digit.citizenRegistrations` | BFF | BFF-owned | citizen `_select` | per-route `DISABLED` | MC·LC | `citizen-registration.ts:131-204` | fold into A1 (S §1.1) | GAP-17 |
| A8 | `digit.managedTenants` | BFF | BFF-owned | `kcbff-` create | — | MF (today) | `organization-service.ts:95-111` (full-user PUT) | retire (D13) | GAP-27 |
| A9 | `digit.identityBffInvited` | BFF | BFF-owned | invite create | — | LS | `:1186` | replaced by A4 | — |
| A10 | `digit.identityBffSignup` | BFF | BFF-owned | magic-link signup | — | founder candidates | `:945, :884` | unchanged | — |
| A11 | `digit.identityBffPhoneOtp` | BFF | provenance | phone user create | — | MC·LC | `:1068`, no reader | unchanged | — |

### 1.5 BFF per-person Redis state that shadows DIGIT or KC

| # | Key family (S §3) | Shadows | Dir | Drift | Today | Target | GAP |
|---|---|---|---|---|---|---|---|
| R1 | `digit-citizen-mobile:{identityKey}` (#11) | U11 | memo of the last BFF-written mobile | permanent; lost on Redis loss → harmless re-write | `managed-account-service.ts:454,534-541` | retire (S Q15) | GAP-33 |
| R2 | `digit-managed-accounts` hash (#13) | `kcbff-` inventory | — | no TTL | `:460,467`; reconcile `:126` | retire | GAP-27 |
| R3 | `digit-linked-identities:{…}` (#14) | link set for logout | — | 7-day TTL | `:114-123` | retire (N4) | — |
| R4 | `digit-user-token` / holders (#9/#10) → N3/N4 | U43 | inventory | expiry minus skew | `:345-398` | inventory to the actual expiry | GAP-14 |
| R5 | `revgen:{sub}` (N2) | KC logout-all, credential change, disable | KC→BFF | — | — | F §6 | — |

**Count:** 45 egov-user + 10 HRMS + 24 KC core + 22 `digit.*` (incl. 11 `digit.accounts` sub-fields) + 5 Redis = **106 rows**.

---

## 2. Phases

Notation: **[BFF]**, **[PGR]**, **[CFG]** (configurator), **[UI]** (digit-ui), **[OPS]** (one-time job or operator), **[KC]** (realm config), **[HRMS]**.

### 2(a) Adoption of existing tenants and people (8c/`pg`, bomet, naipepea, moz)

On every box: before D10 is enforced, and before item 14 deletes anything.

| Step | Who | What is synced | Order / failure handling |
|---|---|---|---|
| A0 Inventory | [OPS], read-only | per box, list:<br>• KC users carrying `digit.accountLinks` (EMPLOYEE/CITIZEN), `digit.managedTenants`, `digit.citizenRegistrations`;<br>• Redis #13;<br>• `kcbff-`/`kcbffc-` DIGIT accounts, and which are used (complaints assigned, audit);<br>• HRMS employees per tenant, with/without `emailId`;<br>• DIGIT employees **without** an HRMS record (e.g. MCP `tenant_bootstrap` seeds);<br>• CITIZEN rows sharing a mobile (ambiguity candidates);<br>• which egov-user image is deployed (GAP-32) | Output feeds A3–A7. No writes |
| A1 Tenant routes | [BFF] `tenant-routes/_backfill` (`B/tenant-routes/backfill.ts:25-76`) | per active **root** tenant: an Organization with `digit.rootTenantId`, `digit.urlSlug=tenantId`, name = MDMS tenant name **at creation only** (`:54`) | idempotent. A conflict is reported, never adopted. Lifecycle absent = ACTIVE (F §5). Subtenant group mappings are left as they are (S Q10) |
| A2 Realm config | [KC] | user-profile declarations (`digit.*`, phone, names read-only); event and admin-event store with details; `view-events`; IdP mapper `syncMode=IMPORT` (GAP-07); `lastName` not required (GAP-06) | must precede A5 (the first mirror), or a mirrored name triggers `VERIFY_PROFILE` |
| A3 Link → binding migration | [BFF] one-time job (**no code exists**, GAP-11) | for each KC user, each `digit.accountLinks` EMPLOYEE value:<br>1. `digit.bindings` `{state:active, createdBy.kind:migration}` + `digit.boundUuids`;<br>2. **Organization membership** in the Organization owning the link tenant (root Organization, or the Organization of the group mapping);<br>3. a `digit.accounts` staff entry with no `credential`.<br>For each CITIZEN link and each `digit.citizenRegistrations` uuid: a citizen entry (`origin` = linked or managed) | per subject under the subject lease. Idempotent. Re-runnable. A failure leaves the subject on the old `digit.accountLinks` path, which `_select` still reads until item 14. **Membership before D10 enforcement**; verify with "existing admin-linked employees still sign in" (F §11) |
| A4 Adopt unlinked employees | [CFG] `_link {tenantId, digitUuid, email}` per HRMS employee | new KC user: membership + active binding + password-setup email. Existing KC user (same email): pending binding → `_accept` | **Needs an email.** Employees without `emailId` cannot be adopted until an admin supplies one (GAP-12). The admin-entered email reaches DIGIT only after KC verification (GAP-01). KC `firstName`/`lastName` come **from the DIGIT name** (GAP-03) |
| A5 First mirror | [BFF] reconcile / `_select` | `digit.accounts` roles, active and name → KC. **KC names are overwritten by the DIGIT/HRMS names** | expected and visible to users. Communicate it. Citizen placeholder rule (GAP-04) |
| A6 Native passwords | [BFF] at binding activation / first issuance | the derived credential **replaces the native DIGIT password** (today: the first BFF sign-in rotates it randomly, `managed-account-service.ts:545`). Legacy login stops working for that employee, silently | set only on `active`, never on `pending` (GAP-13). Tell employees that legacy login ends. Block the native reset paths (GAP-15) |
| A7 Existing native DIGIT tokens | [BFF] at binding activation | today: none, so native tokens (7 days) and refresh tokens (14 days) stay live, and the BFF's grant **shares** the native session's token | PROPOSED **logout-once** after setting the credential (GAP-14). Refresh tokens are a documented limit plus deployment hardening |
| A8 Citizens | [BFF] lazily, at each citizen's first BFF sign-in | resolution order: link → managed → legacy-by-verified-phone (`account-links.ts:197-240`). Mobile KC→DIGIT; name DIGIT→KC (placeholder rule) | an ambiguous match → `CITIZEN_ACCOUNT_AMBIGUOUS`, resolved through the admin citizen link route. **No bulk citizen import:** legacy citizens who never sign in through the BFF never get a KC user, by design |
| A9 `kcbff-` clean-out (D13) | [OPS] + [HRMS] | unused → HRMS/egov deactivate (an ops DIGIT write, not the BFF) and remove A8/R2. **Used** (onboarded tenants whose founder is `kcbff-`) → no path in the design | GAP-27 |
| A10 Projection off | [BFF] item 14 | stop the KC→DIGIT role projection, and stop the BFF writing `active` (`reconciliation-service.ts`, `managed-account-service.ts:470-481`) | F §13 already orders item 14 (step 5) before item 12 (step 6). The mirror must not start while the projection still writes |

### 2(b) Onboarding a new tenant (PGR saga, F §5)

| # | Step (owner) | What is synced, in which direction | Failure handling |
|---|---|---|---|
| B1 | Signup (founder authenticates through KC magic link or IdP) [BFF] | KC user with `firstName`/`lastName` from the signup form (`organization-service.ts:866-963`). PGR row `owner_subject` = KC sub | magic-link redo. Profile writes only on BFF-created drafts |
| B2 | `sessions/_introspect` [PGR→BFF] | `{subject, email, name}` → PGR. **`email` is returned even when unverified** (`B/control-plane/routes.ts:295-311`) | GAP-26 |
| B3 | Tenant foundation + `PLATFORM_BASELINE` [PGR] | MDMS tenant, `ACCESSCONTROL-ROLES` incl. every founder role, role-actions, encryption key, department, designation, root boundary (F §5 prerequisite) | retryable per step. `restartNo` only on terminal resubmit |
| B4 | Founder via HRMS `_create` [PGR] | **seed KC→DIGIT once:** name (from introspect), email (**only if verified**, GAP-26), mobile (signup form, `B/onboarding/worker.ts:55-72` today), roles (founder role set; `SUPERUSER` per D11). HRMS generates a native password **and sends it by SMS** (H9) | PGR searches HRMS before `_create`, so a retry reuses the uuid (F §5) |
| B5 | `organizations/_ensure` [PGR→BFF] | Organization `name`, `digit.urlSlug`, `digit.rootTenantId`, `digit.operationId/restartNo/operationHash`, `digit.lifecycle=PROVISIONING` | op → tenant → slug locks. 409 / `ATTEMPT_STALE` |
| B6 | `memberships/_ensure` [PGR→BFF] | Organization membership. **No role projection** | idempotent |
| B7 | `bindings/_ensure` [PGR→BFF] | `digit.bindings` active + `digit.boundUuids`. PROPOSED in the same lease:<br>• derived credential → egov-user + `credential.keyVersion` (GAP-13);<br>• logout-once of the HRMS-era token (GAP-14);<br>• first `digit.accounts` entry (GAP-39), whose name D12 then mirrors back to KC | same key, different uuid → `BINDING_CONFLICT` |
| B8 | `_lifecycle ACTIVE` [PGR→BFF] | Organization visible to routing, discovery and `_select` | PGR replays until acknowledged. `FAILED` only on terminal abandonment |
| B9 | First `_select` [BFF] | live DIGIT `active`, D10 predicate, issuance. Mirror pass | typed `ACCOUNT_LOCKED` / `ACCOUNT_INACTIVE` |
| B10 | Restart with a different founder [PGR] | `memberships/_remove` (previous founder: membership + binding). **The previous founder's HRMS/DIGIT account stays active** | GAP-21 (who deactivates it: PGR via HRMS) |

### 2(c) Operations

| Event | Origin | Sync actions (order) | Owner / trigger | Today vs target | GAP |
|---|---|---|---|---|---|
| Staff sign-in + `_select` | KC login | subject lease → revgen check → D10 predicate (enabled, active binding, membership) → live DIGIT `active` → cached token validate or mint (derived credential; repair once) → mirror pass for this entry | BFF | today: linked = link only + live active, no membership check (`routes.ts:138-152`); managed = KC→DIGIT role sync then mint (`:155-181`). Password rotated at every mint | GAP-11 |
| Citizen sign-in + `_select` | KC/phone OTP | phone lock → resolution (link → managed → legacy) → **mobile KC→DIGIT from a fresh KC read** → OTP grant → mirror pass | BFF | today the source is the session claim (`routes.ts:240-247`) | GAP-33 |
| Reconcile (periodic) | BFF timer | for each subject with A1/A2 entries:<br>• read DIGIT;<br>• mirror roles, active and name (D12) to KC;<br>• role change or **active→false** → revoke tokens (GAP-08);<br>• compare DIGIT emailId/mobile with the KC verified values and re-propagate (GAP-01);<br>• missing account → flag (GAP-23);<br>• Organization disabled/FAILED or tenant inactive → revoke (GAP-29) | BFF every N s (300 s today, `A/server.ts:34`) | today: KC→DIGIT projection for `kcbff-` only | GAP-08/09/23/29 |
| HRMS edit: name, email, mobile | HRMS UI | HRMS `_update` → egov-user (overwrites as sent) → next reconcile mirrors the name to KC. **Email:** KC wins at the next compare (GAP-01). **Staff mobile:** DIGIT only | HRMS, then BFF | none today | GAP-01 |
| HRMS role change | HRMS | egov-user roles → reconcile mirror → revoke the cached token (old principal) → next `_select` mints with the new roles | BFF | today linked tokens keep the old roles until expiry or logout | — (in design) |
| HRMS deactivate / reactivate | HRMS | egov-user `active` → `_select` refuses (`ACCOUNT_INACTIVE`) → reconcile mirrors `active` and **revokes** (GAP-08). Binding and membership kept. Reactivation restores access with no KC write | HRMS, then BFF | — | GAP-08, GAP-22 |
| Profile edit in digit-ui | DIGIT `/profile/_update` | DIGIT-owned fields → DIGIT only; name → mirrored to KC at the next pass. Identifiers (email, mobile) **read-only in the UI** (F §12) | DIGIT, then BFF | today digit-ui can edit email; `nullifySensitiveFields` blocks only mobile, password, roles and active (`User.java:196-206`) | GAP-01 |
| CSR files a complaint for a citizen | PGR | PGR `upsertUser` searches **`userName` = mobile**, renames on a name mismatch, sets `active=true`, or **creates a new legacy citizen** (`PG/service/UserService.java:73-96,140-160`) | PGR | causes duplicates with `kcbffc-`, renames that mirror into KC, and complaints attached to the wrong person after a phone change | GAP-05 |
| KC self-service (`UPDATE_PASSWORD`, TOTP, `delete_credential`, `idp_link`, provider `_unlink`) | KC | no DIGIT effect. A password change revokes the other sessions (F §6) | KC, BFF poller | — | — |
| Email change (`UPDATE_EMAIL`) | KC | event (`UPDATE_EMAIL`, **and `VERIFY_EMAIL`**) → for every staff entry, emailId KC→DIGIT through the safe writer. Citizens: none | BFF poller + reconcile | event type list lacks `VERIFY_EMAIL` (S §2.4) | GAP-40, GAP-36 |
| Phone change (citizen) | BFF step-up + change | phone lock → KC `phoneNumber` → for **each** citizen entry (per state root): DIGIT mobile (country split per root) → invalidate sessions with the old number. Uuids kept | BFF | not implemented | GAP-18, GAP-19 |
| Role change in KC Organization groups | KC admin | target: **no effect** (D1). Today it changes DIGIT roles for `kcbff-` within 300 s | — | — | GAP-31 |
| KC disable / delete / logout-all / credential change / membership removal | KC | poller → revoke tokens + sessions; revgen bump. Nothing is written to DIGIT | BFF | today only phone-OTP sessions notice a disable (60 s) | — (in design) |
| DIGIT-side native password change or OTP reset | digit-ui Change Password, `/password/nologin/_update` | the derived credential breaks → repair on the next issuance (invalid credentials). Meanwhile the person (or whoever holds the employee's mobile) has native DIGIT access | — | — | GAP-15 |
| Failed native logins on a bound employee code | anyone hitting egov-user `/oauth/token` | `accountLocked` → BFF `ACCOUNT_LOCKED` for 60 min | — | — | GAP-16 |
| MDMS tenant rename / deactivate | MDMS | name: none (Organization name is an internal label). Deactivate: routes vanish (`isActiveDigitTenant`); revoke at reconcile (GAP-29) | — | — | GAP-29, GAP-30 |
| Invitation not accepted | — | pending binding holds the uuid indefinitely | — | — | GAP-38 |

### 2(d) Offboarding

| Action | KC after | BFF after | DIGIT after | Left behind / GAP |
|---|---|---|---|---|
| Workspace member removal (`_remove`, CFG) | binding `removed` (tombstone), uuid released, membership removed | tokens and sessions for that tenant revoked; `digit.accounts` entry dropped by reconcile | **unchanged:** HRMS employee active, roles intact, derived password set (unknown to anyone) | PGR can still assign complaints to them; the native reset path can reopen DIGIT access. **GAP-21:** CFG removal = HRMS deactivate **and** `_remove` |
| HRMS deactivation | unchanged (binding and membership kept) | `_select` refuses; reconcile revokes (GAP-08) | `active=false`; native tokens **not** purged by egov-user | intentional: reactivation restores access. Discovery display (GAP-22) |
| PGR restart with a different founder (`memberships/_remove`) | old founder: membership + binding removed | revoked | old founder HRMS active | GAP-21 |
| KC user disabled | `enabled=false`; everything kept | revoke all; re-enable restores (F §11) | unchanged | — |
| KC user deleted (staff) | user, attributes, bindings, `boundUuids` **gone** (no tombstone) | revoke on the DELETE event | unchanged, active | uuid is re-bindable at once; the DIGIT account is orphaned and active. GAP-37 + GAP-21 |
| KC user deleted (citizen) | gone | revoke (only what is inventoried; citizen tokens unrecoverable after Redis loss, F §6) | `kcbffc-` / legacy CITIZEN stays active with PII and complaints | re-signup with the same phone creates a **second** `kcbffc-` account and splits the history (GAP-20). PII retention policy undefined |
| Citizen "block" (D6) | disable the KC user | revoke | unchanged | — |
| Admin citizen unlink (`block`) | link removed + block | `dropLinkedLogin` (`account-links.ts:181`) | unchanged | the next sign-in creates a `kcbffc-` (managed) account for the same phone → a duplicate DIGIT citizen (GAP-42) |
| `kcbff-` clean-out (D13) | A8 removed | R2 removed | deactivated by ops | used accounts: GAP-27 |
| Organization FAILED / disabled / tenant removed | Organization stays; hidden | routing hides it; **no revocation rule** | tenant data stays | GAP-29 |

---

## 3. Non-user state that must stay consistent

### 3.1 Tenant ↔ Organization

| Fact | DIGIT side | KC side | Owner | Dir | Trigger | Drift / rule |
|---|---|---|---|---|---|---|
| tenant id | MDMS `tenant.tenants.code` | Organization `digit.rootTenantId` (`organization-service.ts:737-842`); groups `digit.tenantId` | PGR / ops (DIGIT) | DIGIT→KC at `_ensure`/backfill | create | `withoutCollisions` drops both mappings on a duplicate (S §2.1). Absent `digit.lifecycle` = ACTIVE |
| URL slug | PGR `url_slug`, `eg_pgr_onboarding_identifier` | `digit.urlSlug` (lower-case) | PGR request → BFF | PGR→KC | `_ensure` | changeable only while PROVISIONING/FAILED (new Organization, the old one FAILED + renamed, S Q3) |
| display name | MDMS tenant name | Organization `name` (realm-unique) | **DIGIT** (PROPOSED) | DIGIT→KC **at creation only** (`backfill.ts:54`) | — | GAP-30: no ongoing sync. Display must read MDMS, not the Organization name |
| account code | PGR `ACCOUNT_CODE` identifier | `digit.accountCode` | PGR | — | — | S Q9 open |
| lifecycle | PGR operation `lifecycle_decision` | `digit.lifecycle` (+ `lifecycleRestartNo`) | PGR | PGR→KC, replayed until acknowledged | saga end | F §5 |
| enabled | MDMS tenant active (`isActiveDigitTenant`) | Organization `enabled` | each its own | none | — | GAP-29: either one false must revoke at reconcile |
| subtenant mapping | MDMS city tenants | Organization groups with 7 attributes (S §2.2) | ops | — | `tenant-groups/_ensure` (deleted, D15) | S Q10 (read path stays) |
| fork tables | `eg_identity_organization` (egov-user fork only) | — | — | none | — | GAP-32 |

### 3.2 Roles catalogue

| Item | Where | Rule |
|---|---|---|
| Role definitions | MDMS `ACCESSCONTROL-ROLES.roles` per tenant (seeded by the baseline, `B/onboarding/tenant-foundation.ts:154-213` today, PGR target) | DIGIT-only. egov-user rejects undefined roles (`INVALID_ROLE` → `TENANT_ROLES_MISSING`, `routes.ts:53-61`) |
| Role-actions | MDMS `ACCESSCONTROL-ROLEACTIONS` | DIGIT-only |
| Role assignment | egov-user `eg_userrole_v1` (written by HRMS) | authority (D1) |
| Mirror | `digit.accounts[].roles` | opaque `{code, tenantId}`. No catalogue in KC (F §1) |
| Legacy KC catalogue | `digit-ui` client roles + Organization role groups; `DIGIT_MANAGED_ROLE_ALLOWLIST` (`I/config.ts:244-247`); `ONBOARDING_TENANT_ADMIN_ROLES` incl. retired `TENANT_ADMIN` (`:234-237`) | deleted (D1, D15). Leftover groups and mappings need a clean-up (GAP-31) |
| Fork allowlist | `identity.allowed.role.codes` (`UP:114`, fork only) | GAP-32 |
| Admin authority | DIGIT `ACCOUNT_ADMIN` on the caller's account at the tenant (D5) | role-tenant semantics (GAP-24) |

### 3.3 Membership vs HRMS assignment and jurisdiction

| Concept | System | Meaning | Sync |
|---|---|---|---|
| Organization membership | KC | may sign in to the workspace (D10) | none to DIGIT |
| Binding | KC attribute | which DIGIT account the person uses at that tenant | BFF-owned |
| HRMS employee `isActive` | HRMS → egov-user | employed | DIGIT→KC mirror (`active`) |
| HRMS assignments (department, designation) | HRMS | org placement; PGR routing | none (read live) |
| HRMS jurisdictions | HRMS | PGR visibility scope (boundary, tenant) | none. **Jurisdiction ≠ membership**: an employee can have jurisdiction at tenants where they hold no binding. A jurisdiction change never touches KC |
| Organization group membership | KC | subtenant routing (legacy) | D10 uses Organization membership only (GAP-25) |

**Invariants (PROPOSED, checked by reconcile and reported, not auto-fixed):**
- I1: an active binding ⇒ membership in the owning Organization.
- I2: an active binding ⇒ an HRMS record exists for the uuid (PGR scoping).
- I3: a removed binding ⇒ the HRMS employee is inactive within N days (GAP-21; report only).
- I4: at most one live owner per uuid.

### 3.4 Citizen registrations per root

| Fact | Where | Rule |
|---|---|---|
| citizen account | egov-user CITIZEN at `digitCitizenTenantId` = first dotted segment (`managed-account-service.ts:196-198`) | **one per state root per person** (GAP-17 terminology) |
| KC record | today `digit.citizenRegistrations` per *route* tenant with ACTIVE/DISABLED (`citizen-registration.ts:16-45`) | fold into a `digit.accounts` citizen entry per state root. D6 removes `DISABLED` |
| phone rule | MDMS `MobileNumberValidation` per tenant (`routes.ts:217-231`) | the verified phone must pass each root's rule (GAP-18) |
| OTP | egov-otp `eg_token` (minted by the BFF at `/otp/v1/_create`) | transient |
| ambiguity | several CITIZEN rows with one mobile at a root | fail closed `CITIZEN_ACCOUNT_AMBIGUOUS`; admin citizen link. Kept (F §8) |
| duplicates created by PGR | CSR flow | GAP-05 |

### 3.5 Other cross-system state

- PGR onboarding rows: `owner_subject` (KC sub) and `founder_digit_uuid` (S §5.2) must match the binding written by `bindings/_ensure`.
- Encryption keys per tenant (`egov-enc`): must exist before any egov-user write for that tenant (baseline).
- DIGIT token stores (egov-user Redis) vs the BFF inventory (S N3/N4): GAP-14.
- Session records (BFF) vs KC sessions: revgen (F §6).

---

## 4. GAPs

Each GAP is **PROPOSED**. "BFF code" = needs code in `backend/identity-bff`; otherwise it is config, PGR, configurator, digit-ui or ops.

| # | Gap (today / design) | Proposed rule | BFF code |
|---|---|---|---|
| GAP-01 | **Staff email has three DIGIT writers.** HRMS `_update` (`H/EmployeeService.java:351-354`) and digit-ui `/profile/_update` both write `emailId` as sent, and the BFF propagates the KC email only on triggers (F §4). A stale HRMS form silently reverts it; nothing detects it | KC is authoritative for a bound staff account's `emailId` **only while `emailVerified=true`**. Reconcile **compares** DIGIT `emailId` with the KC verified email for every staff entry and re-propagates (drift-based, not only event-based). It never clears DIGIT `emailId` when KC is unverified or empty. CFG/HRMS form and digit-ui profile make `emailId` read-only for bound accounts | yes (reconcile compare) + CFG/UI |
| GAP-03 | **Name direction flips at adoption, and the seed direction is unspecified.** Today the name goes KC→DIGIT (`subject-sync.ts:39`, `routes.ts:244`); the target is DIGIT→KC. F does not say where a new DIGIT account's name, or a `_link`-created KC user's name, comes from | Seed rule: at **DIGIT account creation** the name comes from KC (founder HRMS payload, `kcbffc-` create). At **KC user creation by `_link`** it comes from DIGIT. Afterwards the DIGIT→KC mirror only. The first mirror on adoption overwrites KC names: announce it | yes (`_link` create body) |
| GAP-04 | **Citizen names mirrored into KC are often junk**: the placeholder `"Citizen"` (`routes.ts:244`, `organization-service.ts:1015-1020`), or a CSR-typed name (GAP-05). D12 picks the lowest `boundAt`, which can be a citizen entry for a staff person | D12 primary = the oldest **active staff** entry, else the oldest active citizen entry. For citizen-only persons, mirror the DIGIT name only when it is not the placeholder, or when KC has no name | yes |
| GAP-05 | **PGR CSR flow** (`PG/service/UserService.java:73-96,140-160`) looks citizens up by `userName` = mobile:<br>• it never finds `kcbffc-` accounts → creates a **duplicate legacy citizen**;<br>• it finds a phone-changed LC by the **old** number → files to the wrong person;<br>• it **renames** and re-activates on a name mismatch | PGR `upsertUser`:<br>• search by `mobileNumber` at the state root;<br>• exactly one active CITIZEN (including `kcbffc-`) → use it;<br>• never rename;<br>• never set `active`;<br>• create only when none exists | no (PGR, vendored) |
| GAP-06 | **Name mapping is lossy or unsafe:** Q11 split unresolved; `lastName` required → `VERIFY_PROFILE`; a masked DIGIT name (`****`) would be mirrored into KC (the masked check exists only for writes, `managed-account-service.ts:158`) | `firstName` = the whole DIGIT name, `lastName` = `""`, with `lastName` not required for any role (avoids split ambiguity). The mirror skips any value matching `\*{2,}`; `/readyz` asserts an unmasked admin read | yes + realm config |
| GAP-07 | **IdP mappers and IdP phone are unspecified.** The Google IdP can FORCE-sync first name, last name and email at every login, fighting the mirror. F §4 lists an "IdP-linked phone" as a KC→DIGIT source, while F §8 makes the BFF OTP the only phone authority | every IdP mapper uses `syncMode=IMPORT`; IdP email counts as verified only with `trustEmail`; an IdP never sets `phoneNumberVerified`. Drop "IdP-linked phone" from the F §4 trigger list | no (realm config + design text) |
| GAP-08 | **DIGIT deactivation does not revoke.** F §6 revokes on a role change only; egov-user does not purge tokens on `active=false` (`UserService.java:402-424`), so a cached token keeps working until it expires | reconcile revokes inventoried tokens when the mirrored `active` flips true→false (same path as a role change). `_select` already refuses | yes |
| GAP-09 | **Reconcile SLA and skip key are undefined** for HRMS-originated changes | SLA = the reconcile interval (default 300 s, `A/server.ts:34`), published on `/readyz`. Skip-unchanged key = egov-user `lastModifiedDate` + the `digit.accounts` fingerprint (S "mirror-fp") | yes |
| GAP-10 | **Today's managed writer wipes DIGIT profile data.** `editable()` sends 12 fields (`managed-account-service.ts:328-343`), so every managed write (a token mint rotates the password, `:546`) resets `gender`→0 and `locale`, `photo`, `salutation`, `signature`, `pan`, `aadhaarNumber`, `altContactNumber`, `alternatemobilenumber`, `guardian`, `relationship` → null (`UR:229-328`). This hits `kcbff-` founders on live boxes now | until D13, route managed writes through the safe writer's field map (S §6), or stop per-login rotation for managed accounts in item 7 as well as for linked ones | yes |
| GAP-11 | **Link → binding migration and membership have no code.** `account-links/_link` never grants membership (`control-plane/routes.ts:124-170`); linked-staff `_select` skips the membership check (`routes.ts:138-152`). Ops job (a) iterates "active bindings", which do not exist yet | one-time, idempotent BFF job (2(a) A3): `digit.accountLinks` → `digit.bindings` + `boundUuids` + membership in the **owning** Organization + `digit.accounts` entry. Run on every box before D10 is enforced; item 14 deletes it | yes (one-time) |
| GAP-12 | **Employees without email cannot be adopted:** `_link` keys on email (F §5) | the admin supplies an email at link time. It reaches DIGIT only after KC verification (GAP-01). CFG shows "no email" employees as not linkable | no (CFG) |
| GAP-13 | **Credential timing for pending bindings:** "set at binding" (F §6) would kill the native password of someone who has not accepted | the derived credential is written only when a binding enters `active` (new-user `_link`, `_accept`, `bindings/_ensure`, migration at first issuance). Never at `pending` | yes |
| GAP-14 | **Native tokens survive adoption:**<br>• native access tokens last 7 days (`UP:42`) and refresh tokens 14 days (`UP:43`);<br>• egov-user hands the BFF's grant the **same** live token, so native and BFF sessions share it;<br>• `/_logout` removes only the access token (`LogoutController.java:36`), so a refresh grant mints new tokens outside the inventory | at binding activation: set the credential, grant once, `/_logout` that token ("logout-once"), then mint. Refresh tokens become a documented limit in F §6, plus deployment hardening (block `refresh_token` and `password` grants for bound EMPLOYEE accounts from non-BFF clients at Kong) | yes (logout-once) |
| GAP-15 | **Native password paths bypass KC:**<br>• digit-ui Change Password;<br>• `/password/nologin/_update` (OTP to the employee's DIGIT mobile);<br>• the HRMS create SMS with a generated password (`H/EmployeeService.java:123-126,246-252`).<br>Each gives DIGIT access outside the D10 predicate, and the repair later overwrites it silently | make hardening a **prerequisite** for declaring D10 enforced (not "tracked separately"):<br>• block these endpoints for bound EMPLOYEE accounts;<br>• disable the HRMS password SMS on BFF tenants;<br>• remove Change Password from digit-ui (already F §12) | no |
| GAP-16 | **Lock-out DoS:** anyone can lock a bound employee for 60 min (`UP:59`) by failing native `/oauth/token` with their code. The BFF must not unlock | same hardening as GAP-15. The BFF never writes `accountLocked`/`accountLockedDate` (make that explicit in F §1 "never") | no |
| GAP-17 | **Citizen "root" is ambiguous:** F §3 says "per root tenant", but egov-user's citizen tenant is the first dotted segment, while the Organization `rootTenantId` can be dotted (`managed-account-service.ts:185-198`) | freeze in item 0: citizen entries are keyed by `digitCitizenTenantId`, one per state root; route tenants are not stored (D6) | yes (item 0 schema) |
| GAP-18 | **Phone change across roots with different rules:** a new number may fail one root's `MobileNumberValidation` | per-root outcome. A failed root keeps its old number and marks `phoneStale:true` on its entry. That root's citizen `_select` returns `PHONE_NOT_VALID_FOR_TENANT`. Reconcile retries | yes |
| GAP-19 | **Legacy citizen `userName` = old mobile** is immutable (`UR:205`). After a phone change the old number stays the username: native or CSR lookups by `userName` find the moved person, and native registration of the old number by its new owner fails | allow a phone change for such LC accounts only after GAP-05 lands. Record `legacyUserNamePhone` on the entry for audit. Login is unaffected (OTP checks the stored mobile, `U/domain/service/UserService.java:384-392`) | yes (guard) |
| GAP-20 | **Citizen re-signup after KC deletion** splits history: the old `kcbffc-` account is excluded from legacy resolution (`account-links.ts:213`), so a new `kcbffc-` account is created with the same mobile | a `kcbffc-` account whose marker subject no longer exists in KC and whose mobile equals the verified phone is adoptable by the new subject (audited, origin `managed-adopted`) | yes |
| GAP-21 | **Offboarding leaves DIGIT staff active.** `_remove`, `memberships/_remove` and KC delete never touch DIGIT (D4), so PGR keeps routing work to them and the native reset path reopens access | CFG "Remove member" = HRMS deactivate (first) + `_remove`; PGR founder replacement deactivates the old founder through HRMS. Reconcile reports I3 violations. The BFF still never writes `active` | no (CFG/PGR) + report |
| GAP-22 | **Discovery for HRMS-inactive staff** is unspecified (hide, or show as inactive) | show the tenant with `code: ACCOUNT_INACTIVE` (from `digit.accounts.active`), so the person sees why and an admin can reactivate | yes (small) |
| GAP-23 | **DIGIT account missing** (uuid not found, e.g. after a box data reset) | reconcile marks the entry `missing:true` and revokes; never removes the binding (F §4: reconcile never removes or creates bindings); shown in the CFG member list | yes |
| GAP-24 | **D5 role tenant semantics:** a DIGIT role carries its own `tenantId` | D5 = `ACCOUNT_ADMIN` with `role.tenantId` ∈ {workspace tenant, its state root}, on the caller's **active binding** account at that tenant, read live | yes (item 9) |
| GAP-25 | **Binding tenant vs route tenant vs membership:** HRMS employees often live at a city tenant below the Organization's root. `_select` demands `boundTenant.tenantId === tenantId` (`routes.ts:129`), and D10 says "membership there" | a binding's tenant must be the route's tenant or a tenant mapped under the same Organization. D10 membership = the **owning Organization** (group membership ignored, D15). `_link` validates this | yes |
| GAP-26 | **Founder email from introspect is unverified-capable** (`control-plane/routes.ts:300-310`) | `_introspect` returns `emailVerified`; PGR sets HRMS `emailId` only when it is true | yes (tiny) + PGR |
| GAP-27 | **D13 has no path for *used* `kcbff-` accounts** (founders of onboarded tenants, with assignments and audit on that uuid); `isBffManagedAccount` forbids linking them | (i) unused → deactivate (ops) and drop. (ii) used, no open work → create an HRMS founder, bind it, deactivate the `kcbff-` account through ops. (iii) used with open work → a migration binding of the marker-owning subject to its own `kcbff-` uuid (`createdBy.kind=migration`), accepting the missing HRMS record until reassigned | yes for (iii) |
| GAP-29 | **No revocation for Organization disable/FAILED or MDMS tenant deactivation**: routing hides them, but cached tokens live on | reconcile revokes tokens of bindings whose Organization is disabled or not ACTIVE, or whose DIGIT tenant is inactive | yes |
| GAP-30 | **Organization name vs MDMS tenant name** never re-sync (`backfill.ts:54`) | MDMS is the display authority. The Organization `name` is an internal label; no sync. Confirm that no KC theme or picker shows the Organization name | no |
| GAP-31 | **Leftover KC role catalogue** (assignment groups `<g>--<uid>`, `tenant-admins`, `employees`, `digit-ui` client roles) remains after D1/D15 | after item 9 (D5 switched) and item 14: a one-time ops clean-up. A test asserts that nothing reads KC groups for authorization | no (ops) |
| GAP-32 | **egov-user fork** `feat/keycloak-identity-exchange` adds `eg_identity_subject`, `eg_identity_organization` and `eg_identity_membership` (`U/identity/IdentityRepository.java`): a parallel KC↔DIGIT store. D8 forbids it | confirm per box that the deployed egov-user image is stock. If the fork tables exist, they are frozen and excluded from every sync | no (ops check) |
| GAP-33 | **Session claims used as a write source** (citizen phone `routes.ts:240-247`, managed sync `:162-166`, citizen name `:244`) | general rule: every DIGIT or KC write is sourced from a **fresh KC read under the subject lease**. Session claims are for display only | yes |
| GAP-36 | **KC username keeps the old email** after `UPDATE_EMAIL`, so a re-invite with the old email creates a second KC user | `_link` find-by-email also matches `username` and refuses with `IDENTITY_EMAIL_CHANGED` when the username matches a different current email | yes (small) |
| GAP-37 | **Staff KC deletion leaves no tombstone and no audit trail** of the released uuid | the poller's DELETE handler writes an audit record (subject, released `tenant\|uuid`) to the identity audit stream before revoking | yes (small) |
| GAP-38 | **Pending invitations never expire** and hold the uuid reservation | a pending binding expires after N days (PROPOSED 14) → `removed` (tombstone) by reconcile, releasing `boundUuids`. Expiry is not "creating or restoring", so F §4 holds | yes |
| GAP-39 | **`digit.accounts` is written only at `_select` or reconcile**, so a fresh binding has no entry: discovery and the D12 profile are empty until then | binding activation (all paths) runs one synchronous, best-effort mirror pass for that entry | yes |
| GAP-40 | **Email events incomplete:** `VERIFY_EMAIL` is not in the event list (S §2.4), and KC-admin email edits arrive as admin `UPDATE` events | add `VERIFY_EMAIL`; handle admin user-update events that change `email`/`emailVerified`. GAP-01's reconcile compare is the backstop | yes + realm config |
| GAP-42 | **Duplicate citizen accounts per root:** an admin citizen link while a `kcbffc-` account exists silently wins (`account-links.ts:205-206`), orphaning the managed history; unlinking with `block` makes the next sign-in create a new `kcbffc-` account | the admin citizen link requires `replaceManaged:true` when a `kcbffc-` account exists for that root, and records it in `origin`. The managed account's entry is dropped; the DIGIT account is left for an admin. Unlink without relink returns 409 if a managed account would be created | yes |
| GAP-43 | **`locale` direction conflict:** F §4 mirrors DIGIT→KC; S Q12 proposes leaving it out. DIGIT `locale` defaults to `en_IN` and is wiped by managed writes (GAP-10) | v1: **none**. KC `locale` stays KC/user-owned (login page language); DIGIT `locale` stays DIGIT-owned. Amend F §4. Revisit only with realm i18n and an explicit map | no (design text) |

GAP numbers 02, 28, 34, 35 and 41 were folded into other rows or found consistent with the design (02 → GAP-01; 28 → F §13 order is correct; 34 → item 15; 35 → staff phone deliberately `none`, U11; 41 → D4 already covers DIGIT-inactive citizens).

**Total: 38 GAPs** (28 need BFF code).
