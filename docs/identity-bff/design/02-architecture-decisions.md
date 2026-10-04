# Architecture decision records: Identity BFF completion

These records back revision 6 of `IDENTITY-BFF-BOUNDARY-FREEZE.md`. Each one gives:
- **Decided by:** "owner" (Kanav, in chat) or "design" (proposed by me or the reviewers, accepted with the revision);
- **Round:** where the decision came from (audit, or review round R1–R5);
- the alternatives rejected, the consequences, and what would make us revisit it.

Review rounds:
- **R1** (rev 1): Astra and Fable
- **R2** (rev 2): Opus and Codex
- **R3** (rev 3): Astra and Fable
- **R4** (rev 4): Astra and Fable
- **R5** (rev 5): Astra and Fable

---

## A. Scope and framing

### ADR-00 What "done" means
- **Decision:** "No more BFF code for this category" is a test of **completeness**. The BFF is done when it offers a stable API contract for the system as it is today: low complexity, modular, every path covered by executed tests, and confined to `backend/identity-bff`.
- **Decided by:** owner, 10-03.
- **Rejected:**
  - a literal "never change BFF code";
  - a generic platform that can absorb any future change.
- **Consequences:** a new identity capability (§9's "holds within" column) is a legitimate reopen. So is DIGIT3.
- **Revisit if:** the product adds a context kind other than staff or citizen.

### ADR-01 No changes to egov services
- **Decision:** egov-user, HRMS, egov-otp and the rest are untouched. Everything is fixed in the BFF, in our apps (PGR, configurator, digit-ui) or in deploy config.
- **Decided by:** owner, 10-03.
- **Rejected:** patching egov-user for:
  - token purge on deactivation;
  - partial (field-level) updates;
  - gateway-level trust hardening (tracked separately);
  - checking the OTP on password reset.
- **Consequences:**
  - the documented limits in §6;
  - every DIGIT write is a read-modify-write of the whole record;
  - the derived staff credential (ADR-20);
  - a small race with concurrent HRMS edits is accepted.
- **Revisit if:** an egov-user change becomes unavoidable for correctness.

### ADR-02 Storage stays in Keycloak attributes + Redis
- **Decided by:** owner, 10-03.
- **Rejected:** a BFF-owned Postgres schema for bindings, tombstones, a token journal and receipts (Codex R2).
- **Consequences:**
  - if Redis is lost, citizen tokens, inactive or locked staff tokens, and tokens of a Keycloak user deleted in the same window live until they expire (≤ 7 days);
  - active staff are recovered through the derived credential.
- **Revisit if:** a Redis loss incident happens, or compliance requires revocation guarantees.

### ADR-03 DIGIT3 is a planned reopen, not a config flip
- **Decided by:** design R1, confirmed by the owner (the sync runs as a BFF module).
- **Rejected:** an authority-map engine whose direction can be flipped by config (Astra R1 B8, Fable R1 S3).
- **Consequences:** a one-time, versioned migration (§7). It is blocked on the DIGIT3 identity design (O3).

### ADR-04 Deployment hardening is out of scope here
- **Decision:** exposure of the legacy egov-user endpoints is tracked separately with the owner of the 8c box.
- **Decided by:** owner, 10-03.
- **Consequences:** this plan's guarantees assume no token is minted for a bound account outside the BFF. ADR-02's limits cover the exceptions.

---

## B. Ownership

### ADR-10 Roles are owned by DIGIT and mirrored to Keycloak (D1)
- **Decided by:** owner, 10-01: "HRMS may own the staff roles but they have to be synced; DIGIT3 moves roles to Keycloak."
- **Rejected:**
  - Keycloak owns grants and projects them to DIGIT. This is today's code. `_invite` creates no HRMS record, so PGR scoping fails closed.
  - Organization-group roles in Keycloak. They apply to every member and lose each role's tenant (Fable R1 B2).
- **Consequences:**
  - the role projection, the allowlist, `role-assignments/_ensure` and `_invite` are deleted;
  - the mirror is the `digit.accounts` attribute, one entry per account, keeping each role's tenant.

### ADR-11 Onboarding runs in PGR (D2)
- **Decided by:** owner, 10-01.
- **Rejected:** the BFF worker running a step manifest; `PLATFORM_BASELINE` inside the BFF (as #2169 is written today).
- **Consequences:**
  - the BFF exposes identity primitives only (§5);
  - the provisioner credential leaves the BFF;
  - #2169 must be rescoped.

### ADR-12 DIGIT owns the descriptive profile; Keycloak owns identifiers (D3)
- **Decided by:** owner, 10-01: "may own but keep it synced".
- **Consequences:**
  - name and locale are mirrored DIGIT→Keycloak and are user-read-only in the realm;
  - the phone (citizens) and email (staff) are written Keycloak→DIGIT;
  - #2208 is rescoped.

### ADR-13 Access is two switches combined with AND; the BFF never flips either (D4)
- **Decided by:** owner, 10-01: "Reactivation happens via whichever side deactivated."
- **Consequences:**
  - the BFF never writes DIGIT `active`;
  - an HRMS deactivation, or a Keycloak disable or membership removal, is each enough to block access;
  - each side's own admin reverses it.

### ADR-14 Organization admin = live DIGIT `ACCOUNT_ADMIN` (D5)
- **Decided by:** owner, 10-03 ("agree if there are no existing roles that fulfil it"); `ACCOUNT_ADMIN` already exists.
- **Rejected:** a new `TENANT_ADMIN` DIGIT role; keeping the Keycloak-only `TENANT_ADMIN`.
- **Consequences:**
  - this needs code, because today's check reads Keycloak groups (Opus R2);
  - the configurator gets session-authenticated routes;
  - until the `kcbff-` clean-out, the caller is resolved as binding, else managed account (Fable R3 S7).

### ADR-15 No per-city citizen suspension (D6)
- **Decided by:** owner, 10-03: "idk what is citizen suspension". It was explained, then dropped.
- **Consequences:** blocking a citizen = disabling their Keycloak user, which applies to the whole root tenant. This also resolves Astra's R1 B4.

### ADR-16 The sync is a BFF module with explicit projections (D7)
- **Decided by:** owner, 10-03.
- **Rejected:** a separate sync service (Astra R1); a generic engine.

---

## C. Account model

### ADR-20 Staff DIGIT credential is HMAC-derived, never stored
- **Decision:** `password = encode_v1(HMAC(key[keyVersion], "v1" ‖ uuid ‖ tenantId))`.
  - It is set once, at binding or at first issuance.
  - It is repaired at most once per lease, and only on the typed "invalid credentials" outcome.
- **Decided by:** design. Opus R2 proposed it; Fable R3 and Astra R4 refined it.
- **Rejected:**
  - per-login rotation (today's behaviour). It wipes fields and races HRMS edits;
  - an encrypted stored password, which needs a crash state machine (Codex R2);
  - a generation counter (removed in R4).
- **Consequences:**
  - logins write nothing to egov-user;
  - the derivation also serves as a revocation fallback (ADR-41);
  - `encode_v1` must satisfy egov-user's password policy (Fable R3 NB2);
  - the HMAC key and its versions are deploy configuration.
- **Revisit if:** egov-user's password policy changes, or the key is compromised.

### ADR-21 One staff kind: linked accounts created by HRMS
- **Decided by:** design, following from D1 (R1, Fable B1).
- **Consequences:**
  - founders also go through HRMS;
  - existing `kcbff-` managed employees are cleaned out (ADR-24).

### ADR-22 Staff sign-in = active binding AND live Organization membership (D10)
- **Decided by:** owner, 10-03 (Q2-A).
- **Rejected:** a binding alone. Then Keycloak's "remove member" would not revoke access.
- **Consequences:**
  - ops job (a) adds membership for existing bindings on every box;
  - the same predicate is used in discovery, `_select` and revocation.

### ADR-23 The Keycloak profile comes from the first binding (D12)
- **Decided by:** owner, 10-03 (Q4-A).
- **Rejected:** keeping a per-account profile only; last-write-wins, which ping-pongs.
- **Consequences:** `boundAt` orders the bindings; the fallback is the next active one.

### ADR-24 Existing `kcbff-` employees are cleaned out, not migrated (D13)
- **Decided by:** owner, 10-03: "we'll clean them out? no one has used them i think".
- **Consequences:**
  - ops job (b) lists them per box first;
  - the managed branch stays until then (ADR-14).

### ADR-25 Existing Keycloak users must accept invitations (D14)
- **Decided by:** owner, 10-03 (Q6-A, #2122).
- **Consequences:**
  - a `pending` binding with an `invitationVersion`;
  - membership is granted only at accept;
  - `pendingInvitations` appears in `/session`;
  - removal leaves a tombstone, and a re-invite cancels the old version.

### ADR-26 Founders keep `SUPERUSER` for now (D11)
- **Decided by:** owner, 10-03.
- **Revisit:** O1, the role-action check.

### ADR-27 Bindings are keyed without the surface
- **Decision:** `(keycloakSubject, DIGIT account tenant) → uuid`.
- **Decided by:** design (Opus R2 B3).
- **Rules:**
  - one uuid belongs to one person (Redis uuid lock);
  - no self-binding;
  - no binding to an account with roles above the caller's;
  - the workload (PGR) caller skips the actor rules.

---

## D. Onboarding primitives

### ADR-30 Operation ownership with a monotonic `restartNo`
- **Decision:**
  - every workload mutation carries `{operationId, restartNo}` and runs under one operation lock, with validation and mutation inside it;
  - a lower `restartNo` gets `ATTEMPT_STALE`;
  - re-opening matches `digit.operationId` and is allowed from `PROVISIONING` or `FAILED`.
- **Decided by:** design. It went through R2 (operationId), R3 (attemptId) and R5 (Fable NB1/NB2, Astra S1).
- **Rejected:**
  - "adopt only on resume" (R1 B10);
  - an opaque `attemptId`, which has no order;
  - PGR's `attempt` column, which ordinary retries also bump.
- **Consequences:** PGR adds a `restartNo` column that only goes up.

### ADR-31 PGR replays lifecycle publication until it is acknowledged
- **Decided by:** design (Astra R5 B1).
- **Consequences:**
  - PGR keeps a pending-publication state on the operation row;
  - a terminal restart waits until the previous publication is settled;
  - `FAILED` is published only for terminal abandonment.

### ADR-32 Visibility: only `ACTIVE`; a missing lifecycle counts as `ACTIVE`
- **Decided by:** design (Opus R2 B4).
- **Consequences:** existing tenants are unaffected; a failed signup is never visible.

### ADR-33 Payload hash over canonical, normalized fields
- **Decided by:** design (R3, R4, Fable R5).
- **Consequences:** the same `restartNo` with a different payload gets 409. Item 0 freezes the canonical form.

---

## E. Sessions, tokens, revocation

### ADR-40 One per-subject lease orders issuance and revocation
- **Decision:** inside the lease, `_select`:
  1. re-reads the session and compares the revocation generation;
  2. checks the predicate;
  3. returns or mints a token, and records it.

  Session writes are update-only (`SET XX`).
- **Decided by:** design (Opus R2 S4, Fable R3 S1, Astra R4 B4, Fable R5 S1).

### ADR-41 Revocation sources and fallback
- **Decision:**
  - **sources:** Keycloak events (via the poller), reconcile, logout, and DIGIT role changes;
  - **inventory:** kept to the token's actual expiry;
  - **cached-token validation** at `_select`;
  - **fallback:** sign in with the derived credential to find the live token, for active, unlocked staff only;
  - **retry set** in Redis.
- **Decided by:** design (Fable R3 cut 1; limits from Astra R4 B3).
- **Consequences:** the documented limits in §6.

### ADR-42 The Keycloak event poller replaces Keycloak SPIs
- **Decision:**
  - polls the event API in overlapping windows, dedupes by `(time, id)`, keeps its checkpoint in Redis;
  - revokes conservatively if the checkpoint falls outside retention;
  - echo suppression covers only the BFF service account's own mirror-only writes.
- **Rejected:** a Keycloak event-listener SPI (more Keycloak code to maintain).
- **Consequences:** the realm event store must be enabled with enough retention; item 0 includes a probe of the event shapes.

### ADR-43 Changing your own password keeps the initiating session
- **Decided by:** owner, 10-03: "agree".
- **Consequences:**
  - the BFF records the initiating session for `UPDATE_PASSWORD`;
  - the matching event revokes every other session;
  - an unmatched credential change, such as an admin reset, revokes everything.

---

## F. Citizens and self-service

### ADR-50 The BFF owns citizen phone possession (#2189)
- **Decided by:** owner, 09-30 (#2189).
- **Consequences:**
  - delivery goes through `HttpOtpSender` (novu-bridge);
  - one lock per phone covers login, step-up and change;
  - new phone identities get opaque usernames, and existing ones are kept (R5).

### ADR-51 Self-service is Keycloak required actions plus a few BFF routes
- **Decision:**
  - the supported actions are `UPDATE_PASSWORD`, `CONFIGURE_TOTP`, `delete_credential` (second factors only), `UPDATE_EMAIL` and `idp_link`;
  - the BFF adds provider `_unlink` and last-method protection, counting primary methods only;
  - the account console is hidden.
- **Decided by:** design (R1–R5).
- **Consequences:**
  - the employee flow gets a conditional OTP step;
  - our apps get account menus.

### ADR-52 The legacy citizen admin repair routes are kept
- **Decided by:** design (Astra R5 S4).
- **Consequences:** `CITIZEN_ACCOUNT_AMBIGUOUS` stays resolvable by an admin.

---

## G. Deletions and cuts

### ADR-60 Deleted from the BFF
- **Deleted:**
  - the onboarding worker, tenant-foundation and the provisioner credential;
  - `_invite`, the role projection, role `_ensure` and the allowlist;
  - the managed `kcbff-` path;
  - the branding relay (the theme reads public MDMS);
  - `tenant-groups/_ensure` (D15);
  - the permanent backfill route (becomes a one-time deploy job);
  - the staff account-link aliases.
- **Gate:** each deletion happens only after its replacement is deployed on every box.

### ADR-61 Rejected as unnecessary complexity
- **Rejected:**
  - a per-binding issuance epoch, beyond the per-subject revocation generation (Codex R2);
  - a durable identifier-change state machine (Codex R2);
  - the HRMS Kafka trigger;
  - a full mechanical module split;
  - renaming existing phone usernames;
  - a generic sync engine.

---

## H. Open

- **O1:** `SUPERUSER` for founders (ADR-26).
- **O2:** the real, non-fixed citizen OTP run. It is a prerequisite for declaring §0 complete; the owner sets the timing.
- **O3:** the DIGIT3 identity and role design (ADR-03).
