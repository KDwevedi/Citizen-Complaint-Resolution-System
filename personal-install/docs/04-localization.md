# Localization

Strings in DIGIT live in postgres (`message` table), keyed by `(code, module, locale, tenantId)`. The localization service exposes search + upsert HTTP endpoints. The UI loads bundles per (locale, module, tenant) and caches them in localStorage. This doc covers the data model, how to fix raw-key leaks, how to translate en → sw, and the platform quirks you'll trip on.

> **Personal-install vs live tenants.** All curl recipes below use `http://localhost:16000` (personal-install Kong). On a live tenant (e.g. `https://naipepea.digit.org`) drop the port. The endpoint paths and payloads are identical.

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

What the dedup *doesn't* affect: the same `code` under two different `locale`s in one batch is fine — the dedup is purely on `code` within a request, so per-locale isolation works. (`{code: "X", locale: "en_IN"}` + `{code: "X", locale: "sw_KE"}` in one batch both land.) The pain only kicks in when two same-code rows differ only in `module`.

### Server-side cache bust

The localization service caches per-tenant in memory. After every write, **`_search` keeps returning the pre-write snapshot** until the cache is invalidated. Two ways to bust:

1. **Endpoint (recommended)** — `POST /localization/messages/cache-bust` returns 200 with `{successful: true}`. The configurator's bulk-import calls this automatically after every upsert.
   ```bash
   curl -sS -X POST http://localhost:16000/localization/messages/cache-bust \
     -H "Content-Type: application/json" \
     -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"}}"
   ```
2. **Redis + restart (fallback for older builds)** — only if the cache-bust endpoint isn't available:
   ```bash
   docker exec digit-redis redis-cli DEL messages computedMessages
   docker restart egov-localization
   ```
   Heavier, evicts everyone's session, takes ~30s for the JVM to come back. Use only as a last resort.

## Cache busting on the SPA

There are **three caches** between a write and a user seeing the new string:

1. **Localization service in-memory cache** (server-side) — busted via `POST /localization/messages/cache-bust` (see above).
2. **digit-ui localStorage** (`Digit.Locale.<locale>.<module>` entries, ~24h TTL) — populated lazily on first SPA render after locale switch. Survives page reloads until TTL expires or you clear it.
3. **Configurator React Query cache** (`useAvailableLocales`, 10-min `staleTime`) — only relevant for the locale dropdown on `/manage/localization`. After adding a new locale via the StateInfo editor you may need a hard refresh (or wait 10 min) before the new locale appears in the dropdown.

To force a refresh on the digit-ui side from devtools:

```js
// in the browser console of an open digit-ui or configurator tab
Object.keys(localStorage).filter(k => k.startsWith('Digit.Locale.')).forEach(k => localStorage.removeItem(k));
location.reload();
```

The `Digit.Locale.*` keys store per-(module, locale, tenant) bundles. Newer client code adds `liveStored` / `expiredStored` semantics; older code is stricter — clearing all `Digit.Locale.*` always works.

The active module list per tenant is itself in localStorage at `Digit.Locale.<locale>.List` — if you're scripting an upsert, this is the authoritative list of modules to walk (don't hard-code `rainmaker-common, rainmaker-pgr, rainmaker-hr, rainmaker-workbench` — naipepea also has `digit-ui`, `digit-tenants`, `rainmaker-ke`, `rainmaker-boundary-admin`).

## Common task: add a new language for a new country (e.g. Portuguese for Mozambique)

A "new language" is really three artifacts in three different stores. Get all three in agreement and the dropdown shows the new option, the SPA fetches it on selection, and labels resolve. Skip any one and you get a half-broken state (option visible but no strings, or strings present but option missing, or strings present but SPA still asks for the wrong locale).

The locale code convention is `<lang>_<COUNTRY>` — `pt_MZ` for Mozambique-Portuguese. Use the [ISO-639-1 lang code] + [ISO-3166-1 alpha-2 country code]. Lowercase lang, uppercase country.

### Step 1: Add the language to the picker dropdown — `common-masters.StateInfo.languages`

The citizen `/citizen/select-language` page reads its options from `common-masters.StateInfo[0].languages` MDMS. The exact SPA code lives in `packages/libraries/src/services/molecules/Store/service.js:71-74`:

```js
const stateInfo = MdmsRes["common-masters"]?.StateInfo?.[0] || {};
return {
  languages: stateInfo.hasLocalisation
    ? stateInfo.languages
    : [{ label: "ENGLISH", value: Digit.Utils.getDefaultLanguage() }],
};
```

Three gotchas to notice:
- **`StateInfo[0]`** — first record only. Multiple records present? The SPA silently picks the first. Keep one per tenant.
- **`hasLocalisation: true`** must be set on the record. With `false` the SPA ignores the `languages` array entirely and shows a single hardcoded "ENGLISH" entry. This is the #1 silent failure when adding a new locale.
- **`label`** is rendered literally — no `t()` wrap. `"Português"` shows as "Português" regardless of the active UI language. That's why the existing dropdown shows `ಕನ್ನಡ` in Kannada script even when the SPA is in English.
- **`value`** is the exact locale code the SPA passes to `/localization/messages/v1/_search?locale=...`. Case-sensitive — `pt_MZ` ≠ `pt_mz`. Same convention as `message.locale` in postgres.

The configurator now ships a **StateInfo edit page** at `/configurator/manage/state-info/` (sidebar: **Advanced → State Info**). Click the row, click Edit, edit the `languages` table, add a row:

```json
{ "label": "Português", "value": "pt_MZ" }
```

Verify `hasLocalisation: true` on the same record. Save. Cache-bust the SPA (devtools console: clear `Digit.Locale.*` + reload) and the language picker now shows Português.

**Direct API alternative** (in case the configurator UI has a quirk):

```bash
TOKEN=$(./get-token.sh)  # from 03-login-and-tenants.md

# 1. _search to find the existing StateInfo record's uniqueIdentifier
curl -s -X POST http://localhost:16000/mdms-v2/v2/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"pg\",\"schemaCode\":\"common-masters.StateInfo\"}}" \
  | jq '.mdms[0]'

# 2. _update with the modified data (add to languages[] array)
curl -X POST http://localhost:16000/mdms-v2/v2/_update/common-masters.StateInfo \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {"authToken":"'$TOKEN'", "userInfo":{"tenantId":"pg",...}},
    "Mdms": {
      "tenantId": "pg",
      "schemaCode": "common-masters.StateInfo",
      "uniqueIdentifier": "<from step 1>",
      "data": {
        ...existing fields...,
        "languages": [
          ...existing entries...,
          {"label":"Português","value":"pt_MZ"}
        ]
      }
    }
  }'
```

`_update` requires `userInfo.tenantId` in the RequestInfo (mdms-v2 quirk). Without it, returns `MISSING_TENANT_ID`.

### Step 2: Bulk-load the strings for the new locale

The configurator now has a **localization bulk import** page at `/configurator/manage/localization/bulk` with a Download Template button + an Upload pane. The XLSX template has columns: `code`, `module`, `locale`, `message` — **no `tenantId` column**: the tenant comes from the active session, not the file. Fill in your translations, set `locale=pt_MZ` for every row, upload.

The configurator groups rows by locale and calls `_upsert` once per locale (so the dedup-by-code-in-batch bug only matters across modules, not locales — see above). After all upserts complete it calls the cache-bust endpoint automatically; you only need to hard-refresh the browser to drop the SPA's localStorage cache.

**Export** (handy for translation handoff): the same screen has an Export button at the top right. It downloads an .xlsx with all messages for the **two locales currently selected in the pivot view's Compare locales dropdowns** — sorted by `(locale, module, code)` so cross-export diffs are clean. Same `code, module, locale, message` shape that bulk-import accepts, so the round-trip (export → edit → re-import) is symmetric.

**Direct API alternative**:

```bash
# Per-module batch — 4-5 modules total. Send each one as a separate _upsert call
# to dodge the dedup-by-code-in-batch bug (DEV-LOG §12).
for module in rainmaker-common rainmaker-pgr rainmaker-hr rainmaker-workbench; do
  curl -X POST http://localhost:16000/localization/messages/v1/_upsert \
    -H "Content-Type: application/json" \
    -d '{
      "RequestInfo": {"authToken":"'$TOKEN'"},
      "tenantId": "pg",
      "messages": [
        {"code":"CS_COMMON_HELPLINE","module":"'$module'","locale":"pt_MZ","message":"Linha de apoio"},
        ...
      ]
    }'
done
```

The `messages[]` array is per-locale: send all `pt_MZ` rows for one module in one call, then move to the next module.

For bulk translation work, naipepea has `translate_rest.py` + `resync-nairobi.py` on the box (DEV-LOG §12) — they batch by module and use Google Translate to fill missing locales from a source locale. Pattern adapts straightforwardly:

```bash
ssh naipepea "cd /opt/egov && PG_PORT=15432 python3 translate_rest.py \
    --source-locale en_IN --target-locale pt_MZ \
    --source-tenant ke --target-tenant <your-tenant>"
```

(That tool isn't yet adapted on personal-install — copy from `/opt/egov` if you want to use it locally; for one-off Portuguese seeding the configurator's bulk-import is simpler.)

### Step 3: Point the SPA at the new locale

The SPA constructs its locale string as `<localeDefault>_<localeRegion>`. To make the citizen UI default to `pt_MZ`:

```js
// local-setup/nginx/globalConfigs.js  (bind-mounted into the digit-ui container)
var localeDefault = "pt";
var localeRegion = "MZ";
```

After the edit: `docker restart digit-ui` (the bind-mount inode swap from atomic write — DEPLOYMENT-NOTES §3.18 — needs the restart).

If `pt_MZ` is just an alternative the user can pick (vs the default), leave `globalConfigs.js` alone and let the user select Português from the dropdown after step 1 — the SPA handles the switch via `selectedLanguage` localStorage.

### Step 4: Cache-bust everywhere

```bash
# server-side cache (Redis hashes) — busts the in-memory localization service cache
docker exec digit-redis redis-cli DEL messages computedMessages
docker restart egov-localization

# wait for the JVM to come back up
until [ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST 'http://localhost:16000/localization/messages/v1/_search?locale=pt_MZ&module=rainmaker-common&tenantId=pg' -H 'Content-Type: application/json' -d '{}')" = "200" ]; do sleep 5; done
```

```js
// browser localStorage — needs to be cleared per-session
Object.keys(localStorage).filter(k=>k.startsWith('Digit.Locale.')).forEach(k=>localStorage.removeItem(k))
location.reload()
```

### Step 5: Verify

```bash
# strings landed?
curl -s -X POST 'http://localhost:16000/localization/messages/v1/_search?locale=pt_MZ&module=rainmaker-common&tenantId=pg' \
  -H 'Content-Type: application/json' -d '{}' \
  | jq '.messages | length'
# expect: number of rows you uploaded

# language in the dropdown?
curl -s -X POST http://localhost:16000/mdms-v2/v2/_search \
  -H "Content-Type: application/json" \
  -d "{\"RequestInfo\":{\"authToken\":\"$TOKEN\"},\"MdmsCriteria\":{\"tenantId\":\"pg\",\"schemaCode\":\"common-masters.StateInfo\"}}" \
  | jq '.mdms[0].data.languages'
# expect: includes {"label":"Português","value":"pt_MZ"}

# SPA rendering?
# Open http://localhost:16080/digit-ui/citizen/select-language → select Português → labels render in Portuguese
```

### Common failures

- **Dropdown shows new language but labels don't switch on selection** → SPA's `Digit.Locale.<locale>.*` localStorage cached the old empty result. Clear via the snippet in step 4.
- **Selection works but labels show raw upper-snake** → strings weren't actually inserted. `_search` to confirm row count > 0; if 0, the upload silently dropped them (likely the dedup-by-code-in-batch bug — re-upload one module at a time).
- **`_search` 200s but returns empty** even though the DB has rows → server cache was poisoned during a previous OOM. Run the cache-bust in step 4.
- **SPA hangs for ~55s on every locale switch** → no rows for that (tenant, locale, module) combo; localization service does a full table scan on misses. Either seed the strings or revert to a locale that has data.

## Common task: fix a raw-key leak

Symptom: UI shows `CS_LOGIN_REGISTER_WITH_EMAIL` literally instead of "Login or register with email".

> **The double-underscore trap.** When a workflow-action MDMS-driven dropdown declares `populators.mdmsConfig.localePrefix: "CS_REJECTION_"` and the master record's value is `OUTSIDE_JURISDICTION`, the form composes the lookup key as `localePrefix + "_" + code` — that is, an explicit underscore is added on top of the prefix's trailing one. So the locale lookup is the **double-underscore** key `CS_REJECTION__OUTSIDE_JURISDICTION`. If you upsert the single-underscore variant nothing renders. Verified live 2026-05-01 fixing CCRS#489 (Reject Complaint reason dropdown). When the screen shows a raw key, copy it character-by-character before assuming you know how it's spelled.

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
