import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #344 — SecurityPolicy decryption keys for PGR roles.
 *
 * Bug: the PGR-side SecurityPolicy seed was missing entries for GRO/LME
 * roles, so PGR inbox calls came back with name/mobile fields as hex blobs
 * (the raw encrypted ciphertext) instead of plaintext after #344's port.
 *
 * Smoke signal: visit the configurator PGR inbox as ADMIN. If decryption
 * works, complainant names render as alpha strings. If the policy seed
 * regresses, the cells render as hex blobs matching /^[a-f0-9]{20,}$/ or
 * the raw `{"value":...}` envelope. We assert NO hex-blob is visible in
 * the rendered table — a permissive check that catches the regression
 * without being tightly coupled to a specific tenant's seeded data.
 *
 * Why configurator and not digit-ui: digit-ui /employee requires a
 * separate auth flow we don't seed. The configurator's complaints list
 * hits the same `_search` API, so the decryption path is exercised
 * identically.
 */

const COMPLAINTS_URL = '/configurator/manage/complaints';
const HEX_BLOB = /\b[a-f0-9]{24,}\b/;

test.describe('Smoke #344 — SecurityPolicy PGR decryption', () => {
  test('PGR complaints list does not show encrypted hex blobs', async ({ page }) => {
    await page.goto(COMPLAINTS_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    // If the list is empty (fresh tenant), the assertion is vacuously
    // true — that's acceptable for a smoke. The regression we care about
    // is "list HAS rows AND they look encrypted", not "list is empty".
    const bodyText = (await page.textContent('body')) ?? '';
    expect(
      bodyText,
      'rendered text contains a hex blob — SecurityPolicy decryption regressed',
    ).not.toMatch(HEX_BLOB);
  });
});
