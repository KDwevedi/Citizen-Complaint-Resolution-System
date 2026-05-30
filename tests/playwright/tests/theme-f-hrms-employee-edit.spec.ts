import { test, expect } from '@playwright/test';

/**
 * Theme F — HRMS employee edit through the configurator skips the
 * `ensureAudit` NPE.
 *
 * Source under test: hrms-services `EmployeeService.update` previously
 * NPE'd when `auditDetails` came back null on a record that hadn't been
 * fully hydrated by user-service. The fix introduces a null-guard so the
 * update succeeds and the employee record persists.
 *
 * What the test would do:
 *   1. Open the SUPERADMIN employee in the configurator's Employee edit
 *      page.
 *   2. Toggle a benign field (e.g. dateOfAppointment by +/- one day) or
 *      flip employeeStatus EMPLOYED -> INACTIVE -> EMPLOYED so the
 *      payload includes a real diff.
 *   3. Save. Assert: no toast with the previous NPE wording, and the row
 *      lands back at EMPLOYED in the list.
 *
 * Status on ovh-cloud-dev `validate/all-themes`:
 *   The configurator Employee edit page hydrates from HRMS Employee +
 *   user-service + boundary-service (jurisdictions). ovh ke.citya has no
 *   seeded boundary tree (same gap as Theme C), so the jurisdictions
 *   editor renders an empty cascade and the save call can still 4xx on
 *   the jurisdiction field even when the NPE itself is gone. The digit-ui
 *   /employee/ variant of the same flow is also blocked by the boundary
 *   gap (digit-ui's HRMS list requires a boundary selector on first paint
 *   and never gets past the spinner). Until ovh has a boundary tree,
 *   this test stays fixme'd.
 */

const EMPLOYEE_LIST_URL = '/configurator/manage/employees';

test.describe('Theme F — HRMS Employee edit through configurator', () => {
  test.fixme(
    'edit SUPERADMIN and save without ensureAudit NPE',
    async ({ page }) => {
      // Re-enable once a boundary tree is seeded on ovh ke.citya so the
      // jurisdictions editor + digit-ui HRMS list can finish hydrating.
      await page.goto(EMPLOYEE_LIST_URL);
      await page.waitForLoadState('domcontentloaded');

      // Find SUPERADMIN row; ra-core list uses a Datagrid with each row
      // having data-record-id. The text-based locator is more resilient
      // to grid impl swaps.
      await page.getByRole('link', { name: /SUPERADMIN/i }).first().click();

      const status = page.locator('input[name="employeeStatus"]');
      await status.fill('INACTIVE');
      await status.blur();

      await page.getByRole('button', { name: /save/i }).first().click();

      // Failure mode we want to assert against:
      await expect(
        page.getByText(/NullPointerException|ensureAudit/i),
      ).toHaveCount(0);

      // Restore so the test is idempotent.
      await page.getByRole('link', { name: /SUPERADMIN/i }).first().click();
      await page.locator('input[name="employeeStatus"]').fill('EMPLOYED');
      await page.getByRole('button', { name: /save/i }).first().click();
    },
  );
});
