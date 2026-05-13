# Ansible & up.sh cheatsheet

`scripts/up.sh` is a thin wrapper around `docker compose` + `ansible-playbook`. Once you know which mode does what and which tag covers which task, you can re-run just the slice that changed instead of waiting through a full bring-up.

## The four up.sh modes

| Mode | What runs | When to use it |
|---|---|---|
| `stack` | `docker compose pull` + `up -d`, wait for `kong-gateway` healthy. No ansible. | You only want containers up — no seed, no configurator build, no UI mode toggle. Rare in day-to-day use. |
| `seed` | `ansible-playbook` against `playbook.yml`. Idempotent. | You want to (re-)run seed tasks against an already-running stack. Pass extra args after `seed` and they flow through to ansible (e.g. `seed --tags localization`). |
| `all` (default) | `stack` then `seed`. | Cold start, or after `compose down -v`. This is what you run when in doubt. |
| `apply` | `compose up -d` (recreates services whose env/heap changed) → `kong reload` → `docker restart digit-ui` (re-reads bind-mounted nginx conf + globalConfigs.js) → `seed`. | After `git pull` on this repo. Picks up compose YAML diffs, kong route changes, and nginx config tweaks without a full bring-up. |

Usage:

```bash
./scripts/up.sh                       # = ./scripts/up.sh all
./scripts/up.sh seed                  # re-run all seed tasks
./scripts/up.sh seed --tags localization   # re-run just locale copy
./scripts/up.sh apply                 # after git pull
```

## `SEED_DEMO_DATA` — what it gates

Read by ansible at playbook time via `lookup('env', 'SEED_DEMO_DATA')` (`inventory.yml:18`). No container reads it; setting it inline on the up.sh invocation is sufficient.

```bash
SEED_DEMO_DATA=false ./scripts/up.sh
```

| Task (in playbook.yml order) | Tags | Runs when `SEED_DEMO_DATA=false`? |
|---|---|---|
| 02-seed-tenants — create `ke` + `ke.nairobi` | `tenants, seed` | skipped |
| 03-seed-boundaries — county → sub-county → ward | `boundaries, seed` | skipped |
| 10-create-pgr-mvs — PGR dashboard materialized views | `pgr-mv, db, seed` | runs (operator-agnostic DDL) |
| 11-seed-localizations — copy `statea.g`/`en_IN` → digit-ui's tenant | `localization, seed` | skipped |
| 12-mirror-boundaries-to-spa-tenant — `ke.nairobi` → `pg` mirror | `boundaries, seed` | skipped |
| 13-load-naipepea-mdms-fixture — 4,377-row Nairobi fixture | `mdms-fixture, mdms, seed` | skipped |
| 09-ensure-configurator — vite build + probe | `configurator, ui` | runs (wizard host) |
| digit-ui mode toggle (esbuild HMR or docker container) | `esbuild, ui, always` | runs (mode toggle, not seed) |

**Plain-mode baseline** (`SEED_DEMO_DATA=false`): bootstrap `pg` + `statea` tenants are present from CCRS local-setup (31 schemas at `pg`, 22 role records, 13 Department + 29 Designation + 33 ServiceDef records, PGR workflow at the state level, `ADMIN@pg`/`eGov@123` for sign-in). PGR materialized views exist. Configurator is built and reachable. No `ke`/`ke.nairobi` data, no Nairobi fixture — the wizard owns everything from here.

**Seeded mode** (default): everything above, plus the full Nairobi-flavoured stack — `ke.nairobi` tenant, county/sub-county/ward boundaries, the 4,377-row MDMS fixture, mirrored boundaries for the citizen SPA, and seeded locale strings. Good for "I just want a working DIGIT to poke at."

## Tag catalog

```bash
./scripts/up.sh seed --tags <tag>           # run only these tasks
./scripts/up.sh seed --skip-tags <tag>      # run everything except these
```

| Tag | Covers | Use it when … |
|---|---|---|
| `tenants` | 02-seed-tenants | You wiped `tenant.tenants` and want `ke`/`ke.nairobi` back. |
| `boundaries` | 03-seed-boundaries, 12-mirror-boundaries-to-spa-tenant | Citizen complaint flow errors `LOWEST_LEVEL_CONFIG_NOT_PRESENT` or boundary search returns empty. |
| `pgr-mv` (or `db`) | 10-create-pgr-mvs | PGR dashboard shows `BadSqlGrammarException ... pgr_mv_kpi`. |
| `localization` | 11-seed-localizations | Citizen UI shows raw keys (`CS_COMMON_HELPLINE`, `LOGIN_WITH_EMAIL`). |
| `mdms-fixture` (or `mdms`) | 13-load-naipepea-mdms-fixture | Wizard Phase 4 panel shows "Available data: 0" everywhere, or citizen home has duplicate tiles. |
| `configurator` (or `ui`) | 09-ensure-configurator | After editing configurator source — rebuilds `dist/` and re-probes. (Note: up.sh's pre-flight also rebuilds if source is newer than `dist/index.html`.) |
| `esbuild` (or `ui`) | digit-ui mode toggle + 08-start-digit-ui-esbuild | After flipping `USE_ESBUILD_HMR` in `config.env`, or after digit-ui container went sideways. |
| `seed` | All `_demo_data`-gated tasks above + pgr-mv | Re-seed everything that depends on demo data, skip the UI mode toggle. |
| `always` | Playbook intro/recap blocks and the digit-ui mode toggle | Auto-included on every run regardless of `--tags`. You shouldn't pass this explicitly. |
| `never` | Stub tasks (04-seed-mdms, 05-seed-employees, 06-seed-pgr, 07-seed-admin) | Never runs by default. To force one of these old paths, pass `--tags=stubs -e enable_stubs=true`. The wizard supersedes all of them. |

## "I changed X — re-run Y" matrix

| You changed … | Run this |
|---|---|
| `stack/docker-compose.yaml` (env, heap, ports, new service) | `./scripts/up.sh apply` — recreates affected services. |
| `stack/kong.yml` (routes, plugins) | `./scripts/up.sh apply` — `kong reload` picks it up without a container restart. |
| `stack/nginx/globalConfigs.js` or other bind-mounted nginx conf | `./scripts/up.sh apply` — restart of `digit-ui` re-reads the bind-mount. |
| `personal-install/ansible/tasks/*.yml` or `playbook.yml` | `./scripts/up.sh seed [--tags <relevant tag>]`. |
| `digit-configurator` source (sibling clone) | up.sh's pre-flight rebuilds `dist/` if source is newer; for an explicit rebuild + probe, `./scripts/up.sh seed --tags configurator`. |
| `digit-ui-esbuild` source (sibling clone) | up.sh's pre-flight rebuilds the bundle if any file under `products/`, `packages/`, `public/`, or `package.json` is newer than `build/index.html`. With `USE_ESBUILD_HMR=true` you don't need to re-run — esbuild watches. |
| Wanted to toggle HMR on/off | Edit `USE_ESBUILD_HMR` in `config.env`, then `./scripts/up.sh seed --tags esbuild`. |
| Wiped `localization_messages` | `./scripts/up.sh seed --tags localization`. |
| Wiped `eg_boundary_*` tables | `./scripts/up.sh seed --tags boundaries`. |
| Want to test a new tenant under a brand-new state | Don't re-run ansible — use the configurator wizard, which bootstraps in-flight. See [07-bootstrap-new-state.md](07-bootstrap-new-state.md). |
| Containers in `Restarting`, kong unhealthy, port collision | `docker compose -f stack/docker-compose.yaml -p personal-install down` then `./scripts/up.sh`. See `../DEPLOYMENT-NOTES.md` §3. |

## Where the files live

```
personal-install/
├── scripts/up.sh              # the wrapper
├── config.env                 # CONFIGURATOR_DIR, UI_ESBUILD_DIR, PORT_PREFIX, USE_ESBUILD_HMR
└── ansible/
    ├── inventory.yml          # reads SEED_DEMO_DATA from env; defines tenant codes, ports
    ├── playbook.yml           # 12 tasks + stubs + recap
    └── tasks/
        ├── 02-seed-tenants.yml
        ├── 03-seed-boundaries.yml
        ├── 04-seed-mdms.yml          (stub, never)
        ├── 05-seed-employees.yml     (stub, never)
        ├── 06-seed-pgr.yml           (stub, never)
        ├── 07-seed-admin.yml         (stub, never)
        ├── 08-start-digit-ui-esbuild.yml
        ├── 09-ensure-configurator.yml
        ├── 10-create-pgr-mvs.yml
        ├── 11-seed-localizations.yml
        ├── 12-mirror-boundaries-to-spa-tenant.yml
        └── 13-load-naipepea-mdms-fixture.yml
```

## See also

- [README.md](../README.md) — full setup walkthrough.
- [DEPLOYMENT-NOTES.md](../DEPLOYMENT-NOTES.md) — known bring-up failures (§3).
- [07-bootstrap-new-state.md](07-bootstrap-new-state.md) — when the wizard, not ansible, sets up a new state root.
