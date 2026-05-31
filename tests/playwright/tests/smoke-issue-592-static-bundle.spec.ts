import { test, expect } from '@playwright/test';

/**
 * Smoke — issue #592 — static bundle / globalConfigs.js asset is served.
 *
 * Bug: the deploy template / vendor symlink for the digit-ui static bundle
 * could 404 if the playbook drifted from the build output path. PR #644
 * (vendored static-mode symlink + /egov-rainmaker + bare-domain) is the
 * fix. The smallest regression catcher: GET the canonical
 * `/digit-ui/globalConfigs.js` asset and assert HTTP 200 + JS content-type.
 *
 * Path is from `local-setup/nginx/digit-ui.conf:21`:
 *   location = /digit-ui/globalConfigs.js {
 *     alias /var/web/digit-ui/globalConfigs.js;
 *     default_type application/javascript;
 *   }
 *
 * The task description mentioned `/digit-ui/static/` — the real on-host
 * path served on ovh is `/digit-ui/globalConfigs.js` (the static dir is
 * proxied by the same /digit-ui location). Probing globalConfigs.js
 * directly exercises the alias + default_type rule, which is the surface
 * that broke historically.
 */

const ASSET_URL = '/digit-ui/globalConfigs.js';

test.describe('Smoke #592 — digit-ui static bundle served', () => {
  test('GET /digit-ui/globalConfigs.js returns 200 + JS content-type', async ({ request }) => {
    const resp = await request.get(ASSET_URL);
    expect(resp.status(), `expected 200, got ${resp.status()}`).toBe(200);

    const ct = resp.headers()['content-type'] ?? '';
    expect(ct).toMatch(/javascript|ecmascript|text\/plain/i);

    // Sanity: body should actually look like JS (globalConfigs is window-
    // scoped). If the alias regressed to serving index.html, this fails.
    const body = await resp.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).not.toMatch(/<!DOCTYPE html>/i);
  });
});
