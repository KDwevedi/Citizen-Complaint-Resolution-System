# Prerequisite knowledge — what DIGIT is and how to think about it

You'll be more productive if you read this once before touching the system. The vocabulary in the rest of these docs (MDMS, tenants, persister, workflow, boundary hierarchy, …) makes sense in the context laid out here. ~15 min read.

## What DIGIT is

DIGIT is an open-source municipal-services platform built by eGov Foundation. Cities (or counties / states / national-level institutions) deploy DIGIT to run citizen-facing services online — property tax, water connections, business licenses, public-grievance redressal (PGR), trade licenses, etc.

Architecturally, DIGIT is a microservices platform. ~25–30 services run side by side, each owning a slice of functionality. The same platform powers Bomet (Kenya), Nairobi (this work), Punjab (India), and dozens of other deployments — *the code is shared; the configuration differs per deployment*.

**The core abstraction**: every record in the system is **tenant-scoped**. A tenant is a deployment scope — `pg` (Punjab), `ke` (Kenya), `ke.nairobi` (Nairobi). When you make any API call, you say which tenant you're operating against; the same API + same database row mean different things at different scopes. This sounds like over-engineering until you watch one stack serve 30+ cities.

For this project, the only DIGIT module you need to deeply care about is **PGR** (Public Grievance Redressal): citizens file complaints, employees route + resolve, dashboards show SLA performance.

The configurator is itself a DIGIT-aware SPA — it boots with a stub auth state (no login screen) and lets you walk a 4-phase XLSX-driven onboarding wizard or browse Management CRUD pages over the same data. See `01-onboarding-flow.md` for what's behind that UI.

## The big idea — composable platform

Three things power "same code, different deployment":

1. **MDMS (Master Data Management Service)** — the config store. Schemas + records are stored here per-tenant. Want different complaint types in Nairobi than in Bomet? Seed different MDMS records under each tenant. The UI reads from MDMS at runtime to decide what's available.

2. **Localization service** — strings per (locale, module, tenant). The UI displays `t('CS_COMMON_HELPLINE')`; the localization service maps that key to a string per tenant + locale. Same UI, different language and even different content (e.g. policy phrasing) per deployment.

3. **Workflow engine** — generic state machine. PGR's complaint lifecycle (`PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED`) is just a registered "business service". A different module can register a totally different state machine without changing the engine.

These three layers mean a single codebase parameterizes itself per deployment. Most "config" you'll do is just adding/editing records via the configurator UI — which is itself a CRUD frontend on MDMS.

## Anatomy of the stack — 3 tiers

The full stack is ~28 services (you'll see them in `docker compose ps`). Conceptually they group as:

### Tier 1 — Persistence + transport
The dumb infrastructure layer.

- **postgres** — single shared DB; each service uses table prefixes (e.g. `eg_pgr_*`, `eg_user_*`, `eg_mdms_*`).
- **redpanda** — Kafka-API event broker. Services publish to topics; other services consume. Most CRUD writes go via Kafka, not direct DB writes.
- **redis** — cache (mostly used by `egov-mdms-service`).
- **minio** — S3-API object store; backs the filestore service for file uploads.

You rarely interact with these directly. When you do, it's usually `docker exec docker-postgres psql -U egov -d egov -c "SELECT ..."` to peek at state.

### Tier 2 — Core platform services
The foundation. Every DIGIT module uses these.

| Service | What it owns | When you interact |
|---|---|---|
| **kong-gateway** | The API gateway. Every UI XHR goes through `:16000`, kong routes by URL prefix to the right backend service. | Any time you curl an endpoint. |
| **mdms-v2** | Config store — schemas + records, per-tenant. | All MDMS reads/writes. The biggest service you'll talk to. |
| **egov-user** | Identity. Login, OAuth password grant, JWT bearer tokens. Owns `eg_user`. | Login flows. |
| **egov-accesscontrol** | Role → API endpoint mapping. Decides if your role is allowed to call a given URL. | Role-action setup; debugging 403s. |
| **egov-localization** | i18n strings. | Adding strings, fixing raw-key leaks. |
| **boundary-service** | Geographic hierarchy (county → sub-county → ward). Powers complaint geo-tagging and employee jurisdictions. | Seeding boundaries; debugging "no localities show in dropdown". |
| **egov-hrms** | Employees — wraps `egov-user` records with department, designation, jurisdictions. | Bulk employee import. |
| **egov-workflow-v2** | Generic state machine. PGR registers its lifecycle here. | Debugging "complaint doesn't advance state" or escalation tuning. |
| **egov-persister** | Kafka consumer that writes to postgres. (Most CRUD writes flow as: HTTP → service publishes Kafka event → persister consumes → INSERT.) | Almost never directly; explains why some operations are eventually-consistent. |
| **egov-enc-service** | Encrypts PII at rest. On Kenya deployments, `eg_user.username` and `mobilenumber` are encrypted (Kenya DPA 2019 compliance). | Searching users on encrypted DBs. |
| **egov-idgen** | Sequential ID generation (`PG-PGR-NCC-001`-style format). | Reading complaint IDs; debugging duplicate IDs. |
| **egov-filestore** | File uploads → minio, returns a `fileStoreId` for later resolution. | Uploading logos, citizen photos, attachments. |

### Tier 3 — PGR module
The actual feature you're deploying.

- **pgr-services** — the PGR backend. Owns `eg_pgr_service_v2` (complaints) + the dashboard endpoint. Registers a workflow business service with `egov-workflow-v2` for the complaint state machine.
- **digit-ui** — the citizen + employee SPA. Static `dist/` served by nginx (or by `esbuild dev` in HMR mode for personal-install).
- **configurator** — the admin SPA. Onboarding wizard, MDMS CRUD, theme editor, dashboard.

For our deployment, you'll spend almost all of your time in **mdms-v2 records** (via the configurator) and **localization** + **digit-ui** rendering. The other services are infrastructure that's already correct on a healthy stack.

## Key concepts you'll hit on day one

### Tenants
Dotted hierarchical strings. `pg` is a root tenant; `pg.citya` is a city under it. Three places `tenantId` shows up — keep them mentally separate:

1. **Where a record is stored** (`Mdms.tenantId` on a `_create`).
2. **What tenant the record describes** (often `data.tenantId` inside the record's payload).
3. **What tenant the operator is authenticated for** (`RequestInfo.userInfo.tenantId`).

Many bugs are mismatches between these three. The full mental model + four classic failure modes are in `03-login-and-tenants.md`.

### MDMS — what's actually stored
MDMS holds JSON records, keyed by `(tenantId, schemaCode, uniqueIdentifier)`. Examples:

- `tenant.tenants` schema → records describing tenants. Lives at the bootstrap tenant; each record's `data.tenantId` describes the actual tenant.
- `RAINMAKER-PGR.ServiceDefs` → 37 records for Nairobi pilot, each a complaint type.
- `ACCESSCONTROL-ROLES.roles` → role definitions per tenant.
- `common-masters.Department` / `common-masters.Designation` → org chart metadata.
- `tenant.theme-config` → per-tenant colour palette.

Schema registration is itself per-tenant. A schema registered at `pg` can be queried from `pg`; trying to `_create` against it from `ke` returns `SCHEMA_DEFINITION_NOT_FOUND_ERR`. The configurator wizard hides this; when you're scripting, you'll feel it.

### Localization vs MDMS — they look similar but aren't

| | MDMS | Localization |
|---|---|---|
| What | structured records (department, complaint type, role…) | i18n strings (`{code, message}`) |
| Keyed by | `(tenantId, schemaCode, uniqueIdentifier)` | `(tenantId, locale, module, code)` |
| Service | `mdms-v2` | `egov-localization` |
| Endpoints | `_create / _search / _update` | `_search / _upsert` |
| When you edit | "I want to change a complaint type's SLA" | "I want to change `Helpline` to `Helpdesk`" |

Both are "config", but they answer different questions. Confusing them is common — when adding a new complaint type, you need an MDMS record AND a localization key for the citizen-facing label.

### globalConfigs.js — the third config layer
Build-time SPA config. Lives at `digit-ui-esbuild/public/globalConfigs.js`. Keys are UPPER_SNAKE — `STATE_LEVEL_TENANT_ID`, `MAP_CENTER`, `LOCALE_REGION`, `DIGIT_FOOTER`, etc. Read via `globalConfigs.getConfig('KEY')`.

This is where you set per-deployment defaults that the SPA needs *before* it can talk to backend (so it can't come from MDMS). Examples: which tenant is "default", what's the GMaps API key, what locale region to use.

So three layers of config in total:
- `globalConfigs.js` — SPA boot-time defaults (UPPER_SNAKE)
- MDMS — most everything else (per-tenant runtime config)
- Localization — strings (per-tenant per-locale)

### Workflow — generic state machine

`egov-workflow-v2` is a generic engine. Modules register **business services** with it; each business service is a state machine declaration:

```
PGR business service:
    states: [PENDINGFORASSIGNMENT, PENDINGATLME, RESOLVED, REJECTED, CLOSEDAFTERRESOLUTION, CLOSEDAFTERREJECTION, ...]
    transitions:
      PENDINGFORASSIGNMENT --[GRO ASSIGN]--> PENDINGATLME
      PENDINGATLME --[LME RESOLVE]--> RESOLVED
      RESOLVED --[CITIZEN RATE]--> CLOSEDAFTERRESOLUTION
      RESOLVED --[CITIZEN REOPEN]--> PENDINGFORASSIGNMENT (loop)
```

Each transition has:
- An **action** (e.g. `ASSIGN`)
- A list of **roles** that can perform it
- An **SLA timer**
- Optional **escalation rules**

The state machine itself lives in MDMS (schema `Workflow.BusinessService`). The PGR backend just publishes "advance state to X" events; workflow service decides if it's allowed and updates state.

UI consequence: complaint inbox shows green/amber/red traffic lights based on SLA — `≤33%` green, `33–66%` amber, `>66%` red.

### Boundaries — geo hierarchy

PGR complaints are geo-tagged. Three concepts:

1. **Boundary entities**: each is a labelled point/polygon at a level (`County`, `SubCounty`, `Ward`).
2. **Hierarchy definition**: declares the level chain (`ADMIN: County → SubCounty → Ward`). One per tenant.
3. **Boundary relationships**: parent/child wiring (this ward's parent is that sub-county).

All three exist for `ke.nairobi` after `ansible/03-seed-boundaries.yml` runs. The citizen sees them as a cascading dropdown when filing a complaint; employees have *jurisdictions* assigned over them (which boundaries they cover).

### HRMS — employees

A user (`egov-user` record) has credentials + roles. An employee (`egov-hrms` record) wraps that with org-chart context — department, designation, jurisdictions, plus a history of assignments. When you "create an employee" you're really doing two operations: create the user, then wrap it as an HRMS employee.

Important quirk on Kenya deployments: `eg_user.username` and `mobilenumber` are **encrypted at rest** (Kenya Data Protection Act). Searching users by mobile goes through `egov-enc-service`. Use `/egov-hrms/employees/_search` (not `/user/_search`) — the HRMS endpoint knows how to round-trip through the encryption layer.

## How a complaint flows through the system

To anchor the abstractions, here's a concrete walk:

1. **Citizen opens digit-ui at `/citizen/sandbox-pgr/create`**. Selects "Land ownership dispute" → `ke.nairobi/MAKADARA/HARAMBEE` → describes the issue.
2. **SPA POSTs `/pgr-services/v2/request/_create`** through Kong with `RequestInfo.userInfo.tenantId=ke.nairobi`.
3. **pgr-services** validates, generates an ID via `egov-idgen` (`PG-PGR-NCC-001`-format), publishes a Kafka event.
4. **egov-persister** consumes the event, INSERTs into `eg_pgr_service_v2` with `applicationstatus=PENDINGFORASSIGNMENT`.
5. **egov-workflow-v2** also consumes; records the initial state with SLA timer set.
6. **GRO logs in at `/employee/sandbox-pgr/inbox`**, sees the complaint. SPA fetches via `/pgr-services/v2/request/_search` filtered by their jurisdiction.
7. **GRO assigns to LME**. SPA POSTs `/pgr-services/v2/request/_update` with workflow action `ASSIGN`. Workflow service advances state to `PENDINGATLME`.
8. **LME resolves**. State → `RESOLVED`.
9. **Citizen rates**. State → `CLOSEDAFTERRESOLUTION`.
10. **Dashboard** at `/configurator/manage/pgr-dashboard` reads from 4 materialized views (`pgr_mv_kpi`, `pgr_mv_monthly`, `pgr_mv_monthly_source`, `pgr_mv_dimension`), refreshed every minute by `pgr-services`' `DashboardRefreshScheduler`.

Each step touches multiple services. When something breaks, knowing which service owns the operation is half the battle.

## Where things actually live (the operator's mental map)

| Question | Look at |
|---|---|
| "Did the seed actually load?" | postgres: `SELECT tenantid, count(*) FROM eg_mdms_data GROUP BY tenantid` — expect ~1,400 at `pg`, ~1,000 at `ke`/`ke.nairobi` after the fixture |
| "How do I bust the localization cache?" | `POST /localization/messages/cache-bust` (returns `{successful:true}`); the redis flush + service restart is fallback only |
| "What complaint types exist?" | MDMS `RAINMAKER-PGR.ServiceDefs` at the city tenant |
| "What roles can a user have?" | MDMS `ACCESSCONTROL-ROLES.roles` at the city tenant |
| "What can role X do?" | MDMS `ACCESSCONTROL-ROLEACTIONS.roleactions` |
| "What's the SLA?" | MDMS `Workflow.BusinessService` for PGR + the `slaHours` on each ServiceDef |
| "What localities exist?" | `boundary-service /boundary/_search?tenantId=ke.nairobi` |
| "Who works in dept X?" | `egov-hrms /employees/_search?departmentCodes=X` |
| "Why is `Helpline` raw-key?" | localization `_search?locale=...&module=...` |
| "What does the citizen see for type Y?" | localization key `SERVICEDEFS.YYY_UPPER` in `rainmaker-pgr` module |
| "What palette is applied?" | MDMS `tenant.theme-config` |
| "What's the city logo?" | `tenant.tenants.data.logoId` → filestore lookup |
| "What CSS is overriding the theme?" | grep hex literals in `digit-ui-esbuild/packages/css/src/` |

You'll come back to this table.

## Three things to internalize before reading on

1. **Almost every operation is `(tenantId, schemaCode, uniqueIdentifier)`-keyed.** When debugging "why doesn't this show up", the first question is "did I `_search` at the right tenant?"
2. **Same code runs everywhere; data drives everything.** The configurator wizard isn't running specialized "Nairobi" code — it's POSTing data into MDMS that PGR + UI then consume.
3. **The MDMS dependency chain is a real thing.** Roles must exist before users. Departments must exist before designations. Boundaries + hierarchy must exist before relationships. Service defs must exist before complaints. The wizard enforces this; when you script, you'll have to.

## Where to read next

- `01-onboarding-flow.md` — the wizard, phase by phase, what gets created and how to verify
- `02-apis.md` — every operation as direct curl, for scripting / debugging
- `03-login-and-tenants.md` — the tenant model in depth, four classic failure modes
- `04-localization.md` — strings, the dedup-by-code bug, how to fix raw-key leaks
- `05-branding-and-logos.md` — theme + logo, where each lives, debug recipes
- `06-ui-repos.md` — source-code maps for `ChakshuGautam/digit-configurator` and `theflywheel/digit-ui-esbuild`

If you're already in your stack and ready to verify state, jump to `01-onboarding-flow.md` §"How to debug" — that's where most "I'm stuck" moments resolve.
