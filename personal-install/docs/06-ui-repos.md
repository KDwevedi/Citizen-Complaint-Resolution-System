# UI repos — where the code lives

When you see a feature on screen and want to find / fix / extend the source, this doc maps URLs and components back to repos.

There are two UI repos:

| Repo | What |
|---|---|
| `ChakshuGautam/digit-configurator` | Admin SPA — onboarding wizard, MDMS CRUD pages, theme editor, dashboard |
| `theflywheel/digit-ui-esbuild` | Citizen + employee SPA — file complaint, inbox, complaint detail, profile |

There's also a **legacy** `theflywheel/digit-configurator` with a long-stale `fix/onboarding-payload-shapes` branch — treat as historical, all new configurator work goes to ChakshuGautam.

## Configurator (ChakshuGautam/digit-configurator)

Tech: React + Vite + react-admin (the admin framework). Built into static `dist/` and served by nginx.

```
src/
├── pages/                 Top-level routes (/, /manage/...)
│   └── (one file per route, mostly thin shells)
├── admin/                 Generic CRUD layer shared across schemas
│   ├── DigitEdit.tsx
│   ├── DigitCreate.tsx
│   ├── DigitList.tsx
│   ├── MdmsResourceList.tsx
│   ├── MdmsResourceEdit.tsx
│   └── schemaDescriptors/ Per-schema UI hints (which fields to show, widget types)
├── resources/             Per-resource pages (override admin/ defaults when needed)
│   ├── employees/
│   ├── complaints/
│   ├── departments/
│   ├── theme-config/
│   └── ...
├── hooks/                 XHR wrappers (e.g. usePgrDashboardData.ts)
└── (...)

packages/
└── data-provider/         react-admin data provider — mediates MDMS, PGR, HRMS, localization shapes
```

Vite config files:
- `vite.config.ts` — production
- `vite.dev.local.ts` — local dev with proxy to Kong (we wrote this; not in upstream)

### Configurator routing
Every route below `/configurator/manage/<resource>` is generated. Adding a new MDMS schema usually only requires:
1. Add an entry in `src/admin/schemaDescriptors/<schema>.ts`
2. Add it to the resource registry (`src/resources/index.tsx` or similar)

If a wizard phase silently fails: check the relevant `resources/<flow>/Phase<n>.tsx` for the XHR + state-machine logic.

### Configurator dev loop
For naipepea: edit source → `npx vite build --base=/configurator/` → copy dist into `/var/www/configurator/`.

For personal-install:
```bash
cd /Users/kanavdwevedi/repositories/egov/digit-configurator
npx vite build --base=/configurator/
# the docker container bind-mounts dist/, but vite delete-and-recreate breaks the inode
docker rm -f configurator && docker compose up -d configurator
```

(See `../DEPLOYMENT-NOTES.md` §3.18 for why the container needs recreating.)

## digit-ui-esbuild (theflywheel/digit-ui-esbuild)

Tech: esbuild bundler with HMR for dev. Two SPAs in one bundle, switched via URL prefix:
- `/digit-ui/citizen` — public-facing
- `/digit-ui/employee` — staff inbox/login

```
products/
└── pgr/
    └── src/
        ├── pages/
        │   ├── citizen/     Create complaint, ComplaintDetails, Inbox (citizen view)
        │   └── employee/    Inbox, ComplaintDetails (employee view), Assign, Resolve
        ├── components/      Reusable UI (PGRBoundaryComponent, GeoLocations, ...)
        └── services/        Client-side API wrappers (BoundaryService, PGRInitialization, ...)

packages/
├── modules/                 Pluggable modules
│   ├── hrms/
│   ├── common/
│   ├── workbench/
│   └── utilities/
├── react-components/        Older shared components
├── digit-ui-components/     Newer component library (Button, Input, Toast, HamburgerButton, ...)
├── libraries/               Shared libs (Digit.Locale, Digit.Hooks, ...)
└── css/                     SCSS theme
    └── src/
        ├── pages/employee/
        └── digitv2/

src/
└── index.js                 Entry point — loads modules

public/
└── globalConfigs.js         Per-deploy config (state-tenant-id, footer URLs, region, etc.)

esbuild.dev.js               Dev server with HMR + API proxy to Kong
esbuild.build.js             Production build
```

### URL → file mapping (cheat sheet)

| URL | Source path |
|---|---|
| `/digit-ui/citizen/sandbox-pgr/create` | `products/pgr/src/pages/citizen/Create/FormExplorer.js` |
| `/digit-ui/citizen/sandbox-pgr/complaint-details/<id>` | `products/pgr/src/pages/citizen/ComplaintDetails.js` |
| `/digit-ui/employee/sandbox-pgr/inbox` | `products/pgr/src/pages/employee/Inbox.js` |
| `/digit-ui/employee/sandbox-pgr/complaint-details/<id>` | `products/pgr/src/pages/employee/ComplaintDetails.js` |
| Login form | `packages/modules/core/src/pages/employee/Login/index.js` (employee) and `packages/modules/core/src/pages/citizen/Login/SelectMobileNumber.js` (citizen) |
| Sidebar | `packages/modules/core/src/components/SideBar.js` |

### digit-ui dev loop

For naipepea: `ssh naipepea "cd /opt/digit-ui-esbuild && git pull"` — esbuild HMR auto-rebuilds in tmux session named `esbuild`. **No docker rebuild needed.** Hard refresh the browser.

For personal-install: ansible's `08-start-digit-ui-esbuild.yml` spawns `node esbuild.dev.js` on host port `:16080`. Edit source → save → HMR rebuilds in <1s; refresh browser.

### Key conventions

- **Localization keys**: UPPER_SNAKE_CASE, `t('CS_COMMON_HELPLINE')`. UPPER required (lowercase keys silently miss bundles).
- **`globalConfigs.getConfig`**: takes UPPER_SNAKE only — `getConfig('STATE_LEVEL_TENANT_ID')` works, `getConfig('stateTenantId')` returns undefined silently.
- **Citizen `name` auto-populates**: from auto-register, `user.name == user.mobileNumber` until overridden via profile.
- **react-leaflet `center` is initial-only**: setting state on `<MapContainer center={...}>` won't move the map. Use `useMap()` hook + `map.setView()`.

## Where to grep when stuck

You can almost always find the source for a feature with:

```bash
# Search both UI repos at once
grep -rn 'Helpline' \
  /Users/kanavdwevedi/repositories/egov/digit-configurator/src/ \
  /Users/kanavdwevedi/repositories/egov/digit-ui-esbuild/products/ \
  /Users/kanavdwevedi/repositories/egov/digit-ui-esbuild/packages/

# Find a localization key reference
grep -rn 't("CS_LOGIN_REGISTER_WITH_EMAIL"\|t(`CS_LOGIN_' digit-ui-esbuild/

# Trace an XHR back to its hook
grep -rn 'mdms-v2/v2/_search' digit-configurator/src/
```

## How to debug "this page is blank"

1. **DevTools console.** Look for unresolved exceptions — most blank pages come from a thrown error in `useEffect` or a render path.
2. **DevTools network tab.** Filter `mdms-v2`, `localization`, `pgr`. The page is likely waiting on a 4xx that has it spinning.
3. **`ra-core` version mismatch** — known issue: the configurator pins `5.14.4` while a sub-package may have `5.14.3`. Dedupe via `npm dedupe` masks it. If you see "two copies of React" or "context not provider"-ish errors, this is likely the cause.
4. **Bundle didn't load** — `view-source:` the HTML. If the `<script src="index-<hash>.js">` is 404, the dist wasn't deployed (configurator) or HMR didn't bind (digit-ui).

## How to debug "this XHR fails"

1. **Compare to a working call** — most failures are `RequestInfo` / `tenantId` / token mismatches. Open the same call from the configurator's wizard (which works) vs. yours.
2. **`docker logs <service>`** — service-side validation errors print here.
3. **Replay with curl** — strip the UI from the equation. If curl works, the bug is on the UI side.

## When to escalate

- A feature exists in both repos but the wiring is broken — typically a `data-provider` mismatch where the configurator expects shape A but the API returns shape B.
- HMR won't rebuild on edit — `tmux attach -t esbuild` (naipepea) or check the `.dev-logs/digit-ui-esbuild.log` (personal-install). Most often a syntax error you didn't notice.
- `npm install` fails on a fresh clone — see `../DEPLOYMENT-NOTES.md` for known-good node version (≥20).
