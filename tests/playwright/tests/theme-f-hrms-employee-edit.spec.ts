import { test, expect } from '@playwright/test';
import { selectRadixOption } from '../lib/radix';

/**
 * Theme F — HRMS employee edit through the configurator skips the
 * `ensureAudit` NPE.
 *
 * Source under test: egov-hrms `EmployeeService.enrichUpdateRequest`
 * previously NPE'd when `auditDetails` came back null on a sub-record
 * (jurisdictions, assignments, etc.). Theme F adds an `ensureAudit`
 * helper that seeds fresh AuditDetails when missing. The new image
 * `egov-hrms:ccrs-476-fix` is the one running on ovh.
 *
 * Strategy: ovh's egov-user data is encrypted (Kenya DPA), so we can't
 * locate SUPERADMIN by name. Click the first row in the employees list,
 * flip employeeStatus EMPLOYED -> INACTIVE -> EMPLOYED via Radix, save,
 * and assert no NPE/ensureAudit error appears anywhere on the page.
 */

const EMPLOYEE_LIST_URL = '/configurator/manage/employees';

test.describe('Theme F — HRMS Employee edit through configurator', () => {
  // Un-fixme'd: the storage-state'd ADMIN has /configurator/manage/employees
  // access on ovh-cloud-dev. If a future deployment drops the role, the
  // datagrid selector will time out (visible failure) — that's the right
  // failure mode for "test infra missing", not a silent skip.
  test('edit first employee status and save without ensureAudit NPE', async ({ page }) => {
    await page.goto(EMPLOYEE_LIST_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);

    // Click the first data row in the employees table. Header rows are
    // <th>-only; data rows have <td>s. Datagrid renders rows as plain
    // <tr> with a click handler.
    const firstDataRow = page.locator('tbody tr').first();
    await firstDataRow.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);

    // Flip employeeStatus EMPLOYED -> INACTIVE.
    await selectRadixOption(page, /^EMPLOYED$/, 'INACTIVE');
    await page.getByRole('button', { name: /^Save$/ }).first().click();
    await page.waitForTimeout(3_000);

    // The bug we're guarding against: a server-side NPE that surfaces as a
    // toast or inline error.
    await expect(
      page.getByText(/NullPointerException|ensureAudit/i),
    ).toHaveCount(0);

    // Restore EMPLOYED so the test is idempotent across runs.
    await page.goto(EMPLOYEE_LIST_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await page.locator('tbody tr').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await selectRadixOption(page, /^INACTIVE$/, 'EMPLOYED');
    await page.getByRole('button', { name: /^Save$/ }).first().click();
    await page.waitForTimeout(2_000);
  });
});
