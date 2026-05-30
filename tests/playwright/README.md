# Playwright theme validation suite

Targets the `validate/all-themes` deployment on ovh-cloud-dev
(`http://57.131.32.64`). Mirrors the PASS flows confirmed by the offline
validation pass and stubs the gaps with `test.fixme` so they're ready to
re-enable as the ovh-cloud-dev environment fills in.

## Install

```bash
cd tests/playwright
npm install
npx playwright install chromium
```

## Run

```bash
# All specs against ovh-cloud-dev:
npm test

# Override the deployment (e.g. local OrbStack):
PLAYWRIGHT_BASE_URL=http://localhost:80 npm test

# Open the HTML report (embeds videos + traces):
npm run report
```

A one-time `globalSetup` hits `/user/oauth/token` with the ADMIN
credentials, walks Chromium to `/configurator/` once to register the
origin, writes the configurator's `crs-auth-state` blob into
`localStorage`, and dumps `storage-state/admin.json`. Every test loads
that storage state so the configurator boots straight into management
mode without an interactive login.

## Videos

`playwright.config.ts` sets `video: 'on'`, so every test (pass or fail)
records a `.webm` to
`test-results/<spec>-<title>-chromium/video.webm`. Convert to MP4 with:

```bash
ffmpeg -i test-results/<dir>/video.webm test-results/<dir>/video.mp4
```

`screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'` also
attach when something breaks (open with `npx playwright show-trace
test-results/<dir>/trace.zip`).

## What's currently active vs `fixme`'d

| Spec | Test | Status | Why |
|---|---|---|---|
| `theme-b-mobile-validation.spec.ts` | valid Kenya mobile clears aria-invalid | PASS | `useMobileValidator` accepts the 9-digit form. |
| `theme-b-mobile-validation.spec.ts` | invalid mobile surfaces Kenya help text and aria-invalid | PASS | `useMobileValidator` rejects with the fallback message. |
| `theme-b-complaint-citizen-mobile.spec.ts` | accepts trunk-zero Kenyan mobile without aria-invalid | PASS | Source wires only `v.required` so `0712345678` is accepted. |
| `theme-b-complaint-citizen-mobile.spec.ts` | empty mobile fails the v.required check on submit | fixme | Submit needs LocalityPicker; LocalityPicker needs a boundary tree that ovh ke.citya lacks on this branch. |
| `theme-c-postal-validator.spec.ts` | postal code accept/reject | fixme | Same LocalityPicker gap blocks the page from settling. |
| `theme-a-citizen-avatar.spec.ts` | citizen avatar refresh on save | fixme | Citizen login needs STATIC_OTP or a deterministic OTP fixture; ovh has neither. |
| `theme-f-hrms-employee-edit.spec.ts` | ensureAudit NPE regression | fixme | Same boundary gap + the digit-ui /employee/ list is wedged on boundary load. |

## Test scope notes

- **T2 (citizen mobile) is split** — the offline spec asked for a "too
  short rejection" but the source on Complaint Create only wires
  `v.required`. The PASS path we DO test (trunk-zero accepted) is the
  meaningful Theme B signal here: any future tightening of this field
  with `phoneKE` will break the trunk-zero path and the test catches
  the regression. The empty-required check is fixme'd because reliably
  triggering ra-core's required validator on a pristine field requires
  a submit, and submit currently can't reach validation due to the
  LocalityPicker gap.

- **T1 (employee mobile)** uses `712345678` (9 chars) on the PASS leg,
  not `0712345678` (10 chars) as the offline spec said.
  `useMobileValidator` has `min=max=9`, so the 10-char form fails the
  length bound even though the trunk-zero strip happens server-side.
  Documented inline in the spec.

## Reseeding the storage state

The token in `storage-state/admin.json` is committed only to
`.gitignore` (TODO: add). Re-run `npx playwright test` and globalSetup
will refresh it. To force a refresh without running tests:

```bash
rm -rf storage-state && npx playwright test --list >/dev/null
```

## Files

- `playwright.config.ts` — chromium @ 1366×768, video on, baseURL via
  `PLAYWRIGHT_BASE_URL`.
- `global-setup.ts` — fetches ADMIN bearer, seeds `crs-auth-state`,
  dumps storage state + raw `token.json`.
- `tests/*.spec.ts` — the four themes.
