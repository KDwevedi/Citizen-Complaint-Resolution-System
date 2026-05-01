# Deployment notes — what we hit, what we fixed, what's still rough

A field log for `personal-install`. The README tells you how to use it. This doc tells you what's been *known to break* during real bring-ups, the fixes that landed in this branch, and a list at the bottom of things still worth improving.

If you're standing this up on a new laptop and something looks weird, scan §3 first — the answer is probably already in there.

---

## 1. What lives where

```
personal-install/
├── config.env                  Single source of truth (port prefix, OS, tenants, creds, REGISTRY_URL)
├── stack/
│   └── docker-compose.yaml     Single consolidated compose — 28 services, port-shifted, registry images
├── ansible/
│   ├── playbook.yml
│   └── tasks/
│       ├── 02-seed-tenants.yml         creates root + city tenants in MDMS
│       ├── 03-seed-boundaries.yml      county → sub-county → ward + hierarchy + relationships
│       ├── 08-start-digit-ui-esbuild.yml   spawns host-side esbuild HMR (optional)
│       ├── 09-ensure-configurator.yml      builds vite dist + probes container
│       ├── 10-create-pgr-mvs.yml           PGR dashboard materialized-view DDL
│       └── 04–07*.yml                  stubs (configurator wizard owns these)
├── sql/pgr-mv.sql              MV DDL extracted via pg_dump from a working production
├── scripts/
│   ├── up.sh                   docker compose pull + up + ansible (mode-driven)
│   └── down.sh                 docker compose down (-v for volume reset)
├── data/                       seed JSON: boundaries, employees, mdms (symlink-tracked)
└── README.md                   user-facing usage doc
```

The post-`up.sh` URL set (with `PORT_PREFIX=16`):

| Surface | URL |
|---|---|
| digit-ui (citizen + employee SPA) | http://localhost:16080/digit-ui/ |
| configurator (admin SPA) | http://localhost:16172/configurator/ |
| Kong API gateway | http://localhost:16000/ |
| Kong admin | http://localhost:16001/ |
| Gatus health board | http://localhost:16889/ |
| MinIO console | http://localhost:19001/ (`minioadmin`/`minioadmin`) |
| Postgres | `localhost:15432` (`egov`/`egov123`) |
| Redpanda Kafka | `localhost:19092` |
| Redis | `localhost:16379` |

Login as `ADMIN` / `eGov@123` on tenant `pg`.

---

## 2. The shape of the system (just enough to debug)

### Compose layout — single file
We **used to** have a three-layer overlay (`docker-compose.deploy.yaml` + `.local.yaml` + `.naipepea.yaml` + `.extra.yaml`). It was confusing, hard to reason about, and one of the layers wasn't even committed in early iterations because the `stack/` dir was a symlink to a sibling repo. We collapsed it into a **single `docker-compose.yaml`** that already has port-shifting, registry images, and the configurator service baked in. `up.sh` now passes one `-f`. If you're searching commit history for the older split, see commits before `5d5580a2`.

### Tenant scopes in MDMS
Tenant *records* (in schema `tenant.tenants`) live at `Mdms.tenantId=<bootstrap>` (e.g. `pg`). Their `data.tenantId` is the tenant they describe. Each MDMS schema is registered against one tenant; queries from other tenants pass through if the schema permits cross-tenant reads. This trips people up — search results may be empty because you queried the wrong scope, not because data is missing.

### Image source — the registry, not Docker Hub
`egovio/*` on Docker Hub is months stale. The compose uses `${REGISTRY_URL}/...` — set `REGISTRY_URL` in `config.env` to your registry mirror. The registry is anonymously pullable; no `docker login` needed. Three services don't reconcile:

| Service | Why it stays on a public/built image |
|---|---|
| `telemetry` | Not present in the reference deployment |
| `egov-workflow-v2` | Reference uses a locally-built `:sla-reset` tag — to mirror, `docker save` from a working host and `docker load` here |
| `jupyter` | Reference uses a registry image; we baked one in, but it's optional and unused |

### The :inbox-filters pin for pgr-services
The registry's `:latest` for `pgr-services-dev` was overwritten with a build that lacks the `/v2/dashboard` route. The compose pins `:inbox-filters` (sha `224773a276e5`) — that's the named tag of the SHA the reference deployment runs. **Don't bump to `:latest` casually**; verify the dashboard endpoint still exists.

### PGR dashboard depends on materialized views
4 MVs in postgres: `pgr_mv_kpi`, `pgr_mv_monthly`, `pgr_mv_monthly_source`, `pgr_mv_dimension`. pgr-services has a `DashboardRefreshScheduler` that **REFRESHES** them every minute but doesn't **CREATE** them. DDL is in `sql/pgr-mv.sql`, applied by `10-create-pgr-mvs.yml`. Without this task, `/manage/pgr-dashboard` returns `BadSqlGrammarException ... pgr_mv_kpi`.

### Apple Silicon
Reference images are amd64-only. `up.sh` exports `DOCKER_DEFAULT_PLATFORM=linux/amd64` automatically when `OS=auto` detects macOS arm64. JVM cold-start under Rosetta is ~2× slower; compose dependency healthchecks may flap on first run. Bump Docker Desktop RAM to ≥12 GB or healthchecks will time out before JVMs are warm.

### Ansible vs configurator — division of labor
Ansible only does what a SPA *can't* do: stack bring-up, raw MDMS tenant create, raw boundary seed, MV DDL, esbuild HMR spawn. Everything else (roles, departments, designations, complaint types, employees, theme) is intentionally driven through the configurator's onboarding wizard at `localhost:16172/configurator/`. We tried to ansible-seed those once; collisions with wizard idempotency made it worse, not better.

---

## 3. Deployment fixes — what broke during real bring-ups

These all landed in `feat/personal-install`. Listed roughly in the order we hit them. If you find one breaking again, the fix is already in the branch — but the *cause* is described so you can recognize the symptom.

### 3.1 Bash 3.2 (macOS default) doesn't support associative arrays
**Symptom:** `up.sh: declare: -A: invalid option` on macOS.
**Cause:** macOS ships bash 3.2 by default; associative arrays need bash 4+.
**Fix:** Switched to parallel arrays. `up.sh` now runs on stock macOS bash. Don't reintroduce `declare -A` without a `#!/usr/bin/env bash` + version check.

### 3.2 UTF-8 ellipsis glued onto a variable name
**Symptom:** `${PORT_PREFIX…}` expanded to nothing — bash treated the ellipsis bytes as part of the var name.
**Fix:** Always brace-quote when followed by non-ASCII: `${PORT_PREFIX}…` not `$PORT_PREFIX…`. Search the codebase for `…` and verify all are outside variable expansions.

### 3.3 Configurator path math broken across hosts
**Symptom:** Ansible couldn't find the configurator source — the path `../../../egov/digit-configurator` was hardcoded relative to a specific layout that didn't exist on a fresh clone.
**Fix:** Made `CONFIGURATOR_DIR` configurable in `config.env` (default: sibling of `personal-install`). Same for `UI_ESBUILD_DIR`. If you don't have those siblings, both ansible tasks no-op gracefully (the docker `digit-ui` and `digit-configurator` containers still serve).

### 3.4 Ansible `include_tasks` swallowed tags
**Symptom:** `ansible-playbook --tags=pgr-mv` ran zero tasks even though `10-create-pgr-mvs.yml` was tagged.
**Cause:** When you `include_tasks: foo.yml` with `tags: [pgr-mv]`, the include itself is tagged but the included tasks aren't.
**Fix:** Use `apply: { tags: [pgr-mv] }` on the `include_tasks`, not just `tags:`. See `playbook.yml`.

### 3.5 MDMS `_create` returns 202 sometimes
**Symptom:** Ansible reported tenant create failed; manual curl showed it succeeded.
**Cause:** MDMS `_create` returns `202 Accepted` (async) under load, not `200/201`.
**Fix:** Accept `[200, 201, 202]` as success codes everywhere. Don't tighten this — different DIGIT versions return different codes.

### 3.6 BoundaryHierarchy null handling
**Symptom:** `_search` returned `BoundaryHierarchy: null` and ansible blew up trying to iterate it.
**Fix:** `| default([], true)` on every list traversal of MDMS search results. `_search` shapes are inconsistent across DIGIT versions.

### 3.7 Boundary relationships are POST-only
**Symptom:** Ansible used `_upsert` to register parent-child boundary relationships and got 405.
**Fix:** Boundary relationships only support `_create` (POST). Use `failed_when: status not in [200, 201, 202, 409]` so re-runs idempotently no-op on `409 DUPLICATE_RECORD`.

### 3.8 `DUPLICATE_RECORD` whitelist for re-runs
**Symptom:** Second `up.sh seed` failed because tenants already existed.
**Fix:** Whitelist `DUPLICATE_RECORD` errors across all create operations. The whole playbook is now safe to re-run on a populated stack — reports `0 changed` if nothing's missing.

### 3.9 pgr-services `:latest` tag drift
**Symptom:** `/v2/dashboard` returned `404 No static resource`.
**Cause:** Registry's `:latest` for `pgr-services-dev` was overwritten with a build that doesn't have the dashboard route.
**Fix:** Pin to `:inbox-filters` (sha `224773a276e5`). Documented in §2 above. **Don't unpin without verifying the dashboard route.**

### 3.10 PGR materialized views missing on a fresh stack
**Symptom:** `/manage/pgr-dashboard` returned `BadSqlGrammarException ... relation "pgr_mv_kpi" does not exist`.
**Cause:** pgr-services REFRESHES MVs but doesn't CREATE them. The reference production has them from a hand-applied DDL.
**Fix:** Captured the DDL via `pg_dump --schema-only`, committed as `sql/pgr-mv.sql`, applied by `10-create-pgr-mvs.yml`. Initial REFRESH happens in the same task so the dashboard works before the scheduler ticks.

### 3.11 JVM healthcheck flap under Rosetta
**Symptom:** `docker compose up -d` halts: *"dependency egov-localization is unhealthy"*.
**Cause:** JVM cold-start under Rosetta takes ~2 min; compose's default healthcheck timeout (90 s) flaps before the service is up.
**Fix (operational):** Re-run `up.sh stack`. The compose flow is idempotent; second pass picks up warmed JVMs. We did **not** loosen the healthcheck timeouts — that would mask actual unhealthiness. See §4.4 for a better long-term fix.

### 3.12 digit-ui kong DNS race
**Symptom:** `digit-ui` container exits with `host not found in upstream "kong"`.
**Cause:** nginx resolves upstream hostnames at startup. If kong's DNS isn't yet registered in the docker network, nginx fails permanently.
**Fix (operational):** `docker restart digit-ui` after kong is healthy. We did **not** add `restart: on-failure` (would mask actual config errors). See §4.5 for a better long-term fix.

### 3.13 Stale container blocked compose up
**Symptom:** `up.sh` failed with `Conflict. The container name "/digit-ui" is already in use`.
**Cause:** The compose file declares `container_name: digit-ui`. That name lives in docker's *global* namespace — a partial run from a previous attempt left a dead container squatting on the name.
**Fix (operational):** `docker rm -f digit-ui && ./scripts/up.sh`. `up.sh` now prints this recovery hint when compose up fails. See §4.1 for the long-term fix.

### 3.14 `--progress=plain` not on older docker compose
**Symptom:** `compose: unknown flag: --progress`.
**Fix:** Removed from `up.sh`'s `pull` invocation. Older Docker Desktop versions don't have it.

### 3.15 `--quiet` looked hung to humans
**Symptom:** "It's been 8 minutes, is it stuck?"
**Cause:** `up.sh` had `compose pull --quiet` — no progress output, just a blinking cursor while a multi-GB pull ran.
**Fix:** Removed `--quiet`. You see image-by-image progress now.

### 3.16 Jupyter being **built** from scratch
**Symptom:** Cold `up.sh` spent ~10 min on apt-get + pip install.
**Cause:** Compose had `build:` for jupyter, not `image:`.
**Fix:** Replaced with `image: ${REGISTRY_URL}/tilt-demo-jupyter:latest`. If your registry doesn't have it, the service is non-critical (notebooks are unused in the citizen flow) — comment it out.

### 3.17 Layered compose was confusing humans
**Symptom:** "wait, what does this `-f` chain even do?"
**Cause:** 4 compose files layered with `-f` flags is hard to read.
**Fix:** Collapsed to single `docker-compose.yaml`. Port-shifts and registry overrides are now inline. One file, one mental model.

### 3.18 Bind-mount inode replacement after vite build
**Symptom:** `docker exec configurator cat /var/www/...` → `getwd: invalid argument`.
**Cause:** Configurator container bind-mounts the host's `digit-configurator/dist/`. When `vite build` runs, it deletes-and-recreates `dist/` (new inode). The container's mount points at the *old* inode, which no longer exists.
**Fix (operational):** `docker rm -f configurator && docker compose up -d configurator` to re-bind. Hit this twice in one session — once for configurator, once for digit-ui's static dir. See §4.6 for the long-term fix.

### 3.19 `config.env` not committed
**Symptom:** Fresh fork clone had no `config.env` and `up.sh` errored.
**Cause:** Original `config.env` was gitignored (had real registry URL + absolute sibling paths).
**Fix:** Committed a single `config.env` with `REGISTRY_URL=YOUR_REGISTRY_HOST` placeholder. Users edit it; we don't ship a `.example` indirection.

### 3.20 Localization `locale=` param missing
**Symptom:** `/localization/messages/v1/_search` returns 400; no localized strings load.
**Cause:** SPA didn't include `locale=` in the URL. Usually a `globalConfigs.js` misconfiguration on the deploying user's machine — `localeDefault` and `localeRegion` weren't set.
**Fix:** Documented; not a code change. Ensure `globalConfigs.js` sets `localeDefault="en"` and `localeRegion="IN"` (or your region). The wizard handles this if you go through it.

### 3.21 `up.sh` swallowed compose failures
**Symptom:** `up.sh` returned 0 even when compose failed; users only noticed when ansible tried to talk to a stack that wasn't up.
**Fix:** Explicit `|| { echo "..."; return 1; }` on every compose step. `up.sh` now fails loud with a recovery hint pointing at the most likely cause (stale container).

### 3.22b `down.sh` referenced collapsed compose files
**Symptom:** `./scripts/down.sh` failed because it tried to `-f docker-compose.local.yaml -f docker-compose.naipepea.yaml -f docker-compose.extra.yaml` — files removed in the §3.17 consolidation.
**Cause:** `down.sh` wasn't updated when the compose layering was collapsed.
**Fix:** `down.sh` now uses `-f stack/docker-compose.yaml` like `up.sh`.

### 3.23 `up.sh` and ansible tasks ignored `CONFIGURATOR_DIR` / `UI_ESBUILD_DIR`
**Symptom:** Re-running on a fresh CCRS clone, `up.sh seed` fails at `09-ensure-configurator.yml` with `path does not exist: .../ansible/../../../egov/digit-configurator`. With `CONFIGURATOR_DIR` set in `config.env`, the failure persists.
**Cause:** Three places had hardcoded paths that didn't honor the config override:
- `up.sh:80` — `CFG_DIR="$ROOT/../digit-configurator"`
- `ansible/tasks/08-start-digit-ui-esbuild.yml:20` — `ui_esbuild_dir: "{{ playbook_dir }}/../../../egov/digit-ui-esbuild"`
- `ansible/tasks/09-ensure-configurator.yml:9` — `configurator_dir: "{{ playbook_dir }}/../../../egov/digit-configurator"`
The hardcoded ansible paths also had a doubled `egov/` segment that resolved to the wrong directory inside `egov/` itself.
**Fix:** All three now read `CONFIGURATOR_DIR` / `UI_ESBUILD_DIR` from the env (passed by `up.sh seed`), falling back to `playbook_dir/../../../digit-configurator` when unset. The fix in §3.3 only patched ansible-side ANSIBLE_DEPRECATED reference; this is the rest of it.

### 3.24 First `up.sh` exits non-zero under Rosetta even though most services come up
**Symptom:** `up.sh all` brings up 24+ containers, kong reaches healthy, but exits 1 with `dependency failed to start: container egov-localization is unhealthy`. The seed playbook never ran.
**Cause:** `egov-localization`'s JVM cold-start under Rosetta exceeds compose's healthcheck-flap-tolerance window. Compose marks the container unhealthy mid-startup; downstream services that depend on it (kong, configurator) fail to launch in this pass.
**Fix (operational):** `egov-localization` finishes warming up within ~30s after the failure. Running:
1. `docker start digit-ui` (kong DNS race fix per §3.12)
2. `./scripts/up.sh seed` (only the ansible part; stack is already up)
3. Manually `docker compose up -d configurator` if Phase 1 didn't bring it (the dep-graph cascade may have skipped it)

…recovers to a fully-up stack. We did not loosen the healthcheck timeouts (would mask actual unhealthiness). See §4.4 for a long-term tunable.

### 3.22 kong-gateway container not created at all
**Symptom:** `docker inspect kong-gateway` fails after `up.sh`.
**Cause:** Compose silently skipped kong because of an earlier service's failure (cascading dep). Without an explicit check, `up.sh`'s `wait for healthy` loop ran for 5 min on a container that didn't exist.
**Fix:** `docker inspect kong-gateway` is checked **before** the health loop, with a hint to run `docker compose ... ps -a` to see what's there.

---

## 4. Suggestions for improvements

Things we deferred or didn't get to. None of these are blocking; they'd make the next bring-up smoother. Listed roughly in expected-impact order.

### 4.1 Drop `container_name:` declarations
**Problem (§3.13):** Container names are global; partial runs leave squatters that block re-runs.
**Suggested fix:** Remove `container_name: foo` from every service in `docker-compose.yaml`. Compose will auto-name containers `<project>-<service>-1`, scoped to the project. Tradeoff: scripts that `docker exec digit-ui` need to find the new name (`docker compose ps -q digit-ui` or `docker compose exec digit-ui ...`). Net win.

### 4.2 Push UI images to the registry
**Problem:** `digit-ui` and `digit-configurator` are partially mirrored — when the source containers update, the registry copies don't.
**Suggested fix:** Set up a CI job (GH Actions) that builds `digit-ui-esbuild` and `digit-configurator` and pushes to the registry with semver tags. Currently blocked on registry push credentials. When unblocked, the override entries can drop the bind-mount fallbacks.

### 4.3 Validate `REGISTRY_URL` not placeholder
**Problem:** First-time users miss the "edit config.env" step and see opaque pull failures.
**Suggested fix:** `up.sh` should hard-fail with a clear message if `REGISTRY_URL=YOUR_REGISTRY_HOST` (the committed default). One line:
```bash
[[ "$REGISTRY_URL" == "YOUR_REGISTRY_HOST" ]] && { echo "✗ edit config.env — set REGISTRY_URL"; exit 2; }
```

### 4.4 Healthcheck timeouts tuned for Rosetta
**Problem (§3.11):** Compose's default healthcheck timeout flaps under Rosetta-emulated JVMs.
**Suggested fix:** Bump `healthcheck.start_period` to 180s (was 90) on JVM-heavy services (`egov-localization`, `egov-user`, `egov-enc-service`, `kong`). Healthchecks themselves stay strict; we're just extending the window for the container to boot before failures count. This avoids the "re-run `up.sh`" workaround.

### 4.5 Auto-restart digit-ui on DNS race
**Problem (§3.12):** `digit-ui` nginx fails permanently on first boot if Kong DNS isn't ready.
**Suggested fix:** Add `restart: on-failure:5` to the `digit-ui` service. nginx exits 1 on bad upstream; docker restarts it; on the second try Kong DNS is up. Capped at 5 retries so a real config error still surfaces. (We rejected this earlier because we wanted the failure visible during initial bring-up; for production-like behavior, the restart is the right call.)

### 4.6 Avoid bind-mount inode replacement
**Problem (§3.18):** `vite build` replaces the dist directory (new inode), invalidating the container's bind mount.
**Suggested fix:** Either (a) use a named volume + a tiny "copy dist into volume" init container, or (b) configure vite to write into `dist/` via emptying-and-overwriting (preserves inode). Option (b) is one config flag (`emptyOutDir: true` already does that for files but not the directory itself; verify behavior). Option (a) is more robust but adds a service.

### 4.7 Light-mode service subset
**Problem:** 28 services is overkill for "I just want to file a complaint."
**Suggested fix:** Add a `LIGHT_MODE=true` config knob that strips ~8 optional services: `filestore`, `url-shortening`, `boundary-management`, `jupyter`, `gatus`, `telemetry`, `minio`, `digit-ui-docker` (when running esbuild HMR instead). Drops RAM footprint to ~3.5 GB. Implementation: compose `profiles:` per service, `up.sh` skips profiles based on `LIGHT_MODE`.

### 4.8 Pre-baked tarball for offline distribution
**Problem:** Users without registry access can't pull the pinned images.
**Suggested fix:** A `make tarball` target that runs `docker save` on all 25 reference-mirrored images and produces `personal-install-images-<date>.tar.gz`. Users `docker load` once, then `up.sh` finds them locally. Useful for air-gapped demos and slow connections.

### 4.9 Better compose-failure error messages
**Problem (§3.21, §3.22):** `up.sh` got better but still relies on humans reading hints.
**Suggested fix:** Parse common compose error patterns (`already in use`, `dependency * is unhealthy`, `no matching manifest`) and emit specific recovery commands instead of a generic "common cause" block. Each pattern → one `case` arm with the exact `docker rm -f X && ./scripts/up.sh` line to copy.

### 4.10 Auto-create `globalConfigs.js` for esbuild
**Problem (§3.20):** Localization 400 from missing locale param has bitten multiple deployers.
**Suggested fix:** `08-start-digit-ui-esbuild.yml` should template a `globalConfigs.personal-install.js` from the user's `config.env` (kong URL, tenant, locale defaults) and write it into `digit-ui-esbuild/` before spawning. Today the template exists but the user has to opt-in; make it the default.

### 4.11 TLS for VPS deploys
**Problem:** `personal-install` works on a developer's laptop but not behind a domain.
**Suggested fix:** Add `11-tls-certbot.yml` (skipped unless `TLS_DOMAIN` is set). Generates an nginx vhost that terminates TLS on `${TLS_DOMAIN}` and proxies to Kong on the configured port. Certbot renewal is a host cron, not in compose.

### 4.12 Smoke test after `up.sh`
**Problem:** "It came up, but did anything actually work?"
**Suggested fix:** A trailing ansible task that hits 3 endpoints and reports pass/fail:
- `GET /health` on Kong (gateway up)
- `POST /user/oauth/token` with bootstrap creds (auth up)
- `POST /pgr-services/v2/dashboard` (dashboard up + MVs populated)
Prints a green check or a red X with the failing curl response. Catches the 80% case where someone walked away during JVM warmup and missed a flap.

### 4.13 README + DEPLOYMENT-NOTES drift
**Problem:** README §"Image reconciliation" still describes the old 3-layer compose — the consolidation in §3.17 didn't update it.
**Suggested fix:** A pass over README to align with the single-file compose. Quick win; ~30 min of editing.

---

If you ran into something not in this list, append a §3.x entry — `personal-install` is meant to be a living record of what's broken on real machines, not a tidy fiction.
