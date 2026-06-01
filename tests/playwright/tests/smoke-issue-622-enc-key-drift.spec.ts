import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #622 — egov-user encryption-key drift after
 * STATE_LEVEL_TENANT_ID flip + --force-recreate.
 *
 * The bug: when a deploy flips `STATE_LEVEL_TENANT_ID` (e.g. via host_vars)
 * AND restarts containers with `docker compose up -d --force-recreate`,
 * egov-enc-service auto-generates a NEW symmetric key for the new tenant.
 * Existing eg_user rows are encrypted with the OLD key, so the new
 * username-lookup queries (encrypted with the new key) miss them and
 * every oauth/token request returns "Invalid login credentials".
 *
 * Why this spec is `.skip` on bomet: the bomet deploy uses
 * `docker compose up -d` WITHOUT `--force-recreate`, so the env change
 * silently no-ops on already-running containers; the bug never fires.
 * The companion sub-bug — that recreate via depends_on cascade ALSO
 * triggers the drift — was hit live on 2026-05-31 12:24 UTC when a
 * sub-agent did `docker compose up -d pgr-services` and the recreate
 * cascaded to egov-user + egov-enc-service. Recovery moved enc-keys row
 * 1 (key_id=8234) from tenant `pg` to `ke` in the DB.
 *
 * Honest drive (run only on ovh-cloud-dev, AFTER an explicit
 * STATE_LEVEL_TENANT_ID flip + --force-recreate):
 *
 *   PLAYWRIGHT_BASE_URL=https://ovh-cloud-dev/digit \
 *   PLAYWRIGHT_FORCE_RECREATE_FLIP=1 \
 *     npx playwright test smoke-issue-622-enc-key-drift --workers=1
 *
 * The fix surface this asserts: deterministic enc-key seed per tenant
 * (instead of auto-generation on first encryption call). Issue #687
 * tracks the persistence story; this spec is the regression catcher for
 * its load-bearing layer.
 */

test.describe('Smoke #622 — enc-key drift after STATE_LEVEL_TENANT_ID flip', () => {
  // Hard skip on any deploy that hasn't explicitly opted in. Bomet
  // deploys without `--force-recreate`, so the regression surface is
  // invisible there — a green run on bomet would be misleading.
  test.skip(
    process.env.PLAYWRIGHT_FORCE_RECREATE_FLIP !== '1',
    'Set PLAYWRIGHT_FORCE_RECREATE_FLIP=1 to run; requires ovh-cloud-dev with STATE_LEVEL_TENANT_ID flipped + --force-recreate.',
  );

  test('ADMIN can still oauth/token immediately after a tenant flip + --force-recreate (#622)', async ({
    request,
  }) => {
    const tenant = process.env.PLAYWRIGHT_TENANT ?? 'ke';
    const username = process.env.PLAYWRIGHT_USERNAME ?? 'ADMIN';
    const password = process.env.PLAYWRIGHT_PASSWORD ?? 'eGov@123';

    const resp = await request.post('/user/oauth/token', {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `username=${username}&password=${encodeURIComponent(password)}&grant_type=password&scope=read&tenantId=${tenant}&userType=EMPLOYEE`,
    });

    // Specific assertion shape: the bug returns 400 with body
    // `{error: "invalid_request", error_description: "Invalid login credentials"}`.
    // A green run returns 200 with `{access_token: "<uuid>"}`.
    expect(
      resp.status(),
      `#622 — oauth/token returned ${resp.status()} after the recreate; expected 2xx. Body: ${(await resp.text()).slice(0, 400)}`,
    ).toBeLessThan(400);

    const body = await resp.json();
    expect(
      typeof body.access_token,
      `#622 — oauth/token body must contain access_token; got ${JSON.stringify(body).slice(0, 300)}`,
    ).toBe('string');
    expect(body.access_token.length).toBeGreaterThan(0);
  });
});
