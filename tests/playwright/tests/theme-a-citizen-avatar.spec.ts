import { test, expect } from '@playwright/test';

/**
 * Theme A — Citizen edit-profile avatar refreshes on save.
 *
 * Source under test (from validation notes): the citizen profile edit page
 * in digit-ui re-mounts the avatar with a cache-busted URL after a save,
 * so the new photo is visible immediately instead of requiring a hard
 * refresh.
 *
 * Status on ovh-cloud-dev `validate/all-themes`:
 *   This deployment does NOT have STATIC_OTP wired (the citizen OTP path
 *   is novu-backed and there is no fixture inbox). Programmatic citizen
 *   login is therefore not currently possible from a Playwright run, and
 *   we don't have an ADMIN-as-citizen shortcut on this build. Until
 *   STATIC_OTP is added (or a deterministic OTP inbox is exposed), this
 *   spec stays fixme'd.
 */

test.describe('Theme A — Citizen avatar refresh on profile save', () => {
  test.fixme(
    'updates avatar img src after save without a hard refresh',
    async ({ page }) => {
      // Re-enable once STATIC_OTP (or an equivalent deterministic OTP
      // fixture) is enabled on this deployment.

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

      const after = await avatar.getAttribute('src');
      expect(after).not.toBe(before);
    },
  );
});
