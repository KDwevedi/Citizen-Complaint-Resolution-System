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
    await expect(page.getByText(HELP_TEXT).first()).toHaveCount(0);
  });
});
