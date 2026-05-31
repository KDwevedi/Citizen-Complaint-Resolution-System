import { test, expect } from '@playwright/test';

/**
 * Theme A — Citizen edit-profile avatar refreshes on save (issue #556).
 *
 * Source under test: CitizenSideBar.js subscribes to the user profile so the
 * sidebar avatar src refreshes when UserProfile.js writes a new value, with
 * NO hard refresh. The assertion below is the right shape: snapshot
 * avatar.src before, upload a file, save, and assert avatar.src changed.
 *
 * Why this is still `.fixme` on ovh-cloud-dev `validate/all-themes`:
 *   The deployment runs the standard digit-ui citizen flow, which gates
 *   /citizen/user/profile behind an OTP login. To exercise the avatar
 *   refresh we need ONE of:
 *     (a) `STATIC_OTP` env on egov-user so a known OTP unlocks any mobile,
 *     (b) a deterministic OTP fixture inbox we can poll (none exposed), or
 *     (c) a programmatic citizen-session injection — the citizen side uses
 *         `Digit.SessionStorage.set("User", ...)` (digit-ui-esbuild/.../User
 *         /index.js:77), not the configurator's `crs-auth-state` blob, so
 *         our existing storageState does NOT cover this route.
 *
 *   NEXT STEPS to un-`.fixme`:
 *     1. Enable STATIC_OTP=123456 on egov-user via host_vars + redeploy,
 *        OR add a one-off `citizen-setup.ts` that POSTs /user/_create at
 *        the state tenant, hits /otp/v1/_send, reads the OTP from the
 *        user-service DB or logs, and dumps a citizen storage-state file
 *        (parallel to global-setup.ts), and switch this spec to use it.
 *     2. Drop a `fixtures/avatar.png` (a 1x1 PNG) under tests/playwright/.
 *     3. Remove `.fixme` and run.
 */

test.describe('Theme A — Citizen avatar refresh on profile save', () => {
  test.fixme(
    'updates avatar img src after save without a hard refresh',
    async ({ page }) => {
      // Re-enable once STATIC_OTP (or an equivalent deterministic OTP
      // fixture) is enabled on this deployment. See NEXT STEPS above.

      // Citizen login (digit-ui).
      await page.goto('/citizen');
      await page.getByLabel(/mobile/i).fill('9999999999');
      await page.getByRole('button', { name: /get otp|continue/i }).click();
      await page.getByLabel(/otp/i).fill('123456');
      await page.getByRole('button', { name: /verify|login/i }).click();

      // Edit Profile.
      await page.goto('/citizen/user/profile');
      const avatar = page.locator('img[alt*="profile" i], img[data-testid="profile-pic"]').first();
      const before = await avatar.getAttribute('src');

      // Upload a new image. Fixture is a 1×1 PNG checked in next to this
      // spec under fixtures/avatar.png — write it before re-enabling.
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles('tests/fixtures/avatar.png');
      await page.getByRole('button', { name: /save|update/i }).click();
      await page.getByText(/profile updated|saved/i).waitFor();

      // The Theme A signal: src must change WITHOUT a hard reload. If
      // CitizenSideBar's subscription regresses, `after === before` and
      // this test flips red.
      const after = await avatar.getAttribute('src');
      expect(after).not.toBe(before);
    },
  );
});
