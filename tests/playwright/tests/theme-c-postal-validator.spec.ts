import { test, expect } from '@playwright/test';
import { selectRadixOption } from '../lib/radix';

const URL = '/configurator/manage/complaints/create';
const PINCODE = 'input[name="address.pincode"]';
const DESC = 'textarea[name="description"], input[name="description"]';
const MOBILE = 'input[name="citizen.mobileNumber"]';
const HELP_TEXT = /Enter a valid 5-digit postal code/i;

async function fillRequired(page: import('@playwright/test').Page) {
  // Complaint Type — pick any (placeholder text "Select complaint type")
  await selectRadixOption(page, /Select complaint type/i, null);

  await page.locator(DESC).first().fill('Playwright theme C — pincode field exercise.');

  // LocalityPicker auto-fills Hierarchy + Boundary Type when there's one
  // option each. After my boundary seed (BOMET tree under ADMIN/Ward), only
  // the third combobox (Boundary, showing placeholder "Boundary") is unpicked.
  await selectRadixOption(page, /^Boundary$/, null);

  await page.locator(MOBILE).first().fill('712345678');
}

test.describe('Theme C — Configurator Complaint pincode validation', () => {
  test('rejects malformed postal code on submit', async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector(PINCODE, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await fillRequired(page);
    await page.waitForTimeout(1_500);
    await page.locator(PINCODE).fill('1234');
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: /^Create$/i }).click();
    await expect(page.getByText(HELP_TEXT).first()).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2_500);
  });

  test('accepts well-formed 5-digit postal code on submit', async ({ page }) => {
    await page.goto(URL);
    await page.waitForSelector(PINCODE, { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await fillRequired(page);
    await page.waitForTimeout(1_500);
    await page.locator(PINCODE).fill('00100');
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: /^Create$/i }).click();
    await page.waitForTimeout(3_500);
    // Postal-validator help text must not appear (the original assertion).
    await expect(page.getByText(HELP_TEXT).first()).toHaveCount(0);

    // Strengthening: also assert the form actually progressed. Without this,
    // the test passes if Create silently no-ops (no help text, no submit) —
    // e.g. a regression that strips the submit handler entirely. We accept
    // EITHER a URL change away from /create OR a success toast / "Element
    // created" indicator. Lenient (Promise.race) so a slow API doesn't
    // false-fail; we only need one signal that submit fired.
    const urlChanged = page
      .waitForURL((u) => !u.pathname.endsWith('/create'), { timeout: 8_000 })
      .then(() => 'url-changed');
    const toastVisible = page
      .locator('[role="status"], [role="alert"]')
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => 'toast');
    const successText = page
      .getByText(/created|success/i)
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => 'success-text');
    const winner = await Promise.race([
      urlChanged,
      toastVisible,
      successText,
    ]).catch(() => null);
    expect(
      winner,
      'expected URL change OR toast OR success text after a clean submit',
    ).not.toBeNull();
  });
});
