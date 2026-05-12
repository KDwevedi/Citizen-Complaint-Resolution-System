# Onboarding a tenant under a brand-new state

## What used to happen

When you onboarded a tenant whose parent state had no MDMS schemas registered (e.g. `mz.maputo` on a stack that's only seeded with the baseline `pg`/`statea` tenants), every Phase 3-4 write failed:

| Write | Error |
|---|---|
| `mdms-v2/_create/common-masters.Department` | `SCHEMA_DEFINITION_NOT_FOUND_ERR` |
| `mdms-v2/_create/common-masters.Designation` | `SCHEMA_DEFINITION_NOT_FOUND_ERR` |
| `mdms-v2/_create/RAINMAKER-PGR.ServiceDefs` | `SCHEMA_DEFINITION_NOT_FOUND_ERR` |
| `user/users/_createnovalidate` | `INVALID_ROLE: Unable to validate role from MDMS` |
| `egov-hrms/employees/_create` | `ERR_HRMS_USER_CREATION_FAILED` (chains user create) |

Phase 1's tenant create succeeded (it writes at the session tenant, where the schema exists) so the user-visible "Tenant Master Uploaded!" banner masked the fact that nothing else would land.

## What's fixed

[ChakshuGautam/digit-configurator#62](https://github.com/ChakshuGautam/digit-configurator/pull/62) (merged as `89d15fab` on `main`). Phase 1 now auto-detects whether the parent state has schemas and, if not, runs a bootstrap step in-flight: clones every schema definition from a source state (default `pg`), copies 14 essential master-data records (roles, IdFormat, DataSecurity.*, Department, Designation, ServiceDefs, Workflow, Inbox, HRMS employee meta), provisions an ADMIN user at the new state, and copies the PGR workflow state machine. The wizard then proceeds through Phases 1-4 unchanged.

For tenants under an *existing* state (e.g. `ke.testzone` on a stack with `ke` already seeded), the bootstrap is skipped — the existence check (`stateNeedsBootstrap`) returns `false` and the wizard goes straight to the tenant create.

## Quick steps to retest from a clean slate

**1) Stop and wipe containers and volumes.**

**2) Pull these three repos to latest:**

- `KDwevedi/Citizen-Complaint-Resolution-System` on branch `feat/personal-install`, latest `9ae917be`
- `ChakshuGautam/digit-configurator` on branch `main`, latest `89d15fab`
- `theflywheel/digit-ui-esbuild` on branch `main`, latest `6be25229`

**3) Bring up the stack in plain mode:**

```bash
cd <your-CCRS-checkout>/personal-install
SEED_DEMO_DATA=false ./scripts/up.sh
```

`SEED_DEMO_DATA` is read by ansible at playbook time (`inventory.yml:18`), not from inside any container — setting it inline is sufficient. The PLAY RECAP at the end should show `skipped=8 failed=0`; the ke/ke.nairobi tenant + boundary + naipepea-fixture tasks are gated on this flag.

Plain-mode baseline is what the wizard's bootstrap copies from: 31 schemas at `pg`, 22 role records, 13 Department + 29 Designation + 33 ServiceDef records, PGR workflow at the state level, `ADMIN@pg`/`eGov@123` for sign-in.

**4) Onboard your tenant:**

- Open http://localhost:16172/configurator/
- Sign in as `ADMIN` / `eGov@123` / tenant `pg`
- Use the **Download Template** button on each Phase to grab the XLSX, fill in your tenant code (`mz.maputo` or whatever), and walk through Phases 1 to 4.
- In Phase 1 you will see a progress banner: *"Bootstrapping new state root — schemas (N/30)..."* for 10 to 30 seconds. That is the new behaviour. After it finishes, the wizard proceeds normally and Phase 3 writes succeed.

## Sanity check after Phase 1

The wizard's chrome shows "Tenant Master Uploaded! Created: …" when Phase 1 completes, but if you want to confirm the `tenant.tenants` record actually landed at the DB level:

```bash
docker exec docker-postgres psql -U egov -d egov -tA -c \
  "SELECT count(*) FROM eg_mdms_data WHERE schemacode='tenant.tenants' AND uniqueidentifier='<your.new.tenant>';"
```

Returns `1` on a successful Phase 1. Phases 2 through 4 write at `targetTenant` directly and don't depend on the `tenant.tenants` row existing, so they proceed regardless.

## Where the code lives

- **Wizard bootstrap service**: `src/api/services/tenantBootstrap.ts` in `ChakshuGautam/digit-configurator` (on `main` since the PR #62 merge `89d15fab`). Mirrors `DIGIT-MCP/src/tools/mdms-tenant.ts:837`.
- **Phase 1 integration**: `src/pages/Phase1Page.tsx` — derives `parentState = newTenant.split('.')[0]`, gates the bootstrap call on `stateNeedsBootstrap(parentState)`.
- **Personal-install pull path**: `config.env`'s `CONFIGURATOR_DIR` points at a sibling `digit-configurator` clone; `up.sh seed --tags configurator` (or `09-ensure-configurator.yml`) builds the dist and bind-mounts it into the configurator container.
- **MCP equivalent**: `digit mdms tenant-bootstrap --target-tenant <state> --source-tenant pg` does the same five-step orchestration from the CLI / MCP HTTP transport.
