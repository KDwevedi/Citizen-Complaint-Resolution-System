# CCRS Rapid Release Approach (SaaS)

Goal: ship issue-closing changes from a developer's branch onto a production tenant within hours, not weeks, without sacrificing the ability to roll back or pause a release.

## Operating principles

1. **Trunk-based on `develop`** — one canonical branch, no long-running release branches. Feature work lives in short-lived themed branches off `develop` and merges back within days, not weeks.
2. **Environment promotion is mechanical** — the same artifact (SHA, image tag, MDMS seed) flows bomet dev → Nai Pepea staging → tenant prod. Nothing is hand-rebuilt per environment.
3. **Releases are small and frequent** — a release per business day is the target. Smaller PRs land faster, fail safer, and recover quicker if something goes wrong.
4. **Anything that fires only in prod is a bug.** Validation gates that need data only-on-prod (real OTP, real users, real boundary trees) get backfilled into staging until staging-side validation is sufficient.

---

## Branch + merge model

- **`develop`** is the source of truth. CI runs on every push; tilt-test must be green before merge.
- **Feature branches** are short-lived and themed, not single-concern when concerns naturally group. Example shapes (drawn from a recent day's iteration):
  - `theme/A-citizen-profile-lifecycle` — three fixes that touch the same user surface
  - `theme/B-mobile-rule-unification` — code + MDMS seed + frontend config tied to one rule
  - `theme/C-complaint-form` — postal validator + boundary leaf-only + dropdown dedup
  Each themed branch becomes one upstream PR when it's fully validated.
- **`master`** (or whatever release branch is in use) is updated only via merges from `develop` at release tags. No commits land there directly.
- **Hotfix branches** are forked from the release tag (or master), not from develop. Fix lands on the hotfix branch, gets cherry-picked back into develop, and is released as a patch tag. See "Hotfix path" below.

**Estimated overhead**: trunk discipline costs nothing once practiced. The branch-and-PR cycle adds ~5 min per merge for review/CI wait — recouped many times by avoiding merge conflicts that long-running branches generate.

---

## Environment promotion

```
bomet dev  ─►  Nai Pepea staging  ─►  tenant prod
```

| Env | Role | Auto-deploy from | SLA | Approval to next stage |
|---|---|---|---|---|
| **bomet dev** | Default landing zone for `develop`. First place a fix lands after merge. | `develop` nightly cron (configurable shorter) | Best-effort; expected to be in flux | None — auto-promotes via the cron |
| **Nai Pepea staging** | Mirrors prod tenant config; QA exercises here. Last stop before any tenant prod. | `develop` after passing on bomet for ≥24h, or explicit promotion | 99% during business hours | One QA sign-off OR tag promotion |
| **tenant prod** | Each tenant's live env (Nairobi, future Maputo, etc.) | Tagged release artifacts, manual promotion | Per-tenant SLO (typically 99.5%) | Tenant sign-off + rollback rehearsal documented |

**Promotion mechanism**:
- bomet dev: nightly cron runs `./deploy.sh bomet` after `git fetch + reset --hard origin/develop`. Idempotent. ~3 min when there are no surprises.
- Nai Pepea staging: same mechanism, gated on bomet running clean for the previous deploy. Optionally triggered by a manual workflow_dispatch.
- tenant prod: a tagged release artifact (SemVer) is deployed via the tenant's own pipeline, which pulls the tag, validates the image digests, and runs the playbook (mode A) or helm upgrade (mode C). See [Deployment Modes](./deployment-modes.md).

**Estimated effort to wire a new tenant into this pipeline**: **2–3 days** — DNS, host_vars or helm values, secrets, initial seed, smoke-test runbook. Mostly content, not code.

---

## Release cadence

Target: **one release per business day** to tenant prod, off SemVer tags cut from `develop`.

- **Patch releases (z bump)**: bug fixes, MDMS seed updates, deploy-side config. Should account for the majority of releases.
- **Minor releases (y bump)**: new features that are backwards-compatible (new MDMS schemas, new optional endpoints, new UI screens).
- **Major releases (x bump)**: breaking changes — DB schema migrations that aren't online-safe, removed APIs, mandatory MDMS shape changes. Coordinated, scheduled, advance-notified to tenants.

**Release train cadence**:
- Cut a tag (e.g. `v1.4.7`) when `develop` has accumulated landable work + has been clean on bomet for ≥24h.
- The tag is the artifact reference. CI builds and pushes images for that SHA, MDMS seed snapshots are taken.
- Within 24h of tag cut, the tag flows to Nai Pepea staging (auto), and within 48–72h to the first tenant prod (manual).

**Holdback / opt-out**: any tenant can pin to an earlier tag for any reason (e.g. an in-flight integration freeze). The fork-first / themed PR shape makes it easy to cherry-pick a critical patch into an older tag if needed.

---

## CI / GHA pipelines

Self-hosted runners under the project's GitHub Actions setup. Reasons:
- Build context (vendored configurator + digit-ui-esbuild, Maven multi-module backends) is large — self-hosted runners with persistent volumes cut full-build cycle from 25+ min to 4–6 min.
- Container builds need access to the project's registry (preview / staging) — credentials stay on self-hosted infra.
- Some integration tests need Kafka / Postgres fixtures that are easier to keep warm on self-hosted than spin up on every job.

**Required workflows**:
- `tilt-test` — full single-node bring-up + telemetry verification. Must pass for merge.
- `Local Setup CI / test` — playbook lint + a smoke deploy on a disposable VM.
- (Future) `helm-test` — chart lint + a `kind` smoke deploy for mode B/C work.
- (Future) `e2e` — Playwright runs against bomet after each nightly cron deploy.

**Estimated setup time** if starting from current state:
- Wire `helm-test` into the existing matrix: **1–2 days**
- Add Playwright e2e against bomet nightly: **3–5 days** (write scenarios + stabilise selectors + fold into the cron)

---

## Auto-rollback + quality gates

**Quality gates (in order, all must pass)**:

1. **PR gates** — tilt-test green, CI test green, code review approval, board-status reflects "In progress" (no shipping straight to "Done").
2. **bomet gate** — fix lands cleanly on the nightly cron. If the next morning's bomet deploy goes red, the fix is rolled out via `git revert` and a fresh nightly redeploys clean. No human paged for this — it's the default.
3. **Staging gate** — Nai Pepea must hold green for ≥24h before promotion to any tenant prod. Any crash-log uptick or scheduler error spike in this window pauses the promotion.
4. **Prod canary** — first tenant on a release tag is treated as canary for that tag. If error rates / SLA breach rates / latency P95 regress against the previous tag's first day, hold remaining tenants and decide.

**Auto-rollback mechanism**:
- Mode A: the bomet redeploy cron keeps the previous good image tag list. A failed redeploy doesn't replace it; the previous tag stays serving. Manual intervention only when an actual content migration ran (rare, scheduled).
- Mode C: Helm `rollback` to the previous release. Deployment health checks failing → Argo/Flux or our pipeline calls `helm rollback`. The previous tag's images and seeds are preserved.

**Estimated wire-up cost**:
- Mode A auto-rollback hooks already mostly exist via the cron's "previous image" snapshot — formalising the rollback step: **1 day**
- Mode C health-check-based rollback in a Helm-driven pipeline: **3–5 days** including the integration with our existing observability stack

---

## Hotfix path

When something on tenant prod needs a fix faster than the release train cadence allows:

1. **Cut a hotfix branch** from the production tag, not from develop. (Develop may have moved on; pulling unrelated work into a hotfix risks the fix.)
2. **Apply the minimum change**, no scope creep.
3. **CI** still runs — tilt-test must pass.
4. **Cherry-pick the same commit into `develop`** so the fix is not lost on the next release.
5. **Tag a patch release** (`v1.4.7` → `v1.4.7-hotfix1` or `v1.4.8` depending on convention).
6. **Deploy directly to affected tenant(s)**, skipping staging if the situation justifies — but document the skip in the incident write-up.
7. **Backfill the staging deploy** within 24h so it tracks prod.

**Estimated time from "page raised" to "hotfix on tenant prod"**:
- Best case (frontend-only change, no DB migration): **1–2 hours** from triage to deploy
- Backend service patch (rebuild + image push + helm upgrade or compose recreate): **2–4 hours**
- Anything touching encryption-key adjacent containers or DB schema: **half day minimum**, with rollback rehearsal

---

## Operating model — who does what

| Role | Owns |
|---|---|
| **Developer** | Themed branch, PR description, validation on bomet/repro env, code review of peers' branches |
| **QA** | Promotion sign-offs from staging → tenant prod, flips board to Done after live verification |
| **Release manager** | Cuts tags, makes go/no-go calls on promotion windows, runs incident post-mortems |
| **On-call** | Watches the cron + staging gates overnight, triages rollback decisions |

The roles can be held by overlapping people on a small team; the responsibilities don't.

---

## Pragmatics — what this isn't

- **Not "ship to prod every commit"**. The bomet→staging→prod gates have human + observability checks. The release train is daily, not minutely.
- **Not "no humans in the loop"**. Auto-rollback handles the obvious cases; the non-obvious ones still page.
- **Not "trunk on a long branch"**. Themed branches that live more than ~5 days create the merge-conflict tax this is supposed to avoid.

Related: [Deployment Modes](./deployment-modes.md), `local-setup/ansible/playbook-deploy.yml`, `devops/deploy-as-code/`, `feedback_p0p1_loop_discipline.md`.
