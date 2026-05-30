# CCRS SaaS Dashboard — Scoping

A first pass at scoping the configurable dashboard work in CCRS#631. **This is a scoping doc, not a build plan.** It frames the persona / KPI / customisation surface so we can split the work into shippable slices instead of an unbounded "dashboards" feature.

## Audience personas

The dashboard has to serve at least five personas that look at meaningfully different things. Treat each as a separate viewport for V1; converge primitives later.

| Persona | What they care about | Refresh tolerance |
|---|---|---|
| **Citizen** | Status of *their* complaints; total raised vs resolved; nearest open complaint by ward | Real-time at view-time; no scheduled push |
| **GRO** (assignment officer) | Inbox depth (PENDINGFORASSIGNMENT count by ward), SLA breaches today, escalations triggered | 5–10 minute lag acceptable |
| **LME** (line-manager / executor) | Personally-assigned complaints by SLA bucket; closed-this-week count; average resolution time | 5 minute |
| **Supervisor** | LME productivity (closed-per-LME, average resolution time, SLA breach rate), ward-level open-complaint heatmap | 10–15 minute |
| **Admin** | Tenant-wide KPIs, complaint volume trends, escalation funnel, configurator drift detection (employees added/removed, MDMS seeds changed) | Daily summary OK; near-real-time for outage signals |

The persona surface is determined at login by **role**, not by user. A user with both `GRO` and `PGR_LME` (which is more common than the role model implies, per [[project_naipepea_role_data_pollution]]) gets both layouts, switchable.

## KPI taxonomy

Group KPIs into three buckets so widget development can target one at a time:

### Bucket 1 — counts & lists (V1)

- Open complaints by status
- Open complaints by ward (heatmap)
- My-assignments list (LME, supervisor)
- Inbox depth (GRO)
- Resolved-this-period count
- Cumulative volume by month/quarter

These are direct queries against `pgr-services` `/request/_count` and `/request/_search` with status filters. No new infrastructure required.

### Bucket 2 — derived metrics (V2)

- Average resolution time (per ward, per service code, per LME)
- SLA breach rate (% of complaints exceeding configured SLA)
- Escalation rate (% triggering auto-escalation)
- First-response time
- Reopen rate

These need either (a) on-the-fly aggregation across `eg_pgr_request` + `eg_wf_processinstance`, or (b) a materialised view refreshed by the existing `DashboardRefreshScheduler` (already present in pgr-services).

Recommend (b): the scheduler exists, the cost of computing aggregates client-side per dashboard load is wasted; do it once every 5–15 min and serve from MVs. The configurable cron in `pgr.dashboard.refresh.interval.ms` is the lever.

### Bucket 3 — comparative / trend (V3)

- Period-over-period comparisons (this month vs last month)
- Forecasts (simple trailing-average or seasonally-adjusted)
- Outlier detection (which wards regressed week-over-week)

These need persistence of historical snapshots, not just current MVs. Likely a separate aggregate table populated daily.

## Widget primitives

Five primitives cover ~90% of the bucket-1 + bucket-2 needs:

1. **Stat card** — single big number + optional sparkline
2. **Time-series chart** — line / area, configurable time bucket
3. **Categorical bar / leaderboard** — top-N by status / ward / LME
4. **Geo / boundary heatmap** — open complaints by boundary level, colour-scaled
5. **Filterable table** — paginated, sortable, click-through to detail

Anything outside these is a one-off and shouldn't drive the abstraction — ship it as a custom React component embedded in a layout cell rather than expand the primitive set prematurely.

## Customisation model

Three layers, in increasing scope:

| Layer | Owns | Who can change |
|---|---|---|
| **Tenant default** | Default layout per persona for the whole tenant | Admin via configurator |
| **Role default** | Layout per role, overrides tenant default | Admin via configurator |
| **User override** | Individual layout edits (move widget, hide widget, change filter default) | The user themselves |

Storage:
- Tenant / role defaults: MDMS (`CCRS-Dashboard.LayoutTemplates` schema, keyed by `personaRoleCode`)
- User overrides: a small new table `eg_dashboard_layout` (userUuid, layoutJson, updatedAt) — kept in pgr-services or a new lightweight service

Layout JSON shape: `react-grid-layout` is a natural fit (it's the resizable grid the issue body asks for). Each widget instance is `{ id, type, position: {x,y,w,h}, config: {...} }`. Validating that against a tenant-allowed widget list happens server-side at save.

## Filter chassis

Global filters live at the top of every dashboard:
- Date range (default: rolling 30 days, persona-configurable)
- Ward / boundary (default: scoped by user's jurisdiction)
- Service code (default: all)
- Status (default: open states for GRO/LME; closed for admin trend views)

Per-widget filters override global ones for that widget only.

**Filter persistence**: the same `eg_dashboard_layout` blob holds the user's preferred filter defaults — same store, same lifecycle.

## Data freshness model

- **Bucket 1** widgets: query at load time, cache client-side for 60s.
- **Bucket 2** widgets: served from MVs refreshed by `DashboardRefreshScheduler`. Default refresh: 5 min. Each widget exposes "as of HH:MM" so users know the lag.
- **Bucket 3** widgets: served from daily-aggregate tables. "As of yesterday" is fine.

No live websocket / SSE in V1. Pull on view, optional auto-refresh on a 60s timer.

## Build phases + estimated effort

### MVP — citizen + GRO dashboards, bucket 1 only

- Citizen "my complaints" view + status counts
- GRO inbox depth + ward heatmap
- 3 widgets total, no customisation, hardcoded layouts
- **Estimate: 2–3 weeks** (UI primitives + 3 widgets + service integration)

### V1 — all five personas, bucket 1 + 2

- All five persona layouts
- 5 widget primitives implemented and tested
- MV-driven bucket 2 widgets (avg resolution time, SLA breach rate)
- Role-default layouts saved to MDMS, no user override yet
- **Estimate: 6–8 weeks after MVP** (4 new widget types + MV migration + scheduler refresh + 4 new persona configs)

### V2 — user overrides, filter chassis

- User can move/hide/resize widgets; layout persists
- Global filter row + per-widget overrides
- "As of" timestamps everywhere
- **Estimate: 3–4 weeks after V1** (storage + UI for drag/resize + filter wiring)

### V3 — bucket 3 (trends, comparisons)

- Daily snapshots + comparative widgets
- Per-tenant historical depth (start at 90 days)
- **Estimate: 4–6 weeks after V2** (snapshot pipeline + UI primitives for compare + storage)

Cumulative MVP → V3: roughly **4–5 months of one full-time engineer**, more parallelisable if persona work is split.

## Out-of-scope (explicitly, for now)

- Cross-tenant aggregation. Each tenant sees its own data; central-instance / multi-tenant rollups are a separate enhancement.
- Real-time push (websocket / SSE). Pull + auto-refresh covers the use cases.
- Export to PDF / scheduled email. Worth a follow-up issue when the layouts stabilize, not in this scope.
- Drill-down navigation that opens a separate workflow inside the dashboard (e.g. "from this widget, complete the reassign"). Click-through to the existing complaint detail view is V1; embedded actions are V2+.

## Open questions for the issue author

1. **Personas** — does the supervisor view exist as a distinct role today, or is "supervisor" a label for senior LMEs? (Affects whether we need a new role or just a layout for an existing one.)
2. **Citizen dashboard** — is this in scope for V1 or can citizen UI keep its current "my complaints" list? Citizen dashboards add ~30% to the work.
3. **Tenant default editing** — is configurator-as-admin-UI the right place for the role/tenant default layouts, or should there be a separate Dashboard Designer view?
4. **Persistence tradeoff** — happy with MVs (5–15 min lag) or do KPIs need to be live? Live + MV is a 2x infra cost; the issue should decide explicitly.

These questions don't block MVP scoping but do shape V1+ architecture choices.

Related: `pgr-services/src/main/java/org/egov/pgr/service/DashboardRefreshScheduler.java`, [[project_naipepea_role_data_pollution]], `feedback_p0p1_loop_discipline.md`.
