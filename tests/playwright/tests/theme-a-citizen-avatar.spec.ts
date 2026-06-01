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
 *   STATUS 2026-06-01: STATIC_OTP=123456 IS enabled on bomet AND the
 *   fixture exists. But the sub-agent investigation on 2026-05-31
 *   showed the live citizen sidebar on bomet is the v2 component
 *   (`digit-ui-components-v2/citizen-sidebar.tsx`) which has zero
 *   photo handling — there's never an <img> in the sidebar for the
 *   src-changed assertion to discriminate against. The legacy
 *   CitizenSideBar.Profile fix (commit 52296df7) only powers the
 *   mobile drawer.
 *
 *   The spec stays `.fixme` until the v2 sidebar gets the photo port
 *   (follow-up comment on #556 with the minimal port plan). Once that
 *   ships, drop `.fixme` and the spec drives the post-save img.src
 *   delta as designed.
 */

const CITIZEN_LOGIN_URL = '/digit-ui/citizen/login';
const CITIZEN_PROFILE_URL = '/digit-ui/citizen/user/profile';
const STATIC_OTP = '123456';

test.describe('Theme A — Citizen avatar refresh on profile save', () => {
  test.fixme(
    'updates avatar img src after save without a hard refresh (#556 v2 port)',
    async ({ page }) => {
      // Citizen OTP login (digit-ui). STATIC_OTP is enabled on bomet.
      await page.goto(`${CITIZEN_LOGIN_URL}?cb=${Date.now()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_000);

      await page
        .locator('input[type="tel"], input[type="number"]')
        .first()
        .pressSequentially('712345099', { delay: 80 });
      await page.getByRole('button', { name: /get otp|continue/i }).first().click();
      await page.waitForTimeout(2_000);
      const otpDigits = page.locator('input[autocomplete="one-time-code" i], input[maxlength="1"]');
      const otpCount = await otpDigits.count();
      if (otpCount >= 6) {
        for (let i = 0; i < 6; i++) await otpDigits.nth(i).fill(STATIC_OTP[i]);
      } else {
        await page.getByRole('textbox').first().fill(STATIC_OTP);
      }
      await page.getByRole('button', { name: /verify|login|continue/i }).first().click();
      await page.waitForURL(/\/digit-ui\/citizen(?!\/login)/, { timeout: 25_000 });

      // Edit Profile.
      await page.goto(`${CITIZEN_PROFILE_URL}?cb=${Date.now()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3_000);

      // Snapshot the sidebar avatar img before the upload.
      const sidebarAvatar = page
        .locator('aside img, [class*="sidebar" i] img, [class*="SideBar" i] img, [class*="v2-citizen-sidebar" i] img')
        .first();
      const before = await sidebarAvatar.getAttribute('src').catch(() => null);

      // Upload via the "Change photo" file chooser.
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 });
      await page.getByRole('button', { name: /change photo/i }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles('tests/playwright/fixtures/avatar.png');
      await page.waitForTimeout(1_500);

      // Save.
      await page.getByRole('button', { name: /^save$|update profile|^update$/i }).first().click();
      await page
        .waitForResponse(
          (r) => /\/user\/profile\/_update|\/user\/users\/_update/.test(r.url()) && r.status() < 500,
          { timeout: 15_000 },
        )
        .catch(() => null);
      await page.waitForTimeout(3_000);

      // The #556 v2-port closure signal: sidebar img.src changes without a
      // hard reload. Pre-port: this assertion fails because the v2 sidebar
      // renders an initial-letter Avatar (no <img> at all). Post-port:
      // <img> with the filestore URL appears.
      const after = await sidebarAvatar.getAttribute('src').catch(() => null);
      expect(after, 'sidebar avatar src must change after profile save').not.toBe(before);
    },
  );
});
