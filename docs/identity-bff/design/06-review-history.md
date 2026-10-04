# Review history: how the design got here

| Rev | Date | Trigger | What changed | Reviewers → verdict |
|---|---|---|---|---|
| 1 | 10-01 | 12-agent audit | First boundary: credential-to-account broker; D1–D10 recommended; 32-item BFF list; security findings | Astra, Fable → **not approvable**: founder roles have no source; no Keycloak shape for role tenants; DIGIT3 can't be a config flip; revocation can't be enforced |
| — | 10-01 | Owner | D1 (DIGIT owns roles, synced to Keycloak), D2 (onboarding to PGR), D3 (DIGIT owns the profile, synced), D4 question | — |
| — | 10-03 | Owner | Freeze means completeness; sync is a BFF module; no egov service changes; `TENANT_ADMIN` → existing role; no citizen suspension | — |
| 2 | 10-03 | Owner answers + R1 | Account model, `digit.accounts` per-account mirror, operation-owned primitives, stored-credential issuance, DIGIT3 as a migration | Opus, Codex → **not freezable, close**: stored credential can't work for citizens; D5 needs code; binding rules missing; lifecycle hides tenants; sequencing inversions |
| — | 10-03 | Owner | Stay on Redis; staff need binding + membership; keep `SUPERUSER`; first binding is the profile source; clean out `kcbff-`; invites must be accepted | — |
| 3 | 10-03 | Owner + R2 | HMAC-derived credential, binding states and rules, D5 session routes, event poller, slug lock, lifecycle with absent = ACTIVE | Astra, Fable → **ready with changes**: `_link` has no membership; encoding vs password policy; membership backfill; retry idempotency; issue-vs-revoke race |
| 4 | 10-03 | R3 | `encode_v1`, full `_link`/`_accept` contract, shared-lease ordering, derived-credential revocation fallback, FAILED adoption, phone lock, poller delivery rules | Astra, Fable → **ready with changes**: PUT must keep email; FAILED adoption id mismatch with PGR; fallback overclaimed; session ordering |
| 5 | 10-03 | R4 | Email kept in PUT, attemptId, session re-read + revocation generation, typed login-failure parsing, credential metadata + provider unlink, opaque phone usernames, resumable `_link` | Astra, Fable → **ready with changes**: attemptIds unordered; lifecycle publication crash gap; session `SET XX`; self password change signs you out |
| 6 | 10-03 | R5 + owner (keep the initiating session) | Monotonic `restartNo`, PGR lifecycle-publication replay, update-only sessions, cached-token validation, `_link` marker scoped to its request, primary-method protection, citizen admin routes kept, username rename dropped | Loop closed by owner agreement |

## Trend

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| Blockers about architecture or ownership | ~8 | 4 | 0 | 0 | 0 |
| Blockers about contract precision | — | 2 | 3 | 4 | 3 |
| Verdict | no | no | ready w/ changes | ready w/ changes | ready w/ changes |

The architecture has been stable since revision 3. Revisions 4–6 add contract precision: idempotency, crash boundaries, ordering. Implementation and the §11 gate will surface the rest.

All review texts are in `_identity-bff-audit-2026-10-01/review*.md`.
