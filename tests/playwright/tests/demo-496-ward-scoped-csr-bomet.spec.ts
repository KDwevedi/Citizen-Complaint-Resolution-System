import { test, expect } from '@playwright/test';

/**
 * Demo: ward-scoped CSR boundary jurisdiction filter — #496 (unresolved sub-bug).
 *
 * Closed sub-item: BoundaryDropdown dedup (covered by
 * `demo-configurator-bundle-bomet`).
 *
 * Open sub-item (Gurjeet 2026-05-19): "CSR can pick wards outside their
 * jurisdiction". When a CSR is scoped to ward X, the boundary endpoint
 * (`/boundary-service/boundary-relationships/_search`) used by the
 * picker should return ONLY X's subtree.
 *
 * This spec authenticates as the ward-scoped CSR
 * `BOMET_CSR_CHESOEN_1780282462` (jurisdiction = ADMIN/Ward/
 * `BOMET_BOMET_CENTRAL_CHESOEN`, see the
 * `reference_bomet_ward_csr_user` memory) and asserts:
 *
 *   1. The response is non-empty and includes CHESOEN.
 *   2. The response does NOT contain sibling/other-sub-county wards.
 *   3. The response code-count is bounded — a CSR scoped to one
 *      single ward must not see all 31 bomet boundaries.
 *
 * Today this test fails (the live API returns the full 31-code
 * tree for both ADMIN and the ward CSR — no filtering at all).
 * That's the honest signal: the unresolved bug is still unresolved.
 *
 * Convert to `.fixme` ONLY when the team explicitly decides to defer
 * the fix; leaving it as a hard fail is the regression catcher.
 *
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *     npx playwright test demo-496-ward-scoped-csr-bomet --workers=1
 */

const CSR_USERNAME = 'BOMET_CSR_CHESOEN_1780282462';
const CSR_PASSWORD = 'eGov@123';
const CSR_TENANT = 'ke';
const WARD_CODE = 'BOMET_BOMET_CENTRAL_CHESOEN';
const FORBIDDEN_OTHER_WARDS = [
  'BOMET_BOMET_CENTRAL_MUTARAKWA',
  'BOMET_BOMET_CENTRAL_NADARAWETA',
  'BOMET_BOMET_CENTRAL_SILIBWET_TOWNSHIP',
  'BOMET_BOMET_CENTRAL_SINGORWET',
  'BOMET_BOMET_EAST_KEMBU',
  'BOMET_CHEPALUNGU_CHEBUNYO',
  'BOMET_KONOIN_KIMULOT',
];

test.describe('Demo #496 — ward-scoped CSR boundary jurisdiction filter', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('boundary API returns only the CSR\'s ward subtree, not the full tree', async ({ request }) => {
    // ============ 1. CSR oauth token ============
    const tokenResp = await request.post('/user/oauth/token', {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `username=${CSR_USERNAME}&password=${encodeURIComponent(CSR_PASSWORD)}&grant_type=password&scope=read&tenantId=${CSR_TENANT}&userType=EMPLOYEE`,
    });
    expect(tokenResp.ok(), 'CSR must be able to authenticate').toBeTruthy();
    const token = (await tokenResp.json()).access_token as string;
    expect(token, 'access_token must be returned').toBeTruthy();

    // ============ 2. Hit boundary-relationships as the CSR ============
    const boundaryResp = await request.post(
      `/boundary-service/boundary-relationships/_search?tenantId=${CSR_TENANT}&hierarchyType=ADMIN`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: token } },
      },
    );
    expect(boundaryResp.ok(), 'boundary-relationships must respond 2xx').toBeTruthy();
    const body = await boundaryResp.json();

    // Walk all nested codes.
    const collectCodes = (node: unknown, into: Set<string>) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.code === 'string') into.add(obj.code);
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach((x) => collectCodes(x, into));
        else if (v && typeof v === 'object') collectCodes(v, into);
      }
    };
    const codes = new Set<string>();
    collectCodes(body, codes);

    // ============ 3. Assertions ============
    expect(codes.size, 'response must include at least one boundary').toBeGreaterThan(0);
    expect(
      codes.has(WARD_CODE),
      `CSR's own ward (${WARD_CODE}) must be in the response`,
    ).toBe(true);

    // (a) Sibling / other-sub-county wards MUST NOT appear.
    const offenders = FORBIDDEN_OTHER_WARDS.filter((c) => codes.has(c));
    expect(
      offenders,
      `#496 — ward-scoped CSR jurisdiction filter not applied. CSR (${WARD_CODE}) sees ${codes.size} boundaries including out-of-scope wards: ${JSON.stringify(offenders)}`,
    ).toEqual([]);

    // (b) Code count must be bounded. A CSR scoped to one leaf ward
    //     shouldn't see the entire bomet tree (~31 codes).
    expect(
      codes.size,
      `#496 — code count for a single-ward CSR must be small (subtree of one ward); got ${codes.size}: ${JSON.stringify([...codes].slice(0, 10))}`,
    ).toBeLessThanOrEqual(5);
  });
});
