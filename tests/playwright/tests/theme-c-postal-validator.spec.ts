import { test, expect } from '@playwright/test';

/**
 * Theme C - `v.postalCodeKE` on Complaint Create.
 *
 * Source: configurator/src/admin/validation.ts
 * Wired at: configurator/src/resources/complaints/ComplaintCreate.tsx
 *
 * Two compounded blockers learned by empirically un-fixme-ing and running:
 *
 * 1. ra-core's regex validator only fires after a field-level "touched"
 *    event, which in RA admin forms only happens via a form submit cycle.
 *    Blur alone is insufficient.
 *
 * 2. The form's submit path requires Locality, and LocalityPicker is a
 *    three-stage Radix cascade (Hierarchy -> Boundary Type -> Boundary)
 *    that portals options outside the picker's DOM subtree. Driving it
 *    reliably with Playwright requires either deep selectors that match
 *    Radix's portal output, or a dedicated test helper. As of 2026-05-30
 *    ovh ke has a minimal boundary tree seeded directly via boundary-
 *    service v2 (`POST /boundary-hierarchy-definition/_create` for the
 *    hierarchy plus three `_create` calls for BOMET / BOMET_CENTRAL /
 *    BOMET_CENTRAL_CHESOEN and their relationships), so the data IS there;
 *    the gap is purely test driver ergonomics against Radix portals.
 *
 * Re-enable by either:
 *   (a) writing a Radix-aware cascade helper that walks the portaled
 *       option list with a page.locator scoped to document.body, or
 *   (b) replacing this test with a direct API submit against
 *       `/pgr-services/request/_create` and asserting the postal-code
 *       error comes back from server-side validation as well as
 *       client-side - server-side enforcement is the more useful proof
 *       for production tenants.
 */

const COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create';
const PINCODE_INPUT = 'input[name="address.pincode"]';
const HELP_TEXT = /Enter a valid 5-digit postal code/i;

test.describe('Theme C - Configurator Complaint pincode validation', () => {
  test.fixme('rejects malformed postal codes on submit', async ({ page }) => {
    await page.goto(COMPLAINT_CREATE_URL);
    await page.waitForSelector(PINCODE_INPUT, { timeout: 20_000 });
    await page.locator(PINCODE_INPUT).fill('1234');
    await page.getByRole('button', { name: /^Create$/i }).click();
    await expect(page.getByText(HELP_TEXT).first()).toBeVisible({ timeout: 5_000 });
  });
});
