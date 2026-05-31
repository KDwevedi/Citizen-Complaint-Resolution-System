import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #567 — default-data-handler SecurityPolicy double-seed.
 *
 * Bug: the default-data-handler re-seeded `DataSecurity.SecurityPolicy` on
 * top of an existing dump, causing egov-user to crash at compose-up with a
 * duplicate-key exception. Fix lets the seed skip when the row already
 * exists.
 *
 * Smoke signal: if the seed crash regresses, login itself wouldn't work
 * (egov-user would be wedged). The fact that `global-setup.ts` already
 * fetched an ADMIN token in `beforeAll` proves login is alive. We add one
 * more reachability check: `/configurator/manage/users` (the user list)
 * round-trips the egov-user API, so loading it without a 5xx banner or a
 * "duplicate key" error in the page body confirms the seed isn't crashing.
 */

const USERS_URL = '/configurator/manage/users';
const CRASH_PATTERNS = [
  /duplicate key/i,
  /SQLException/i,
  /service unavailable/i,
  /5\d\d (Internal Server Error|Bad Gateway|Service Unavailable)/i,
];

test.describe('Smoke #567 — DDH SecurityPolicy seed survives idempotent runs', () => {
  test('users list loads without duplicate-key or 5xx', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(USERS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    const bodyText = (await page.textContent('body')) ?? '';
    for (const pattern of CRASH_PATTERNS) {
      expect(bodyText, `body contained ${pattern}`).not.toMatch(pattern);
    }

    const dupKeyInConsole = consoleErrors.find((msg) => /duplicate key/i.test(msg));
    expect(
      dupKeyInConsole,
      `console reported duplicate-key:\n${dupKeyInConsole}`,
    ).toBeFalsy();
  });
});
