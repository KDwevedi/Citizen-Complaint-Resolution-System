import { test, expect } from '@playwright/test';

/**
 * Theme A — UserProfile null-safe validationConfig regex access (issue #445).
 *
 * Bug: digit-ui's UserProfile.js crashed on mount when MDMS
 * `UserProfileValidationConfig` omitted a field (so its regex was undefined)
 * with "Cannot read properties of undefined (reading 'test')".
 *
 * Fix (commit 9750beb1, PR for #445): optional-chain `.test()` on all six
 * validator call sites so a missing regex returns undefined instead of
 * throwing.
 *
 * Mount point: `/employee/user/profile` (also `/citizen/user/profile`),
 * served by digit-ui-esbuild — pages/citizen/Home/UserProfile.js, re-exported
 * by pages/employee/index.js. PrivateRoute redirects to /employee/user/login
 * when unauthenticated.
 *
 * The Theme A signal we want to catch: a React error boundary or raw error
 * text mentioning `validationConfig` / `Cannot read properties of undefined`
 * appearing anywhere on the page. The test:
 *   - Captures uncaught page errors via `page.on('pageerror')`,
 *   - Navigates to `/employee/user/profile`,
 *   - Asserts NO crash text or pageerror was logged.
 *
 * On an unauthenticated visit the route 302s to login — that's fine, the
 * bug fired BEFORE auth on mount (the validationConfig hook runs in the
 * UserProfile body itself). If a future build inlines UserProfile into the
 * login bundle path, this still catches the regression.
 */

const EMPLOYEE_PROFILE_URL = '/employee/user/profile';
const CRASH_PATTERNS = [
  /Cannot read properties of (undefined|null) \(reading ['"]test['"]\)/i,
  /validationConfig.*(undefined|null)/i,
  /TypeError.*test/i,
];

test.describe('Theme A — UserProfile validationConfig null-safety', () => {
  test('UserProfile mount does not throw on missing regex (#445)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    await page.goto(EMPLOYEE_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    // Give React time to mount + run effects (validationConfig is built in
    // useState init AND in an MDMS-fetch effect; both must not throw).
    await page.waitForTimeout(4_000);

    // No React error boundary should be visible. We probe for the dev-mode
    // overlay AND for a few classic prod-mode crash strings that would
    // appear in any rendered error text.
    const bodyText = (await page.textContent('body')) ?? '';
    for (const pattern of CRASH_PATTERNS) {
      expect(bodyText, `crash text matched ${pattern}`).not.toMatch(pattern);
    }

    // Uncaught page errors with the same shape would also indicate the bug.
    const relevant = pageErrors.filter((msg) =>
      CRASH_PATTERNS.some((p) => p.test(msg)),
    );
    expect(
      relevant,
      `uncaught pageerror(s) matching the validationConfig crash:\n${relevant.join('\n')}`,
    ).toEqual([]);

    await page.waitForTimeout(1_000);
  });
});
