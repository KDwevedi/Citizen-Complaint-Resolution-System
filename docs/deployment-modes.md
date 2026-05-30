# CCRS Deployment Modes — Ansible vs Kubernetes

CCRS is one product but multiple deployment substrates. Pick the lightest one that fits the lifecycle stage; promote up only when the previous mode hits a real ceiling.

| Mode | Substrate | Lifecycle | Setup time | Hosts | Recovery |
|---|---|---|---|---|---|
| **A. Ansible + Compose** | Single VM running docker-compose | Dev, demo, single-tenant pilots | 30–45 min from blank Ubuntu | 1 | `./deploy.sh <tenant>` replays |
| **B. Local Kubernetes** | minikube / kind on a developer laptop | Manifest/chart development | 60–90 min (chart-author cycle) | 1 (laptop) | Tear down + `kubectl apply` |
| **C. Helm + Rancher/RKE2** | Multi-node managed cluster | Production / shared staging / multi-tenant | 1–2 weeks first time, hours subsequent | 3+ | Helm rollback + node drains |

---

## A. Ansible + Compose (single node)

**When to use**: developer playground, demo box, single-tenant pilot, or any "one VM is plenty" target. This is the deployment that's been driving the day-to-day loop.

**How it works**:
- `local-setup/ansible/playbook-deploy.yml` runs against a tenant entry in `inventory/host_vars/<tenant>.yml`.
- The playbook lays down `/opt/digit/` (compose file, env, nginx), builds the digit-ui-esbuild + configurator dists from vendored source, pushes MDMS seeds, brings up ~30 containers via docker-compose.
- nginx on the host fronts everything: `/digit-ui/`, `/configurator/`, the `/egov-*` service paths, MinIO presigned-URL alias, etc.

**Setup**:
1. Fresh Ubuntu (22.04+ ideally), 11 GB RAM minimum, 30 GB disk.
2. `git clone <ccrs repo>` into `/opt/ccrs`.
3. Create `inventory/host_vars/<tenant>.yml` with at minimum: `ansible_host`, `domain`, `state_root`, `state_tenant_id`, `boundary_type`. Optionally enable features via `nginx_features.*`, theme via `theme_primary_color`, etc.
4. `cd local-setup/ansible && ./deploy.sh <tenant>` — PLAY RECAP should land `failed=0` in ~5 min for a re-converge, ~10 min for a first install.

**Trade-offs**:
- ✅ Lowest operational complexity. One box, one compose file, one nginx.
- ✅ Single-developer loop: edit code, deploy, verify in minutes.
- ✅ Replayable — same tenant config + same SHA = same deploy.
- ⛔ No HA. The VM is the unit of failure.
- ⛔ Scaling = vertically beefier VM. There's no horizontal path inside this mode.
- ⛔ Stateful upgrades (DB schema changes, encryption key rotations) need careful handling — recreate-vs-restart matters for state-bearing containers (egov-user encryption key trap is documented).

**Estimated effort**:
- First-time setup (fresh tenant): **30–45 min** (mostly compose pull + initial seed)
- Re-deploy after a develop pull: **3–5 min**
- Adding a new tenant entry: **15 min** (host_vars + boundaries seed + first deploy)

**Limits before promotion to mode B/C**:
- Sustained concurrency > a few hundred users (single Postgres, single Kafka)
- Need for zero-downtime upgrades (compose recreate has visible blips)
- Multi-tenant data isolation requirements that go beyond the existing `tenantId` discipline

---

## B. Local Kubernetes (developer / chart-author cycle)

**When to use**: developing or modifying the Helm charts under `devops/deploy-as-code/charts/`, validating that the manifest layout works end-to-end before pushing to a shared cluster. **Not** intended for "production-on-a-laptop".

**How it works**:
- `minikube start` or `kind create cluster` to bring up a local single-node Kubernetes.
- `helm install <release> ./devops/deploy-as-code/charts/urban/<chart>` per service or via an umbrella chart.
- A local registry (or `eval $(minikube docker-env)`) holds the service images.

**Setup**:
1. Local docker engine + minikube/kind + kubectl + helm 3.
2. Allocate enough resources: 8 CPU, 16 GB RAM in the local VM is workable.
3. Build/tag images locally (or pull from the project registry).
4. `helm install` the charts, watch pods come healthy.

**Trade-offs**:
- ✅ Catches manifest issues (selector mismatches, init-container ordering, resource-request math) before they hit a shared cluster.
- ✅ Lets you iterate `kubectl apply -k` cycles in seconds.
- ⛔ Sluggish for the full stack — local Kubernetes nodes aren't built for 30 services.
- ⛔ Not behaviorally identical to managed K8s — storage classes, ingress, RBAC differences will leak.
- ⛔ Steeper learning curve than mode A; rarely worth it unless you're authoring the charts.

**Estimated effort**:
- First-time setup on a chart-author laptop: **60–90 min**
- Iteration cycle while editing a chart: **2–3 min** per `helm upgrade`
- Migrating from this mode to mode C: nominal — chart authors validate locally then PR

---

## C. Helm + Rancher / RKE2 (production HA)

**When to use**: staging that must look like prod, real multi-tenant production, anywhere uptime is contractual.

**How it works**:
- RKE2 (or another supported Kubernetes distribution) provides the cluster.
- Rancher (or pure-CLI flows) manages the cluster.
- Helm charts in `devops/deploy-as-code/charts/` deploy services. Umbrella values per environment.
- Stateful components (Postgres, Kafka, MinIO, Redis) deploy from upstream Helm charts or operator-managed instances. Backups via Velero or DB-native streaming.
- Ingress (nginx-ingress / Traefik / cloud LB) handles TLS termination, host routing.

**Setup**:
1. Provision 3+ node cluster (3 control-plane + N worker, or co-located). Allocate per-node specs based on tenant count.
2. Install Rancher or wire up direct kubectl access.
3. Set up persistent volume provisioning (cloud-native or local-path with care).
4. Pull the CCRS Helm charts, supply per-env `values.yaml` (image tags, replica counts, resource requests, ingress hosts, secrets via External Secrets / Vault).
5. `helm install` in dependency order: stateful infra → core services → modules.
6. Validate health, observability (Prometheus, Loki, Tempo), and DR (backup + restore round-trip).

**Trade-offs**:
- ✅ Horizontal scaling at every layer that supports it (PGR API replicas, Kafka partitions, etc.).
- ✅ Zero-downtime rolling upgrades with proper PDBs and rolling strategies.
- ✅ Real isolation between tenants via namespaces + RBAC + network policies.
- ⛔ Operationally heavy. Needs at least one ops-aware engineer per cluster.
- ⛔ Stateful migrations are harder than in mode A (you can't just `sed` an .env).
- ⛔ Cost. Even a small cluster is expensive vs a single VM.

**Estimated effort**:
- First production cluster bring-up: **1–2 weeks** (cluster + dependencies + initial CCRS install + first tenant validation)
- Adding a new tenant on an existing cluster: **half a day** (namespace + values + secrets + DNS)
- Routine release deploy: **15–30 min** (helm upgrade + canary verification)

---

## Single-node → HA promotion path

When mode A starts to hurt:

1. **Phase 1 — instrument** (week 0): turn on the observability we already ship (Tempo / Loki / Prometheus integrations in the playbook). Watch for the actual ceiling — is it CPU, RAM, IO, or a specific bottleneck like Postgres connections?
2. **Phase 2 — extract state** (week 1–2): move Postgres (and Kafka if memory pressure is real) to managed instances. The compose stack can still front them. This buys time.
3. **Phase 3 — chart parity** (week 3–4): get a mode B / mode C cluster running CCRS against the same managed state. Validate that the service mesh + ingress paths behave identically.
4. **Phase 4 — cut over** (week 5+): point DNS at the cluster ingress, decommission the single VM. Keep the VM around as a quick-rollback for the first sprint.

The fork-first workflow (themed branches in `KDwevedi/CCRS` validated on ovh-cloud-dev before upstream PR) maps onto all three modes. ovh-cloud-dev runs mode A; staging runs mode A or C depending on tenant; production runs C.

---

## Decision guide

| You have… | Use mode |
|---|---|
| One demo box and a deadline next week | A |
| One developer experimenting with chart layout | B |
| Multi-tenant SaaS with uptime SLOs | C |
| A pilot tenant that might become production | Start A, plan promotion to C in the SLA's first quarter |
| Already on Rancher for other workloads | Land directly in C |

Don't pick a mode because it's fashionable. Pick the lightest one that doesn't lie to you.

Related: [Rapid Release Approach](./rapid-release.md), `local-setup/ansible/`, `devops/deploy-as-code/charts/`.
