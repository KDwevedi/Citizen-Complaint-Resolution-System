import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #622 — HRMS race / STATE_LEVEL_TENANT_ID force-recreate.
 *
 * Bug context: changing STATE_LEVEL_TENANT_ID in playbook's post-bootstrap
 * `compose restart` silently no-ops because the container is already up
 * with the old env. The "obvious" --force-recreate fix breaks ALL logins
 * via enc-key drift (489366 vs 34085). Tracked in memory note
 * `state_level_tenant_id_force_recreate_trap`.
 *
 * What the smoke catches: a regression that wedges the digit-ui /employee
 * landing — either egov-user 503s on `_search` (the HRMS list call), or
 * the env-mismatch returns a "service unavailable" banner.
 *
 * Auth: digit-ui /employee uses its own session (Digit.SessionStorage), so
 * an unauthenticated visit redirects to /employee/user/login. That
 * redirect is FINE — what we care about is that the bundle loads, the
 * router renders, and no 503/error banner appears.
 */

const EMPLOYEE_LANDING_URL = '/employee/';
const ERROR_BANNERS = [
  /service unavailable/i,
  /503/,
  /502 Bad Gateway/i,
  /An error occurred while processing your request/i,
  /something went wrong/i,
];

test.describe('Smoke #622 — /employee/ loads without HRMS/login 503', () => {
  test('digit-ui /employee/ renders (login redirect ok, no 5xx banner)', async ({ page }) => {
    const response = await page.goto(EMPLOYEE_LANDING_URL, { waitUntil: 'domcontentloaded' });

    // Top-level HTTP must be 2xx or a 3xx-redirect-resolved-to-2xx.
    if (response) {
      expect(
        response.status(),
        `expected 200 (or 3xx-resolved), got ${response.status()}`,
      ).toBeLessThan(400);
    }

    await page.waitForTimeout(4_000);

    const bodyText = (await page.textContent('body')) ?? '';
    for (const pattern of ERROR_BANNERS) {
      expect(bodyText, `body contained ${pattern}`).not.toMatch(pattern);
    }
  });
});
