# CCRS fix-validation videos

Live-bomet recordings of UI fixes, captured via Playwright (slowMo + per-step waits) so they double as a regression suite, not just demos.

| # | Issue | File | Duration | Size | Captured on | What it shows | Status |
|---|---|---|---|---|---|---|---|
| 1 | #521 | `521-escalate-bomet.mp4` | 35s | 309K | 2026-05-31 | Login as `BOMET_LME` → open complaint `PG-PGR-2026-04-13-000848` at PENDINGATLME → click **Take action** → dropdown reveals **Escalate** alongside Re-assign/Resolve. Closes without firing. | dropdown demo |
| 2 | #521 | `521-escalate-full-action.mp4` | 45s | 433K | 2026-05-31 | Same flow as #1, but actually clicks Escalate → modal opens → types comment → Submit. DB row confirms state moved `PENDINGATLME → PENDINGATSUPERVISOR`. | full action |
| 3 | #445 + #476 + #622 + #478 + #447 + #496 | `configurator-bundle-bomet.mp4` | 70s | 1.1M | 2026-05-31 | **End-to-end on bomet, every action completes.** ADMIN session → users list renders clean (`#445`) → employees list loads, no DNS error (`#622`) → open Steve Odhiambo → Edit → modify email → **Save → URL navigates back to /employees** (`#476` round-trip — Assignment + Jurisdiction sub-records carried through enrichUpdateRequest without NPE) → complaint create form → Boundary picker shows 25/25 unique (`#496`) → type invalid pincode `1234` → red "Enter a valid 5-digit postal code" (`#478`) → type invalid mobile `abc123` → red "Enter a valid Kenyan mobile starting with 7 or 1" (`#447`) → fix both → errors clear. Submit-create blocked by an ADMIN-vs-CSR role-seed gap (documented in the spec; separate from #478/#447). | bundle |
| 4 | #471 + #459 + #476 (create half) + #622 | `create-employee-bomet.mp4` | 40s | 600K | 2026-05-31 | **End-to-end employee CREATE on bomet, submit hits backend with 2xx.** Fill Name + unique Code + Mobile (timestamp-derived to avoid mobile-collision) + DOB + DOA → pick role `PGR_LME` from typeahead → Add Assignment, pick Department + Designation, mark Current → Add Jurisdiction, pick Hierarchy + Boundary Type + Boundary → **Create → `/egov-hrms/employees/_create` returns 2xx** (`#476` create-half — enrichCreateRequest path didn't NPE on null AuditDetails of new sub-records). Then verifies via `_search`: `tenantId: ke`, `user.tenantId: ke` (`#459` — user landed on the form's selected tenant, not the upstream default). And the form/list state moves off the just-submitted data (`#471`). | bundle |
| 5 | #505 sub-1/2/3/4 + #344 + #432 + #592 + #622 | `digit-ui-bundle-bomet.mp4` | 58s | 404K | 2026-05-31 | **digit-ui employee bundle — login + chrome + visible decrypt.** `GET /digit-ui/globalConfigs.js` 200 with ansible-rendered `stateTenantId` (`#592`) → login page with bomet shield logo at **96×96** (was 56) and brand-dark banner (not white) (`#505 sub-1` + `sub-3` first half) → fill `BOMET_LME / eGov@123`, City `Bomet County`, accept privacy → Login → digit-ui shell mounts (`#622`) → header top-left logos held in view (`#505 sub-3` second half) → top-right `.header-dropdown-profile` is `display:flex / align-items:center / justify-content:center` with the LME's initial inside (`#505 sub-2`) → **open profile dropdown — held visible — Edit Profile + Logout labels readable, SVG icons rendered with dark fill (not white-on-white)** (`#505 sub-4`) → navigate to `/digit-ui/employee/pgr/complaint-details/PG-PGR-2026-04-13-000848` → Complaint Details renders, **"Contact Details: 9876543211" (plaintext, no hex blob) visible in the timeline** (`#344`) → navigate to `/digit-ui/employee/pgr/inbox-v2` → mounts cleanly, no 503 banner, no base64 hex blobs in body (`#432`). | bundle |
| 6 | #556 (session writeback) | `citizen-profile-bomet.mp4` | 51s | 343K | 2026-05-31 | Citizen OTP login → `/citizen/user/profile` → Change Photo → upload `avatar.png` fixture → Save → `/user/profile/_update` returns non-5xx → page stays on `/user/profile` (no hard reload). **CAVEAT** — the post-save sidebar visible side does NOT render an `<img>` because bomet's live citizen sidebar is the v2 `digit-ui-components-v2/citizen-sidebar.tsx` Avatar (initial-letter only, zero photo handling). The legacy `CitizenSideBar.Profile` fix only powers the mobile drawer. Follow-up filed on #556 with the minimal v2 port plan. The save-half (Layer 1 of the #556 fix) is honestly proven; the render-half is blocked. | bundle |
| 7 | #555 attachment upload + preview | `555-attachment-bomet.mp4` | 85s | 785K | 2026-05-31 | Citizen OTP login → `/pgr-home` → File a Complaint → walks the wizard (Complaint Type / Subtype / description) → reaches the photo step → upload `avatar.png` fixture → **preview `<img>` element renders with non-empty src AND `naturalWidth > 0` (public-URL contract — the browser actually fetched bytes back, not a hex blob or internal `http://minio:9000/` placeholder).** Proves the `#555` parser + nginx-rewrite stack is honestly working on bomet. | full action |
| 8 | #445 validationConfig null-safety | `445-validation-config-bomet.mp4` | 6s | 18K | 2026-05-31 | `/digit-ui/employee/user/profile` mount → no `Cannot read properties of (undefined\|null) (reading 'test')` / `validationConfig.*(undefined\|null)` / `TypeError.*test` pattern in body or `pageerror`. Bug fires on mount before auth per its shape, so unauthenticated visit catches it. Post-auth visible demo is blocked by an UNRELATED profile-data null bug on BOMET_LME (`/user/profile/_search` returns null fields), tracked separately. Code-level — commit `9750beb1` confirmed on live `digit-ui-employee.js` bundle. | guard |

## Manually-validated on bomet (no video, but DB-confirmed)

These were exercised live against bomet production via claude-in-chrome on 2026-05-31; the DB rows are the proof. Playwright clones of the flow are flaky on bomet's React-form timing so we leaned on the manual cycle for tracker purposes.

| # | Evidence |
|---|---|
| #471 Form clears after create | New employee `DEMO_CCRS_1780224082` ("CCRS Demo Employee", mobile `712345679`, PGR_LME role, Accounts Branch / Accountant, ADMIN/Ward/CHESOEN jurisdiction) — form submitted, URL navigated to `/manage/employees`, list re-rendered with the new row, form no longer presents the just-submitted data. |
| #459 user.tenantId on create | egov-hrms `_search?codes=DEMO_CCRS_1780224082` returns `tenantId: ke`, `user.tenantId: ke`, `jurisdictions[0].tenantId: ke` — all match the form's Tenant field (`ke`), not the upstream default `pg.citya`. |
| #476 jurisdiction edit save round-trip | Edited Steve Odhiambo's Jurisdiction: Boundary Type `County → Ward` AND Boundary `BOMET → CHESOEN`, clicked Save → "Employee updated — STEVE_ODHIAMBO" toast, no NPE on the Assignment.getAuditDetails() path that originally crashed. |

## Validation source-of-truth for #521

- FE: `digit-ui-esbuild/products/pgr/src/pages/employee/PGRDetails.js` — commit `54946902` (cherry-pick of `a4a2103f`) adds `ESCALATE` to `ACTION_CONFIGS`.
- Workflow: live `businessservice/_update` added `PENDINGATLME → ESCALATE → PENDINGATSUPERVISOR, roles=[PGR_LME, PGR_VIEWER]`. Seed: `utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json` — commit `ce302053`.
- Localization: DB row inserted into `egov.public.message` for tenant `ke`, module `rainmaker-common`, locale `en_IN`, code `ES_COMMON_TAKE_ACTION` → "Take action". Redis `messages` key cleared + `egov-localization` container restart.
- Live audit row in `eg_wf_processinstance_v2`:
  ```
  businessid                | status (PENDINGATSUPERVISOR uuid)        | action   | createdtime
  PG-PGR-2026-04-13-000848  | 22ed2889-0e28-48da-b9fc-db6084962810     | ESCALATE | 1780220864445
  ```

## How to re-record any fix on bomet

```bash
cd /tmp/ccrs-pr/tests/playwright
PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
PLAYWRIGHT_SKIP_SETUP=1 \
  npx playwright test <spec> --workers=1
# webm is in test-results/.../video.webm — convert to mp4:
ffmpeg -i <webm> -c:v libx264 -preset fast -crf 23 -movflags +faststart <out>.mp4
```

`PLAYWRIGHT_SKIP_SETUP=1` skips the configurator-ADMIN oauth setup — tests must do their own login.

## Cleanup log

Removed 2026-05-31 (post-bomet validation cycle):
- `/tmp/playwright-videos/` — 5 short ovh-era smokes (ran on stale maputo config)
- `/tmp/playwright-videos-final/` — 12 videos (6 theater smokes + 6 themes against stale ovh)
- `/tmp/video-frames/` — frame extractions from the polluted runs
- `/tmp/frames-*.png` — loose frame files
- `/tmp/ccrs-pr/tests/playwright/test-results/` — ephemeral runs (already converted what we needed)
