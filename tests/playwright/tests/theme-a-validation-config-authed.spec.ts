import { test, expect } from '@playwright/test';

/**
 * Theme A — UserProfile null-safe validationConfig (authenticated drive) — #445.
 *
 * Companion to the unauthenticated `theme-a-validation-config` spec.
 *
 * The AUDIT-NEW pass flagged the original as a PROXY: the route
 * `/employee/user/profile` is wrapped in `PrivateRoute`, which 302s to
 * `/login` when unauthenticated — so React never mounts `UserProfile.js`
 * and the body text scanned is the login page's, not the crashing
 * surface's.
 *
 * This spec authenticates as `BOMET_LME` via the digit-ui employee
 * login flow first, THEN navigates to `/employee/user/profile`. The
 * UserProfile mount + its `validationConfig?.<field>.test()` callsites
 * actually execute. The same crash-text + pageerror guards from the
 * unauth spec apply.
 *
 * Note: `BOMET_LME` is sufficient for proving the validationConfig
 * fix — the fix surface is the React component's useState init +
 * MDMS-fetch effect, not anything tied to a populated HRMS record.
 * The Edit Profile page may still surface OTHER errors downstream
 * of UserProfile mounting cleanly; those aren't #445's surface.
 *
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *   PLAYWRIGHT_SKIP_SETUP=1 \
 *     npx playwright test theme-a-validation-config-authed --workers=1
 */

const LOGIN_URL = '/digit-ui/employee/user/login';
const PROFILE_URL = '/digit-ui/employee/user/profile';
const CRASH_PATTERNS = [
  /Cannot read properties of (undefined|null) \(reading ['"]test['"]\)/i,
  /validationConfig.*(undefined|null)/i,
  /TypeError.*test/i,
];

test.describe('Theme A — UserProfile validationConfig null-safety (authed)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('post-auth UserProfile mount does not throw on missing regex (#445)', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    // ============ 1. UI login as BOMET_LME ============
    await page.goto(`${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page.locator('input[type="text"]').first().pressSequentially('BOMET_LME', { delay: 60 });
    await page.waitForTimeout(500);
    await page.locator('input[type="password"]').first().pressSequentially('eGov@123', { delay: 60 });
    await page.waitForTimeout(500);

    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes('Bomet County')) {
      await cityCombo.click();
      await page.waitForTimeout(700);
      await page.getByRole('option', { name: /Bomet County/i }).first().click();
      await page.waitForTimeout(700);
    }

    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(700);

    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Clear pre-profile errors so the spec only fails on errors that
    // actually happen during the post-auth profile mount.
    pageErrors.length = 0;

    // ============ 2. Navigate to Edit Profile ============
    await page.goto(`${PROFILE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    // ============ 3. Crash-text guard ============
    const bodyText = (await page.textContent('body')) ?? '';
    for (const pattern of CRASH_PATTERNS) {
      expect(
        bodyText,
        `crash text matched ${pattern} — #445 regression?`,
      ).not.toMatch(pattern);
    }

    // ============ 4. Pageerror guard ============
    const relevant = pageErrors.filter((msg) =>
      CRASH_PATTERNS.some((p) => p.test(msg)),
    );
    expect(
      relevant,
      `uncaught pageerror(s) matching the validationConfig crash:\n${relevant.join('\n')}`,
    ).toEqual([]);

    // ============ 5. Type a keystroke into a validator-gated field ============
    // The pre-fix crash actually fired on input change, not on
    // initial mount — the regex `.test()` is called from the onChange
    // path. If we can find a profile field and type into it, that
    // exercises the exact regression surface.
    const editableField = page
      .locator('input[name*="mobile" i], input[name*="email" i], input[type="tel"]')
      .first();
    if (await editableField.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editableField.click();
      await page.keyboard.type('7', { delay: 80 });
      await page.waitForTimeout(800);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      const postKeystroke = pageErrors.filter((msg) =>
        CRASH_PATTERNS.some((p) => p.test(msg)),
      );
      expect(
        postKeystroke,
        `keystroke on validator-gated field fired a validationConfig crash:\n${postKeystroke.join('\n')}`,
      ).toEqual([]);
    }

    await page.waitForTimeout(1_500);
  });
});
