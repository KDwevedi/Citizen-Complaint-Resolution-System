# Localization

Strings in DIGIT live in postgres (`message` table), keyed by `(code, module, locale, tenantId)`. The localization service exposes search + upsert HTTP endpoints. The UI loads bundles per (locale, module, tenant) and caches them in localStorage. This doc covers the data model, how to fix raw-key leaks, how to translate en → sw, and the platform quirks you'll trip on.

## Data model

| Field | Example | Notes |
|---|---|---|
| `code` | `CS_COMMON_HELPLINE` | UPPER_SNAKE_CASE convention; primary key with module/locale/tenant |
| `module` | `rainmaker-common` | Bundle namespace; UI loads modules separately |
| `locale` | `en_IN`, `sw_KE`, `default` | Language + region; `default` = fallback |
| `tenantId` | `ke`, `ke.nairobi` | Records inherit upward implicitly only via UI; **the API doesn't inherit** — search a city tenant, get only that tenant's records |
| `message` | `Helpline` | The displayed string |

Modules you'll touch most:
- `rainmaker-common` — chrome, login, sidebar
- `rainmaker-pgr` — citizen/employee complaint flows
- `rainmaker-hr` — HRMS forms
- `rainmaker-workbench` — admin tools

## Search
```
POST /localization/messages/v1/_search?locale=en_IN&module=rainmaker-pgr&tenantId=ke
{ "RequestInfo": { ... } }
```

Returns `{messages: [{code, module, locale, message}, ...]}`.

**Always pass `locale=` in the URL** — without it the server returns 400. `globalConfigs.localeDefault`/`localeRegion` on the SPA build them; if you're scripting, set them yourself.

## Upsert
```
POST /localization/messages/v1/_upsert
{
  "RequestInfo": { ... },
  "tenantId": "ke",
  "messages": [
    { "code": "CS_COMMON_HELPLINE", "module": "rainmaker-common", "locale": "en_IN", "message": "Helpline" }
  ]
}
```

Overwrites by `(code, module, locale, tenantId)` keys. No `_delete` — use upsert with empty/sentinel value if you must clear.

### The dedup-by-code-in-batch bug

`_upsert` dedupes by `code` *within a single request*, ignoring `module`. If your batch contains the same code under two modules (e.g. `CS_COMPLAINT_LOCALITY` lives under both `rainmaker-pgr` and `rainmaker-hr`), the **second occurrence is silently dropped server-side**.

**Workaround: batch by module.** Send one request per module. Picked up the missing 25 rows in `Nai Pepea/docs/DEV-LOG.md` §12 once we did this. Don't fight it; just plan for it.

## Cache busting on the SPA

After an upsert, the live UI won't pick up changes until its localStorage cache invalidates. Force this from devtools:

```js
// in the browser console of an open digit-ui or configurator tab
Object.keys(localStorage).filter(k => k.startsWith('Digit.Locale.')).forEach(k => localStorage.removeItem(k));
location.reload();
```

The `Digit.Locale.*` keys store per-(module, locale, tenant) bundles. Newer client code adds `liveStored` / `expiredStored` semantics; older code is stricter — clearing all `Digit.Locale.*` always works.

## Common task: fix a raw-key leak

Symptom: UI shows `CS_LOGIN_REGISTER_WITH_EMAIL` literally instead of "Login or register with email".

Diagnose:
1. **Is the key referenced in source?** `grep -rn 'CS_LOGIN_REGISTER_WITH_EMAIL' theflywheel/digit-ui-esbuild/` — confirms it's an actual key the UI looks up.
2. **Is it in the DB?**
   ```bash
   curl -s "http://localhost:16000/localization/messages/v1/_search?locale=en_IN&module=rainmaker-common&tenantId=ke" \
     -H "Content-Type: application/json" \
     -d '{"RequestInfo":{"authToken":"'$TOKEN'"}}' \
     | jq '.messages[] | select(.code=="CS_LOGIN_REGISTER_WITH_EMAIL")'
   ```
3. **If absent, upsert it** (both `default` and `en_IN`, plus `sw_KE` if a Kenya deployment):
   ```bash
   curl -X POST http://localhost:16000/localization/messages/v1/_upsert \
     -H "Content-Type: application/json" \
     -d '{
       "RequestInfo": {"authToken":"'$TOKEN'"},
       "tenantId": "ke",
       "messages": [
         {"code":"CS_LOGIN_REGISTER_WITH_EMAIL","module":"rainmaker-common","locale":"en_IN","message":"Login or register with email"},
         {"code":"CS_LOGIN_REGISTER_WITH_EMAIL","module":"rainmaker-common","locale":"default","message":"Login or register with email"}
       ]
     }'
   ```
4. **Cache-bust the browser** (snippet above), reload. Key resolves.

For source-of-truth: also add to `utilities/default-data-handler/src/main/resources/localisations/{default,en_IN,sw_KE}/<module>.json` so a fresh `default-data-handler` seed of a new tenant doesn't reintroduce the gap. PR-merging that file is what `gh pr view 13` on `ChakshuGautam/CCRS` is doing.

## Common task: translate en → sw bulk

For Kenya pilot we ran a full en_IN → sw_KE pass at `tenantId=ke` (~4,200 entries). The scripts live on naipepea:

```bash
# at /opt/egov on naipepea
ssh naipepea "cd /opt/egov && PG_PORT=15432 python3 translate_rest.py --stage all"
```

`translate_rest.py` extracts every en_IN code at `tenantId=ke` lacking a sw_KE sibling, translates via Google (cache at `/tmp/translation-cache.json` — 2,650+ pairs reused across runs), upserts.

To copy ke's sw_KE → ke.nairobi (which doesn't auto-inherit):
```bash
ssh naipepea "python3 /tmp/resync-nairobi.py"
```

This batches **one module per request** to dodge the dedup bug. The earlier copy (without that fix) lost 25 rows.

For your local personal-install stack (no real translation API needed), just upsert the keys you need manually.

## ServiceDef labels (citizen complaint dropdown)

The citizen "select complaint type" dropdown reads from `RAINMAKER-PGR.ServiceDefs.name` directly — **not** wrapped in `t()`. So whatever `name` field the MDMS record has shows up literally. The 37 ke.nairobi service defs ship with literal upper-snake names (`LAND OWNERSHIP DISPUTE`).

Two ways to fix:

1. **MDMS data fix** — title-case the `name` field on each service def. Persistent and clean.
2. **UI patch** — wrap the dropdown option in `t(\`SERVICEDEFS.${serviceCode.toUpperCase()}\`)` and add the keys (which already exist for some service codes in `rainmaker-pgr`). Requires PR to `theflywheel/digit-ui-esbuild`.

Pick option 1 unless the `name` field is consumed by something else that wants the upper-snake form.

## Locale-region on the SPA

`globalConfigs.js` has:
```js
localeDefault = "en";
localeRegion = "IN";  // or "KE"
```
The SPA composes `<localeDefault>_<localeRegion>` → `en_IN`. If `localeRegion` is missing, you get `en_undefined` in `_search` URLs which 400s and produces an empty bundle (so every key shows raw). If your install uses a region other than IN, set both.

For personal-install: `08-start-digit-ui-esbuild.yml` writes a `globalConfigs.personal-install.js` with `localeRegion="KE"` when `seed_demo_data=true`, else `IN`.

## How to debug missing strings

1. **Open the page that's leaking the key.** Note the literal value displayed.
2. **DevTools → Network → filter `localization/messages/v1/_search`.** You'll see one request per module the page loads.
3. **Check the response body** for the leaked code:
   ```js
   // in the response payload
   messages.find(m => m.code === 'CS_COMMON_HELPLINE')
   ```
4. **If absent**, upsert it (curl above).
5. **If present but UI still shows raw**, cache-bust localStorage + hard refresh.
6. **Still raw after cache-bust**, check the module name on the request URL matches what the source expects. Some keys live in `rainmaker-common`, others in `rainmaker-pgr`; mis-routing is silent.

## When to escalate

- A code IS in the DB at the right (module, locale, tenant) and cache is busted, but the UI shows raw — this is `LocalizationStore.get()` returning null on the per-module map. Known bug: see `feedback` memory `digit_localization_quirks` and patches PR'd to `theflywheel/digit-ui-esbuild` (#18).
- Bulk translate fails because the Google API key is missing — that's an env issue, escalate.
- Upsert returns success but `_search` after doesn't show the row — check for the dedup-by-code bug; if you can rule that out, it's a postgres write that didn't commit — escalate with the request/response.
