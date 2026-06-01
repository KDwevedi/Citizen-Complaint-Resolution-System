# Playwright spec ↔ issue-validation audit — 2026-05-31 batch (4 specs)

Source: `/tmp/ccrs-pr/tests/playwright/tests/`. Closure criteria taken from latest QA comments on `egovernments/Citizen-Complaint-Resolution-System`. Same shape as `/tmp/ccrs-fix-videos/AUDIT.md`.

Repo paths in this audit are relative to `/tmp/ccrs-pr/tests/playwright/tests/`.

---

## `demo-citizen-profile-bomet.spec.ts`

Closure criterion (per KDwevedi 2026-05-30 + 2026-05-31 follow-up): citizen edit profile saves AND **the sidebar avatar refreshes without a hard reload**. The 2026-05-31 follow-up explicitly notes the live sidebar is v2 (`digit-ui-components-v2/citizen-sidebar.tsx`) with **zero photo handling** — the legacy fix only powers the mobile drawer. The save-half (session writeback + `_update` 2xx) is what's actually shipped; the sidebar-render half is reopened.

| Issue | Sub-item | Class | Assertion line(s) | Honesty note |
|---|---|---|---|---|
| [#556](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/556) | Save-half: profile `_update` round-trip returns non-5xx | DRIVES | L121–130 `waitForResponse(_update*, status<500)` + L129 `not.toBeNull()` + L130 `status < 400` | Tightly coupled to the session-writeback fix surface. A regression that breaks the save POST flips this red. |
| [#556](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/556) | No hard reload after save (regression behavior was dump-to-login) | DRIVES | L137 `expect(page.url()).toMatch(/\/digit-ui\/citizen\/user\/profile/)` | Discriminates the original symptom — a hard reload to login flips URL away from `/user/profile`. |
| [#556](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/556) | Sidebar `<img>` refreshes on save (the actually-reopened sub-item) | DOES NOT VALIDATE | L144–148 sidebar img count captured into `test.info().annotations` as an observation, NEVER asserted | Per KDwevedi 2026-05-31, the live v2 sidebar has no `<img>` at all — count would be 0 both before and after, so any assertion here would have flipped red. The spec correctly chose not to hard-fail, but that means the spec's own JSDoc claim ("sidebar avatar `img.src` changes WITHOUT a hard reload") is not under test. Honest scope: this spec proves the save-side of #556 only. The render-side gap is logged in the issue. |
| [#447](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/447) item 3 | Citizen complaint mobile field maxLength = 9 (KE tenant rule) | INCONCLUSIVE — needs reachability of step | L168–183 wraps the assertion in `isVisible({timeout: 6_000})`. If field never surfaces, spec annotates `'#447 assertion not exercised'` and falls through GREEN. | The L173 `expect(maxLen).toBe('9')` IS a drive when the field is reached, but the soft-skip on non-reachability means a regression where the field never surfaces (e.g. wizard breaks) leaves the test silently green with no #447 coverage. Honest hardening: `expect(mobileFieldOnForm.first()).toBeVisible({timeout: 15_000})` before the maxLength check, so non-reachability fails. |

---

## `demo-555-attachment-bomet.spec.ts`

Closure criterion (per Gurjeet 2026-05-20): create-side preview WAS already working in her retest. Open items: **(a)** image missing from Attachments section on complaint detail page (both employee + citizen), **(b)** no validation toast on invalid file format. KDwevedi 2026-05-30: error-surfacing half shipped in #673 (Toast); detail-page render half fixed in commit 37850e84 (ComplaintPhotos.js parser).

| Issue | Sub-item | Class | Assertion line(s) | Honesty note |
|---|---|---|---|---|
| [#555](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/555) | Wizard reaches a file input within 8 steps | DRIVES | L170–173 `expect(fileInputReached).toBeTruthy()` | Drives the path-existence prerequisite. |
| [#555](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/555) | Create-side preview `<img>` appears with non-empty src | DRIVES | L187–194 `previewImgs.count()` selector keyed on `src*=file-store\|bometfeedbackhub` + `alt*=upload\|thumbnail\|issue` + `expect(previewCount).toBeGreaterThan(0)` | The selector specifically requires the public filestore URL (per the #555 server-side fix Chakshu/KDwevedi shipped) — discriminates a regression where preview src was a hex blob or `http://minio:9000` internal URL. |
| [#555](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/555) | Preview is browser-reachable (public-URL contract) | DRIVES | L198–202 `naturalWidth > 0` | The exact symptom the nginx sub_filter fix targets — `naturalWidth: 0` is what Gurjeet's original screenshots showed. Tightly bound to the public-URL contract. |
| [#555](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/555) | Detail-page Attachments section renders the image (the actively-unresolved sub-item per Gurjeet 2026-05-20) | DOES NOT VALIDATE | spec never submits the complaint, never opens detail page — the JSDoc step 6 ("complete + capture the complaint number → visit its detail page") is described but the implementation stops at the preview check at L202 | The detail-render half is what Gurjeet flagged still broken; the create-preview half she said works. The spec validates the half that wasn't open. Honest drive: submit the complaint, visit `/complaints/<id>`, assert the Attachments section img also has `naturalWidth > 0`. |
| [#555](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/555) | Invalid file format surfaces user-readable toast (other actively-unresolved sub-item; KDwevedi PR #673) | DOES NOT VALIDATE | — | Spec only uploads a valid PNG fixture. The PR #673 toast-on-rejection contract is never exercised. Honest drive: upload a `.exe`-renamed-`.png` or any blocked format, assert a `[role="alert"]` toast appears with the backend's error message. |

---

## `demo-447-employee-bomet.spec.ts`

Closure criterion (per KDwevedi 2026-05-30 closing comment on #679): phone field maxLength + submit-time check both source from `globalConfigs.CORE_MOBILE_CONFIGS.mobileNumberLength`. **This fix shipped only to digit-ui-esbuild's PGR create form, not the configurator.** Verified by reading `configurator/src/resources/complaints/ComplaintCreate.tsx`: the mobile field is a plain `DigitFormInput` with no maxLength, no `CORE_MOBILE_CONFIGS` reference, no `useMobileValidation` import. The configurator surface DOES NOT carry the fix.

| Issue | Sub-item | Class | Assertion line(s) | Honesty note |
|---|---|---|---|---|
| [#447](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/447) item 3 | digit-ui employee PGR complaint-create phone field maxLength=9 | DOES NOT VALIDATE | L27 `COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create'` — wrong surface. The fix shipped to `/employee/pgr/complaint/...` in digit-ui-esbuild. | The configurator ComplaintCreate.tsx has zero maxLength and zero `CORE_MOBILE_CONFIGS` wiring — the spec is asserting against an unfixed surface. The L72 `expect(maxLen).toBe('9')` should flip red against the current configurator build; if it ever passes it would be by accident (e.g. some tenant browser autofill restriction), not by virtue of the #679 fix. Honest drive: re-target at `/digit-ui/employee/pgr-from-fileai/complaint-type` (or whichever route the digit-ui employee form actually mounts at on bomet) and assert maxLength there. |
| [#447](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/447) item 3 | Runtime truncation when typing 10 digits | DOES NOT VALIDATE | L77 `pressSequentially('1234567890')` + L80–84 `expect(enteredValue.length).toBe(9)` on the configurator field | Same problem — wrong surface. If the configurator field has no maxLength, typing 10 digits leaves all 10 in the value and the assertion flips red against the current build. The truncation contract being tested doesn't live at this URL. |

The spec's JSDoc explicitly cites the digit-ui-esbuild fix surface (`useMobileValidation` + `CORE_MOBILE_CONFIGS.mobileNumberLength`) but routes to the configurator. This is a coverage scope mismatch — the surface tested is not the surface fixed.

---

## `theme-a-validation-config.spec.ts`

Closure criterion (per KDwevedi PR #672 closing #445): null-safe the 6 `validationConfig?.<field>.test()` accessors in **`UserProfile.js`**. Gurjeet's 2026-05-20 retest screenshot shows the crash firing **on Employee Edit Profile UI** — i.e., AFTER login on `/employee/user/profile`.

**Critical reachability finding:** `/employee/user/profile` is wrapped in `PrivateRoute` (confirmed at `digit-ui-esbuild/packages/modules/core/src/pages/employee/index.js:109`). The `PrivateRoute` implementation (`packages/digit-ui-components/src/atoms/PrivateRoute.js:24–30`) checks `window.Digit.UserService.getUser()?.access_token` and returns `<Redirect to={loginPath}>` when missing. The `UserProfile` component is **never mounted** on an unauthenticated visit — React renders the Redirect, then the language-selection / login page mounts in its place. The spec's JSDoc claim ("the bug fired BEFORE auth on mount") is incorrect: the validationConfig hook is in `UserProfile`'s body, which only runs when `PrivateRoute` passes the auth check.

| Issue | Sub-item | Class | Assertion line(s) | Honesty note |
|---|---|---|---|---|
| [#445](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/445) | `validationConfig?.<field>.test()` accessors no longer crash on UserProfile mount | PROXIES (downgraded from previous AUDIT's DRIVES) | L54–57 body-text negative match + L60–66 pageerror negative match on three regex patterns | The spec navigates to `/employee/user/profile` unauthenticated. `PrivateRoute` returns `<Redirect>` BEFORE `UserProfile` mounts, so the body text scanned at L54 is the language-selection / login page's body, not UserProfile's. The pageerror listener catches nothing because UserProfile never runs. Even if PR #672 were reverted, this spec stays GREEN — the regression text doesn't appear on the login redirect target. Honest drive: log in as an employee (the demo specs do this), THEN navigate to `/employee/user/profile`, THEN assert no crash text + no pageerror. The spec also needs to either type into a field that fires the keystroke-validator or wait for the MDMS-fetch effect to complete with a deliberately-empty validationConfig. The JSDoc's "the bug fired BEFORE auth on mount" inference is contradicted by `PrivateRoute.js`. |

---

## Summary

- **Total issue-claims audited:** 9 across 4 specs.
- **DRIVES:** 4 (all in `demo-555-attachment-bomet.spec.ts` for the create-preview half + `demo-citizen-profile-bomet.spec.ts` for the save round-trip / no-reload pair)
- **PROXIES:** 1 (`theme-a-validation-config.spec.ts` — re-classed from prior AUDIT's DRIVES)
- **DOES NOT VALIDATE:** 3 (#556 sidebar render observation-only, #555 detail-page render, #555 invalid-format toast)
- **INCONCLUSIVE:** 1 (`demo-citizen-profile-bomet.spec.ts` #447 — soft-skip on non-reachability)
- **Wrong-surface coverage:** 1 spec — `demo-447-employee-bomet.spec.ts` asserts the fix on configurator's ComplaintCreate.tsx, which doesn't carry the #679 fix at all. Counted as 2 DOES NOT VALIDATE rows.

**Most concerning gaps (engineering-prioritised):**

1. **`theme-a-validation-config.spec.ts` is a PROXY, not a DRIVES, for #445.** Previous AUDIT.md classed it as the honest drive surface, but the spec runs unauthenticated and `PrivateRoute` 302s away before `UserProfile.js` mounts. The validationConfig crash text scanned at L54 is the login page's body. Reverting PR #672 leaves this test green. The fix: reuse the demo specs' login flow, navigate to `/employee/user/profile` AFTER auth, then assert.

2. **`demo-447-employee-bomet.spec.ts` targets the wrong surface.** The #679 fix shipped to digit-ui-esbuild's employee PGR complaint create (`useMobileValidation` + `CORE_MOBILE_CONFIGS.mobileNumberLength`). The spec routes to `/configurator/manage/complaints/create` whose `ComplaintCreate.tsx` is a vanilla `DigitFormInput` with no maxLength and no globalConfigs read. This either fails on the current build (red) or coincidentally passes (false positive); either way it does not validate item 3.

3. **#555 spec validates only the half Gurjeet's 2026-05-20 retest already said worked.** Create-side preview was acknowledged working; the open items were (a) detail-page Attachments missing image and (b) no toast on invalid format. The spec covers neither. The JSDoc's "step 6" — submit the complaint and visit detail page — is described but not implemented; the spec stops at preview check (L202).

4. **#556 sidebar refresh is captured as a free-form annotation, not asserted.** Honest under the current investigation (v2 sidebar has no `<img>` at all), but it means the spec's title ("avatar refresh on save") oversells the assertion. The proven half is just save-round-trip + same-URL.

---

## `demo-496-ward-scoped-csr-bomet.spec.ts` (added 2026-06-01)

Closure criterion (per Gurjeet 2026-05-19): a CSR scoped to ward X must not see other wards in the boundary picker. The fix surface is whichever layer (backend `boundary-service` or frontend picker) enforces the jurisdiction filter.

| Issue | Sub-item | Class | Assertion line(s) | Honesty note |
|---|---|---|---|---|
| [#496](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/496) | Ward-scoped CSR must not see out-of-scope wards | DRIVES | L84-87 asserts CHESOEN present in response; L89-94 asserts none of 7 forbidden siblings/cross-sub-county wards present; L97-100 asserts total code count ≤ 5 | Exercises the API the picker queries (`/boundary-service/boundary-relationships/_search`) as the ward-scoped CSR — same path the UI takes, no filtering possible at the layer the spec asserts. Fails red today (31 codes returned including 7 forbidden), goes green automatically when the filter ships. The 3 assertions stack: any one flipping isolates which sub-condition regressed (presence / exclusion / bounding). |

## Updated summary (10 claims across 5 specs)

- DRIVES: 5
- PROXIES: 1
- DOES NOT VALIDATE: 3
- INCONCLUSIVE: 1

The #496 honest drive replaces the audit gap noted in the original AUDIT.md (`demo-configurator-bundle-bomet` runs as ADMIN, never exercises ward-scoped CSR). Both halves of the issue (dedup + jurisdiction filter) now have honest test coverage.
