# Branding + logos

Three places hold tenant branding: the configurator's theme record (palette + logo refs), `globalConfigs.js` (build-time defaults), and the filestore (binary uploads). This doc covers the runtime model and the four common tasks.

## Where branding lives

```
┌────────────────────────────────────────────────────────────────┐
│ MDMS (preferred for everything except the SPA-hardcoded keys)  │
│                                                                 │
│  tenant.theme-config       — palette, font, button shapes       │
│  tenant.tenants.data.logoId — filestore ID of the city logo     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
                                ↓ resolved at runtime
┌────────────────────────────────────────────────────────────────┐
│ digit-ui SPA                                                    │
│                                                                 │
│  globalConfigs.js          — build-time defaults                │
│    DIGIT_FOOTER_BW         BW logo URL                          │
│    DIGIT_FOOTER            colour logo URL                      │
│    DIGIT_HOME_URL          back-to-home target                  │
│  applyTheme.js             — sets --color-* CSS vars from MDMS  │
│  packages/css/             — SCSS with var(--color-*) refs      │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
                                ↓ http
┌────────────────────────────────────────────────────────────────┐
│ filestore                                                       │
│                                                                 │
│  /filestore/v1/files       upload, returns fileStoreId          │
│  /filestore/v1/files/url   resolve fileStoreId → presigned URL  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Task: change palette via configurator wizard (Phase 5)

This is the happy path. The `ThemeConfigEditor` page provides:
- Live mini-DIGIT preview
- Per-token colour pickers (primary, secondary, brand-dark, etc.)
- Save → upserts `tenant.theme-config` MDMS record

**Side effects**: the SPA picks up changes via `applyTheme.js` on next load. Hard refresh after save to see the change in the running citizen UI.

**Known divergence**: the Naipepea Figma uses `#FEC931` yellow buttons + `#204F37` brand-dark, which differ from the default kenya-green palette. If the wizard preview matches but the running SPA doesn't, the SPA's CSS may have a hardcoded hex — see "Theme drift" below.

## Task: swap the city logo

1. **Upload the new logo** to filestore:
   ```bash
   curl -X POST http://localhost:16000/filestore/v1/files \
     -F file=@nairobi-logo.png \
     -F tenantId=ke.nairobi \
     -F module=branding
   # response: {"files":[{"fileStoreId":"abc-123-def", ...}]}
   ```
   Note the returned `fileStoreId`.
   
   **Quirk**: SVG is rejected by default `ALLOWED_FORMATS_MAP` on egov-filestore. Use PNG (recommended) or JPG.

2. **Reference it in MDMS**:
   ```bash
   # Update tenant.tenants record's data.logoId
   curl -X POST http://localhost:16000/mdms-v2/v2/_update/tenant.tenants \
     -H "Content-Type: application/json" \
     -d '{
       "RequestInfo": {"authToken":"'$TOKEN'", "userInfo":{"tenantId":"pg",...}},
       "Mdms": {
         "tenantId": "pg",
         "schemaCode": "tenant.tenants",
         "uniqueIdentifier": "Tenant.ke.nairobi",
         "data": { ..., "logoId": "abc-123-def" }
       }
     }'
   ```
   `_update` requires `userInfo.tenantId` to be set on the `RequestInfo` (mdms-v2 quirk).

3. **Resolve the URL** to verify (the SPA does this automatically):
   ```bash
   curl "http://localhost:16000/filestore/v1/files/url?tenantId=ke.nairobi&fileStoreIds=abc-123-def"
   ```

4. **Hard refresh** the digit-ui — the SPA fetches the URL on load and embeds in the header.

## Task: change footer logos (build-time defaults)

These are the DIGIT-platform footer logos, separate from city branding:

```js
// in globalConfigs.js
var footerBWLogoURL = "https://...your-bw-logo.png";
var footerLogoURL = "https://...your-colour-logo.png";
var digitHomeURL = "https://your-back-to-home";
```

**Where this file actually lives on personal-install** (matters for any `globalConfigs.*` edit, not just footer logos):

The docker `digit-ui` container at `:16080` bind-mounts `local-setup/nginx/globalConfigs.js` from the host into `/var/web/digit-ui/globalConfigs.js` inside. The SPA fetches `/digit-ui/globalConfigs.js` and reads what the host file currently contains. Three things follow:

1. **Editing the host file is enough** — bind mount reflects changes immediately, no rebuild needed.
2. **Atomic writes (sed -i, lineinfile, vite-style temp+rename) break the bind mount** because they swap the inode the container originally bound. Symptom: nginx returns `404 No such file or directory` for `globalConfigs.js`. Fix: `docker restart digit-ui` re-binds the new inode. Documented in `../DEPLOYMENT-NOTES.md` §3.18.
3. **Ansible task in `playbook.yml`** patches `stateTenantId` + `localeRegion` based on `PERSONAL_TENANT_ROOT` from `config.env` when `SEED_DEMO_DATA=true`, then restarts digit-ui. Re-running `up.sh seed` resets the file to the personal-install variant. If you've made other edits that you want preserved, edit the file under a different tenant root or set `SEED_DEMO_DATA=false`.

For naipepea, edit `/opt/digit-ui-esbuild/globalConfigs.js` and `git pull` re-applies if you've committed it.

These are read via `globalConfigs.getConfig('DIGIT_FOOTER_BW')` etc. — UPPER_SNAKE keys; arbitrary names won't work.

## Task: theme drift in citizen UI (the `--color-*` story)

If you set palette via wizard Phase 5 but a particular icon/sidebar/badge stays the old colour, the most likely cause is a hardcoded hex in SCSS that bypasses the var system.

Diagnose:
```bash
# Find hex literals where var(--color-*) should be
grep -rn '#[0-9a-fA-F]\{3,6\}' theflywheel/digit-ui-esbuild/packages/css/src/ \
  | grep -v -E 'var\(|//|/\*'
```

Fix: replace `#abc123` with `var(--color-primary)` (or whichever token applies). PR to `theflywheel/digit-ui-esbuild`. The recently-merged sweep (`fix/theme-token-leaks`) cleaned `GeoLocations.js`, `pages/employee/index.scss`, `pages/employee/workbench.scss` — there may be more.

## How configurator's wizard Phase 5 actually writes the theme

Background — useful when something doesn't update:

1. Save button POSTs to MDMS `_create` (or `_update` if exists) on schema `tenant.theme-config`.
2. The configurator's `ThemeConfigEditor` is a designer-1:1 form (PR #42 on `ChakshuGautam/digit-configurator`).
3. The `applyTheme.js` V3_EXPANSION reads MDMS at load and injects `--color-primary: ...` etc. as inline `<style>` on the document.
4. SCSS in `packages/css/src/` references `var(--color-primary)` etc.

If step 3 silently fails (MDMS read 404 or schema mismatch), the SPA falls back to defaults. Check DevTools network for the MDMS read on theme-config; if 4xx, the schema may not exist at the city tenant — escalate or seed it.

## How to debug "I changed the colour and nothing happened"

1. **Hard refresh the citizen UI** (Cmd-Shift-R / disable cache in devtools). Theme cache is per-tenant in localStorage.
2. **Confirm the MDMS save succeeded.**
   ```bash
   curl -s "http://localhost:16000/mdms-v2/v2/_search" \
     -H "Content-Type: application/json" \
     -d '{"RequestInfo":{"authToken":"'$TOKEN'"},"MdmsCriteria":{"tenantId":"ke.nairobi","schemaCode":"tenant.theme-config","limit":1}}' \
     | jq '.mdms[].data'
   ```
3. **Inspect the rendered DOM.** Open DevTools, click the element that's wrong, check its computed colour. If it's a `var(--color-*)`, the CSS knows; the issue is the inline `<style>` from `applyTheme.js`. If it's a hardcoded hex, see "theme drift" above.
4. **Check for the wizard previewing a tenant other than the one you're viewing.** The configurator can preview any tenant; the citizen UI views one. Confirm both are pointed at `ke.nairobi`.

## How to debug "logo doesn't load"

1. **Check the filestore URL resolves.**
   ```bash
   curl "http://localhost:16000/filestore/v1/files/url?tenantId=ke.nairobi&fileStoreIds=<id>" | jq
   ```
   Expect `fileStoreIds[0].url` populated. If 404 the upload was lost.
2. **Image browser-loadable.** Open the URL directly in browser — auth is presigned and embeded; if 403, the URL has expired (presigned URLs have a TTL).
3. **MDMS has the right ID.** As §"Task: swap the city logo" step 4 — `tenant.tenants.data.logoId` matches what filestore returned.
4. **Check `seq_eg_filestoremap` desync** — after a postgres restore, this sequence can be behind, causing new uploads to collide. `SELECT setval('seq_eg_filestoremap', (SELECT MAX(id)+1 FROM eg_filestoremap));` (escalation territory; documented in `reference_filestore_quirks`).

## When to escalate

- MDMS save returns 200 but doesn't reflect after multiple refreshes — possible MDMS cache desync, restart `egov-mdms-service` and try again.
- Filestore upload returns 200 but fileStoreId can't be resolved — check the filestore container, may need `egov-filestore` log inspection.
- Wizard's `ThemeConfigEditor` UI is itself broken (form fields don't accept input, save button greyed) — that's a configurator bug, file against `ChakshuGautam/digit-configurator`.
