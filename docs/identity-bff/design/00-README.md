# Identity BFF walkthrough pack (for 2026-10-04 morning)

**Goal of the session:** walk the full schema in detail, settle the open choices, and leave with everything item 0 (the frozen contract) needs.

## Files

| File | What it is | Size |
|---|---|---|
| `01-design-boundary-freeze-rev6.md` | The design (revision 6), the source of truth | ~390 lines |
| `02-architecture-decisions.md` | About 35 decision records: what was decided, by whom, what was rejected, the consequences | 300 |
| `03-api-contract.md` | 41 routes (current → target), request/response, status codes, locking, side effects; an error catalogue of 82 codes (37 PROPOSED) | 900 |
| `04-state-schema.md` | Keycloak user, Organization, client and realm state; 23 + 16 Redis key families; session record; PGR DDL; egov-user field map; keys; ER diagram | 700 |
| `05-use-cases-and-flows.md` | 9 actors, 59 use cases, 7 sequence diagrams (Mermaid), use-case × gate coverage | 1170 |
| `06-review-history.md` | Revisions 1–6 and five review rounds; how blockers moved from architecture to contract precision | 25 |
| `07-sync-matrix.md` | Field-by-field Keycloak↔DIGIT sync: 106 fields with owner, direction, trigger and drift handling; adoption, onboarding, operations and offboarding phases; 38 GAPs (28 need BFF code) | 360 |

"PROPOSED" in the files means an agent filled a gap the design leaves open. Those are the things to confirm or override in the session. The diagrams are Mermaid and haven't been rendered yet; open them in a Markdown viewer that renders Mermaid.

## Agenda (about 2½ hours)

| # | Block | Time | Read | Outcome |
|---|---|---|---|---|
| 1 | Recap: boundary, D1–D15, review history | 10m | design §0–§2, `06` | Shared baseline |
| 2 | Decision records: skim, stop only where you disagree | 15m | `02` | Records confirmed or reopened |
| 3 | **State schema** | 45m | `04` §1–§8 | Decisions A1–A8 |
| 4 | **API contract** | 45m | `03` §1–§3 | Decisions B1–B9 |
| 5 | Use cases and flows, gate coverage | 30m | `05` §2–§4 | Decisions C1–C6, gate additions |
| 6 | Wrap-up: the item 0 freeze list, next steps | 10m | this file | Go/no-go for item 0 |

---

## Decisions to make in the session

Each has context, options and my recommendation (★). Source file and question number are in brackets.

### A. Data model (blocks item 0)

**A1. Where binding state lives** (`04` Q1, `03` Q-B4/B5)
- **Context:** bindings need states, an `invitationVersion` and removal tombstones. Each DIGIT uuid must belong to one person. Keycloak can't search inside a JSON attribute.
- ★ A separate `digit.bindings` attribute (the authority) next to the `digit.accounts` mirror, plus a multi-valued `digit.boundUuids` attribute that Keycloak can search to enforce one owner per uuid.
- **Alternative:** a single attribute, with uniqueness enforced only by the Redis uuid lock. This breaks after Redis loss.

**A2. Lease layout** (`04` Q2)
- **Context:** today there are two non-reentrant leases (attribute, per-account), and the design adds a per-subject lease. Deadlocks and double-locking are likely.
- ★ Merge them into one per-subject lease with renewal, and a fixed lock order: operation → tenant → slug → subject → phone → uuid.

**A3. Token inventory key** (`04` Q5)
- ★ Key it by DIGIT account `(tenantId, uuid)`, with TTL = the token's actual expiry, plus a per-subject index for revocation. Keying by person would mix up multi-tenant staff.

**A4. Where `_link`'s resume key comes from** (`04` Q6, `03` Q-B1)
- ★ `requestId = sha256(actor, tenantId, uuid, normalized email)`. It's deterministic, so no client header is needed.

**A5. How `encode_v1` turns the HMAC into a password** (`04` Q7)
- ★ Expand the HMAC with HKDF; pick characters by rejection sampling, so none are favoured; separate the input fields with newlines; freeze test vectors in item 0.

**A6. `tenantId` vs `rootTenantId` in `organizations/_ensure`** (`04` Q8)
- **Context:** self-service signups create independent roots, where the two are always equal.
- ★ Drop `tenantId` from the contract unless you know a case where they differ.

**A7. Mirroring the profile into Keycloak** (`04` Q11/Q12)
- **Context:** DIGIT has a single `name`; Keycloak has `firstName`/`lastName`. DIGIT locale is `en_IN`, Keycloak's is `en`.
- ★ Split the name on its last space, and make `lastName` not required in the realm. Leave locale out of v1 unless realm i18n is enabled.

**A8. Sub-tenants** (`04` Q10, `05` Q3)
- **Context:** D15 deletes `tenant-groups/_ensure`, but bindings can be at a city tenant.
- ★ Membership of the **root** Organization satisfies D10 for any sub-tenant binding, and `_link` accepts a sub-tenant `tenantId`. Keep the read path for existing sub-tenant routes; no new writes.

### B. API behaviour

**B1. Does an HRMS deactivation revoke live tokens?** (`05` Q1)
- **Context:** D4 says DIGIT `active` is one of the two switches, but item 10 only lists Keycloak-side triggers.
- ★ Yes: reconcile revokes when `active=false`. Add it to item 10 and the gate.

**B2. Accepting an invite from digit-ui** (`05` Q2)
- **Context:** an employee-only invitee may never open the configurator.
- ★ Add the same one-call accept step in digit-ui employee login, on `PENDING_INVITATION`.

**B3. Matching a self password change** (`05` Q5)
- **Context:** a TTL window alone mis-handles two open tabs, and an admin reset landing inside the window.
- ★ Match on the Keycloak event's `sessionId` and `clientId` (the surface client), not only on time. An admin event never matches.

**B4. Citizen phone routes** (`03` Q-S3, `05` Q6)
- ★ Extend the existing routes: `citizen/otp/_send|_verify` take `purpose: signin | stepup | change_phone`. No new paths.

**B5. Error envelope** (`03` Q3)
- ★ Keep today's `{code, error}` shape.
  - Keep the existing `DIGIT_ACCOUNT_INACTIVE` name rather than renaming it to `ACCOUNT_INACTIVE`.
  - `callback` never emits DIGIT-side codes; the design text gets corrected.
  - Review the 37 PROPOSED codes as a block.

**B6. PGR's token** (`03` Q4)
- **Context:** the design gives PGR the control-plane token, which also unlocks the operator routes.
- ★ A dedicated onboarding token that can call only the workload primitives. The BFF rejects `_introspect` once the operation is past `IDENTITY_READY`.

**B7. Refresh tokens** (`05` Q7)
- **Context:** the design says the BFF never returns them. The embedded dashboard's refresh may rely on one.
- ★ Keep "never". The dashboard calls `_select` again on expiry. Check the dashboard code before freezing.

**B8. When the founder's credential is set** (`05` Q11)
- ★ Lazily, at the founder's first `_select`. The workload call then does no DIGIT write, which keeps PGR's crash points simple.

**B9. Restarting with a different founder** (`04` Q14)
- **Context:** a signup's owner is unique per Keycloak subject, so a restart can't change the founder unless ownership transfer exists.
- ★ If it can't happen, drop `memberships/_remove` and that gate case. That's a simplification.

### C. Scope and gate

**C1. Citizen and staff on one Keycloak person** (`05` Q4)
- ★ Allowed. Citizen entries are ignored for D12 profile ordering whenever a staff entry exists.

**C2. Defining "unused" for the `kcbff-` clean-out** (`05` Q8)
- ★ No successful `_select` in the last 30 days, and no complaints or actions under that account. The list goes per box to you before anything is deleted.

**C3. Escalation through HRMS** (`05` Q9)
- **Context:** `_link` blocks binding to a higher-role account, but the same admin may be able to create one through HRMS.
- ★ Out of BFF scope. Record it and check the HRMS role-actions separately.

**C4. Legacy sign-in without a tenant slug, and digit-ui-v2** (`05` Q10)
- ★ Not a condition for BFF §0 completeness, but #2072 is a precondition for **production** citizen sign-in.

**C5. Gate additions** (`05` §4.3)
- ★ Add tests for:
  - expired-token re-select (UC-14);
  - forgot or set password (UC-35);
  - the revocation retry set (UC-46);
  - key rollover (UC-50);
  - the `kcbff-` transition (UC-53);
  - the backfill job (UC-54);
  - `/readyz` (UC-57);
  - DIGIT deactivation (UC-25, from B1).

**C6. Phone-only citizen tokens after Redis loss** (`05` Q13)
- ★ Accept this as the documented limit.

---

## Found while preparing (current-code issues, not design questions)

1. **Linked accounts send `dob` in the wrong format.** They send `yyyy-MM-dd`; egov-user expects `dd/MM/yyyy`. Login rotation likely fails for any linked account with a date of birth on record. This was traced in code only. (`04` §6)
2. **Three Keycloak user writes re-send `enabled`, and two of them skip the attribute lease.** An admin disable landing mid-write can be undone. (`organization-service.ts:107,888,927`)
3. **Three Redis key families have no TTL:** the citizen phone memo, the managed-accounts hash and the audit stream.
4. **The event poller can't run yet:**
   - the admin service account lacks `view-events`;
   - `adminEventsDetailsEnabled` is off;
   - no retention is set.
5. **No rev-6 route exists yet.** All target routes are still to be built; the use-case statuses reflect that.

## Leaving the session with

- [ ] A1–A8 decided, which is enough to write item 0's `digit.bindings`/`digit.accounts` v1 schema, Redis keyspace and `encode_v1` vectors.
- [ ] B1–B9 decided, which is enough to freeze the route schemas and the error catalogue.
- [ ] C1–C6 decided, which is enough to finalize §11.
- [ ] Revision 7 of the design: the decisions above folded in. Item 0 then starts as `docs/identity-bff.md`.
