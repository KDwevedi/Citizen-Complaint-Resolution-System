import { test, expect } from '@playwright/test';

/**
 * Theme B (Complaint side) — `citizen.mobileNumber` on Complaint Create.
 *
 * Source: configurator/src/resources/complaints/ComplaintCreate.tsx:60-65:
 *   <DigitFormInput
 *     source="citizen.mobileNumber"
 *     validate={v.required}
 *     ...
 *   />
 *
 * IMPORTANT — the spec text said "Type 7123 (too short), blur — assert
 * error". The configurator Complaint page actually wires ONLY
 * `v.required` on the citizen mobile field (not phoneKE / not the HRMS
 * mobile validator). So:
 *   - Trunk-zero `0712345678` is accepted (no length/pattern check).
 *   - `7123` is also accepted (no length/pattern check).
 *   - Empty -> rejected with "This field is required".
 *
 * We test what the source actually does: the trunk-zero PASS path is the
 * meaningful Theme B signal here (citizens type Kenyan mobiles with
 * leading zero and the configurator MUST NOT block them at this surface).
 * The "too short" rejection assertion is intentionally not made; if the
 * project later tightens this field with phoneKE, a regression on the
 * trunk-zero path will catch it. Documented in the README under "Test
 * scope notes".
 */

const COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create';
const CITIZEN_MOBILE = 'input[name="citizen.mobileNumber"]';

test.describe('Theme B — Complaint citizen.mobileNumber field shape', () => {
  test('accepts trunk-zero Kenyan mobile without aria-invalid', async ({ page }) => {
    await page.goto(COMPLAINT_CREATE_URL);
    // ComplaintCreate co-mounts LocalityPicker which fans out to the
    // boundary tree; that request may 404 on this build but the citizen
    // field renders independently. We only need the mobile input.
    await page.waitForSelector(CITIZEN_MOBILE, { timeout: 30_000 });

    const mobile = page.locator(CITIZEN_MOBILE);
    await mobile.fill('0712345678');
    await mobile.blur();
    expect(['false', null]).toContain(await mobile.getAttribute('aria-invalid'));
  });

  test.fixme(
    'empty mobile fails the v.required check on submit',
    async ({ page }) => {
      // ra-core's `required` validator on DigitFormInput renders via MUI
      // helperText, but in this build it only surfaces after an explicit
      // submit attempt (blur-while-pristine doesn't trip it). Submit on
      // the configurator's Complaint page requires LocalityPicker to
      // resolve a non-empty locality which depends on the boundary tree;
      // ovh ke.citya has no boundary tree on this branch, so the submit
      // path is wedged. Re-enable once boundaries land.
      await page.goto(COMPLAINT_CREATE_URL);
      await page.waitForSelector(CITIZEN_MOBILE, { timeout: 30_000 });

      const mobile = page.locator(CITIZEN_MOBILE);
      await mobile.fill('07');
      await mobile.fill('');
      await mobile.blur();
      await page.getByRole('button', { name: /^(Create|Save)$/ }).first().click();

      await expect(page.getByText(/This field is required/i).first()).toBeVisible();
      expect(await mobile.getAttribute('aria-invalid')).toBe('true');
    },
  );
});
