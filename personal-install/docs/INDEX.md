# personal-install setup & e2e debug guide

Self-service docs for taking a freshly-brought-up `personal-install` stack from "containers green" to "citizen filing complaints, employees resolving them." Read these in order, attempt the steps, and only escalate when the **escalate** signal in the relevant doc tells you to.

The `up.sh` brings the stack up; everything *after* that is what these docs cover.

## Pick your path

| If you want to … | Read |
|---|---|
| Build a mental model of DIGIT before touching anything (start here if new) | [00-prerequisites.md](00-prerequisites.md) |
| Walk the configurator's onboarding wizard end-to-end and not get stuck | [01-onboarding-flow.md](01-onboarding-flow.md) |
| Skip the UI — script onboarding via direct API calls (curl) | [02-apis.md](02-apis.md) |
| Understand login, tenant scopes, why `INVALID_ROLE` happens | [03-login-and-tenants.md](03-login-and-tenants.md) |
| Add new strings, fix raw-key leaks, translate en → sw | [04-localization.md](04-localization.md) |
| Change colours, swap the logo, get a tenant's brand right | [05-branding-and-logos.md](05-branding-and-logos.md) |
| Find the source code for a feature you see on screen | [06-ui-repos.md](06-ui-repos.md) |

## Most common e2e failure points (and where each is documented)

| Symptom | Where to look |
|---|---|
| `docker compose ps` shows ≠28 services | `../DEPLOYMENT-NOTES.md` §3 — known bring-up failures |
| Can't log in as `pg/ADMIN/eGov@123` at the configurator | `03-login-and-tenants.md` §"Login fails" |
| Wizard creates tenant but Phase 2 (roles) errors `INVALID_ROLE` | `03-login-and-tenants.md` §"INVALID_ROLE" + `01-onboarding-flow.md` §"Phase 2" |
| `SCHEMA_DEFINITION_NOT_FOUND_ERR` on tenant create | `03-login-and-tenants.md` §"Schema scope" |
| Boundaries upload but city tenant search returns empty | `02-apis.md` §"Boundaries" — hierarchy + relationships, both required |
| PGR dashboard shows `BadSqlGrammarException ... pgr_mv_kpi` | `../DEPLOYMENT-NOTES.md` §3.10 — materialized views |
| Configurator login works but pages 404 / blank | `06-ui-repos.md` §"Configurator routing" |
| Citizen UI shows raw keys (`CS_COMMON_HELPLINE`, `LOGIN_WITH_EMAIL`) | `04-localization.md` §"Raw-key leaks" |
| Theme/logo doesn't apply after wizard Phase 5 | `05-branding-and-logos.md` §"Cache + bundle" |
| Mobile validation rejects valid Kenya numbers | `02-apis.md` §"Employees" — `ValidationConfigs.mobileNumberValidation` MDMS schema |

## When to escalate

You've **tried the diagnostic steps in the relevant doc** and one of these is true:

1. The diagnostic curl returns a 5xx or hangs.
2. A docker container is in `Restarting` state and `docker logs <c>` shows a stack trace you can't pattern-match against `../DEPLOYMENT-NOTES.md`.
3. The wizard's network tab shows a 200 but the UI doesn't reflect the change after a hard refresh.
4. A symptom isn't covered anywhere in this directory.

For 1–3, attach the curl output / docker log / network HAR. For 4, write what you tried and what you expected.

## Conventions

- All `localhost:16xxx` URLs assume `PORT_PREFIX=16` in `config.env`. If you set something else, mentally substitute.
- Tenant scope shorthand: `pg` is the bootstrap tenant from CCRS local-setup (where the ADMIN/eGov@123 lives); `ke` is the root tenant for Nairobi-flavoured installs; `ke.nairobi` is the city.
- Curl examples assume you've stashed an auth token (see `03-login-and-tenants.md`).
