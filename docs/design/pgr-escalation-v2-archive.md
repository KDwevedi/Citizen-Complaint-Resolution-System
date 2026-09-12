# PGR escalation v2: implementation archaeology and disposition

> **Status:** historical analysis, recorded 2026-09-12. This document does not
> define the escalation contract and does not make the old v2 design current.
> The short description of the implementation on `master` is in
> [PR #2035](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2035).
> The replacement contract and cleanup acceptance criteria are in
> [issue #2048](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2048).

## Conclusion

The ChakshuGautam “escalation v2” pull requests are not a set of small,
independent changes. They are several views of one large, stacked experiment.
The experiment began with an operational wrapper around the existing
assignee-to-`reportingTo` escalation, then accumulated:

- five ordered SLA sources;
- six new or extended `CRS.*` schemas;
- workflow-state translation;
- a second target-resolution algorithm for unassigned role-inbox complaints;
- an operator trigger, dry-run mode, pre-breach events and telemetry;
- Configurator SLA/policy screens and a workflow designer;
- test and deployment material tied to direct Bomet experiments.

The stack never merged. Its final cumulative PR is stale, conflicts with
`develop`, has failing checks, and no longer matches the agreed platform model.
It must not be rebased or merged as a unit.

The target model is deliberately smaller:

```text
assigned complaint
    + breached SLA or manual Escalate command
    -> current assignee.reportingTo
    -> ESCALATE self-loop
    -> same state, new employee assignee
    -> one shared metadata and clock update
```

There is one SLA configuration, `RAINMAKER-PGR.EscalationConfig`. An unassigned
complaint is not auto-escalated. A literal `SUPERVISOR` role, a role-holder
search, and a `PENDINGATSUPERVISOR` workflow state are not part of target
selection.

Closing the old PRs changes no merged runtime code. It also does not clean up
anything deployed directly to an environment from those branches. Source
closure and live-environment cleanup are separate operations.

## Pull-request family

All links below point to the upstream repository because that is where the
review and deployment history was recorded.

| PR | Intended delta | Actual review surface at audit time | Disposition |
|---|---|---:|---|
| [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) | v2 foundation: scheduler diagnostics, trigger API, CRS SLA model, Configurator, workflow designer, tests | 27 commits, 76 files, +11,739/-135 | Already closed unmerged; superseded by [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) |
| [#774](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/774) | Pin a Bomet `pgr-services` experiment image | 1 commit, 1 file | Already closed unmerged |
| [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775) | Replace hard-coded workflow-state names with `CRS.WorkflowStateMapping` | 27 commits, 76 files, +11,029/-135 | Close stale; design conflicts with the reduced model |
| [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776) | Document two ways to populate `CRS.CategorySLA` | 28 commits, 77 files, +11,215/-135 | Close stale; unique content is documentation for an abandoned model |
| [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) | Operational gotchas | 26 commits, 76 files, +11,318/-135 | Close stale; historical material was later copied by [#1600](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/1600) |
| [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) | New-tenant deployment runbook | 26 commits, 76 files, +11,637/-135 | Close stale; it provisions the abandoned multi-schema model |
| [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) | State-mapping and CSV edge-case tests | 29 commits, 78 files, +11,581/-135 | Close stale; extract isolated test ideas only if still applicable |
| [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) | Cumulative PRD alignment, later including role-level escalation | 62 commits, 124 files, +26,332/-178 | Close stale; archival source only |

At audit time, every still-open PR in this family reported `DIRTY` against
`develop`. [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)’s latest `test` and `tilt-test` checks were failing. None had an
approved review; GitHub reported `REVIEW_REQUIRED` for all six.

### Why the small PRs are enormous

[#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775) carries most of [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)’s foundation. [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776) and [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) descend from [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775), and
[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) also descends from [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775). [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) and [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) were cut from the same foundation
independently. They were opened against `develop`, not against the preceding
stacked PR’s head, so GitHub presents the entire unmerged foundation in each
diff.

The meaningful incremental changes were much smaller:

- [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776) adds `docs/categorysla-wiring-strategies.md` on top of [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775);
- [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) adds `docs/escalation-operational-gotchas.md` relative to the foundation;
- [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) adds `docs/deploying-escalation-to-new-tenant.md` relative to the
  foundation;
- [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) adds one backend state-mapping test and one Configurator CSV-parser test
  on top of [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775).

Closing one leaf therefore does not remove a unique implementation. [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) is the
only cumulative review candidate, and it is itself the wrong product design.

## Timeline

### Before v2

The repository already contained a simple automatic escalation engine. Its
essential model was a breached assigned complaint, the current employee’s HRMS
`reportingTo`, and an `ESCALATE` workflow action assigning that next employee.
The v2 work did not invent that core reporting-line hop.

### 2026-06-09: foundation and stack

[#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) opened as a broad end-to-end feature PR. Its own description bundled
backend behavior, four planned configuration schemas, two Configurator
surfaces, a new top-level workflow designer, Playwright tests, telemetry and
deployment documentation. The follow-up PRs [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775), [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776), [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794), [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) and [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797)
were opened within the same day as stacked implementation, documentation and
test deltas.

### 2026-06-10 to 2026-06-11: [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) expands the model

[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) opened on top of [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775). Its initial description explicitly listed
role-level escalation of unassigned complaints as “deliberately NOT in this
PR.” Later commits nevertheless implemented that feature, added a sixth schema,
and rewrote the design document to call the role path shipped on the branch.

This is important when reading [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815): its top-level description is not an
accurate description of its final head.

The branch was then built into custom images and tested directly on Bomet. The
PR comments record several successive image tags, direct schema registration,
MDMS writes, manual database repair for an assignee-persistence defect, and
live mutating escalation tests.

One test-window report is especially consequential: while role escalation was
enabled, the background scheduler reassigned 27 existing unassigned complaints
to the pinned employee. Workflow history is append-only, so those effects were
not undone by disabling the experiment.

### 2026-07-18: foundation closed in favour of [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)

[#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) was closed unmerged with an explicit note that [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) contained its code and
should be the single live escalation PR. The only [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)-only tail was described
as handoff/documentation material. This confirms that [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815), not [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770), is the
final implementation snapshot to use for archaeology.

### 2026-08-24: design documentation merged without implementation

[PR #1600](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/1600)
copied approximately 4,600 lines of the v2 design, deployment and operations
documentation into `develop` as a docs-only change. Its status banner correctly
says that the schemas, Configurator surface and role resolver would arrive with
[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815), but many later sections describe branch-only features as canonical,
shipped or closed.

Because [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) never merged, `develop` documentation and `develop` runtime do not
describe the same system. Those documents must be removed, archived or given a
prominent superseded notice before any `develop`-to-`master` synchronization.

### 2026-09-12: disposition

The agreed direction is recorded in [#2048](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2048): one self-loop operation shared by
manual and automatic triggers, one metadata model, one assignment-window clock,
one SLA configuration, and removal of the special supervisor workflow tier.
The old v2 PRs are closed as stale historical proposals, not merged.

## What [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) actually implements

### Scan scope

The scheduler examines complaints in `PENDINGATLME` and
`PENDINGFORASSIGNMENT`. It determines the current escalation level from
`additionalDetails.escalationLevel`, resolves a maximum depth, resolves an SLA,
and compares that SLA to:

```text
now - auditDetails.lastModifiedTime
```

It falls back to `auditDetails.createdTime` if the modification time is absent.

Only after the SLA is breached does the branch load current workflow
assignees. From there it splits into two target-resolution paths.

### Five-source SLA precedence

The final branch resolves SLA in this order:

1. `CRS.CategorySLA.slaHoursByLevel[level]`
2. `CRS.CategorySLA.slaHoursByState[mappedState]`
3. `CRS.EscalationPolicy.defaultSlaHoursByLevel[level]`
4. `CRS.StateSLA.stateDefaults[mappedState]`
5. `RAINMAKER-PGR.EscalationConfig`

If no higher source answers, the old service-property fallback remains behind
`EscalationConfig`.

`CRS.WorkflowStateMapping` translates tenant workflow-state names into the
fixed keys `new`, `triage`, `forwarded`, `investigation`, `awaiting` and
`resolved`. It is not itself an SLA source, but two state-indexed sources depend
on it.

The five-source cascade means an operator cannot understand an effective SLA
from one record. They must know which complaint tuple resolved, which workflow
mapping applied, whether a per-level or per-state cell was populated, and which
fallback won. The branch added `slaSource` telemetry and a trace-back UI largely
because the configuration model required that diagnostic machinery.

### Six `CRS.*` schemas

The cumulative branch defines or extends:

| Schema | Purpose |
|---|---|
| `CRS.CategorySLA` | SLA cells keyed by `(path, category, subcategoryL1)`, by state and later by escalation level |
| `CRS.StateSLA` | Tenant-wide state defaults |
| `CRS.SLAAuditLog` | Append-only audit of Configurator writes |
| `CRS.WorkflowStateMapping` | Workflow state to canonical SLA-state key |
| `CRS.EscalationPolicy` | Depth, default level SLAs, pre-breach settings, manual-comment rule and role-escalation settings |
| `CRS.RoleSupervisors` | Explicit person pins for an acting role and department |

This is separate from the legacy `RAINMAKER-PGR.EscalationConfig`, which [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)
keeps as its final MDMS fallback rather than replacing.

### Complaint-type mapping and the extended hierarchy

The v2 category lookup is not naturally based on the complaint’s exact leaf
`serviceCode`. It uses a three-part tuple:

```text
(path, category, subcategoryL1)
```

The branch documents two ways to obtain that tuple:

- store the tuple in complaint `additionalDetails` during intake; or
- extend `ServiceDefs` so `serviceCode` maps back to the tuple.

Both approaches introduce a second category identity that must remain aligned
with `ComplaintHierarchy`. The tuple also bakes in named hierarchy levels and
does not automatically generalize to arbitrary hierarchy depth. A deep leaf
can be made to work only by choosing which three levels the tuple represents
and maintaining that mapping.

The selected platform contract is simpler and more robust for an extended
hierarchy: `EscalationConfig.overrides` uses the complaint’s exact leaf
`serviceCode`. It works at any hierarchy depth, although it intentionally has
no parent inheritance.

## Assigned-complaint path

When the workflow returns one or more assignees, [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815):

1. reads assignees in workflow order;
2. finds the first assignee for whom HRMS returns a `reportingTo`;
3. builds workflow action `ESCALATE` with that employee UUID as the sole new
   assignee;
4. writes `escalationLevel + 1`, `lastEscalatedAt` and `escalatedFrom` to the
   complaint’s `additionalDetails`;
5. submits the workflow action;
6. updates `auditDetails.lastModifiedTime` in memory;
7. publishes the normal complaint update and a separate escalation event.

This part is conceptually aligned with the desired automatic target selection:
`ESCALATE` is upward reassignment to an employee found through `reportingTo`.
The workflow must still configure it as a same-state transition for the state
to remain unchanged.

The branch also improves one existing inconsistency: it resolves `maxDepth`
once in the scheduler (`EscalationPolicy`, then `EscalationConfig`, then static
property) and passes the result into `EscalationService`. The scheduler and
service can no longer enforce different depth values inside that path.

## Unassigned role path

When the workflow returns no current assignee, the original behavior is
`NO_ASSIGNEES`: skip and retry on a later scan. [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) retains that behavior only
while `CRS.EscalationPolicy.roleEscalation.enabled` is absent or false.

When enabled, it creates a second domain operation:

1. Map the complaint’s workflow state to an “acting role” through
   `roleEscalation.actingRoleByState`.
2. Map the complaint `serviceCode` to a department through the category tuple
   configuration.
3. Resolve exactly one employee through the first applicable strategy:
   - **R1 pin:** a `CRS.RoleSupervisors` row for `(actingRole, department)`,
     falling back to `(actingRole, ALL)`;
   - **R2 ladder:** find holders of
     `roleEscalation.supervisorRoleByRole[actingRole]` and accept exactly one;
   - **R3 consensus:** find holders of the acting role and accept their
     `reportingTo` only when all discovered values reduce to one employee.
4. Skip rather than guess if the mapping is absent, candidate results are
   ambiguous, HRMS fails, or a search page is truncated.
5. Submit `ESCALATE`, assign the resolved employee, increment the level and
   publish role-resolution provenance.

After the first role escalation creates a named assignee, later escalations use
the normal current-assignee `reportingTo` path.

This path is carefully defensive, but it answers a different question. It asks
“who represents the role that should own this unattended complaint?” The target
contract asks “who does the current assignee report to?” Without a current
assignee, the latter question has no answer and automatic escalation must stop.

`CRS.RoleSupervisors`, `actingRoleByState`, `supervisorRoleByRole`, department
candidate searches and `maxPerScan` are therefore out of scope for the one-flow
implementation.

## Manual escalation remains separate

[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) adds a manual-`ESCALATE` comment validator. A human request must include a
non-blank comment unless `CRS.EscalationPolicy.escalateCommentRequired` is
false. The operator trigger adds an `AUTO_ESCALATE` role so that its generated
comment is not treated as a human omission.

This does not route manual escalation through `EscalationService` and does not
make manual and automatic escalation the same operation. Manual escalation
continues through the ordinary PGR update path with the caller-supplied
assignee. In particular, the branch does not guarantee that manual escalation:

- selects or validates `currentAssignee.reportingTo`;
- increments `additionalDetails.escalationLevel`;
- writes `lastEscalatedAt` or `escalatedFrom` consistently;
- emits the same escalation event and telemetry;
- applies the same maximum depth;
- starts the same explicitly defined assignment window.

The v2 design document acknowledges part of this divergence: a manual
`ESCALATE` resets `lastModifiedTime` through the normal update flow but does not
increment the scheduler’s escalation level.

Consequently this sequence is still internally inconsistent:

```text
A --manual ESCALATE--> B --automatic ESCALATE--> C
```

The true hierarchy has advanced two hops, while v2 metadata can report only one
automatic level. The scheduler can select the wrong level SLA and allow an
extra hop beyond the intended maximum.

## The timestamp change is not the clock fix

[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) explicitly refreshes `auditDetails.lastModifiedTime` after automatic
escalation. This fixes one symptom in the pre-v2 code: without the refresh,
decreasing per-level SLAs can cascade through several hierarchy levels on
successive scheduler ticks because every level is measured from the earlier
ordinary update.

It does not make `lastModifiedTime` a correct assignment SLA clock.

Every accepted ordinary PGR update replaces `lastModifiedTime`, regardless of
whether ownership changes. This includes comments, ratings, attachments,
complaint content and location edits, contact/extended-attribute edits, and
workflow actions such as assign, reassign, forward, resolve, reject and reopen.

V2 therefore changes the timing error from one-sided to mixed:

- automatic escalation starts a fresh window by changing the generic audit
  time;
- an unrelated comment or edit also starts a fresh window and postpones a due
  escalation;
- manual escalation starts a generic update window but does not advance the
  same level metadata;
- migration and direct persistence can supply another audit value entirely.

The replacement needs a dedicated authoritative timestamp such as
`assignmentChangedAt` or `escalationWindowStartedAt`. Only initial assignment
and a successful ownership-changing escalation/reassignment policy should
change it. Generic complaint modification time must remain an audit field.

## Other v2 capabilities

### Trigger and dry run

[#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) adds `POST /pgr-services/escalation/_trigger`, allowing a privileged caller
to run the same scheduler logic synchronously. [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) adds `dryRun`, scoped
service-request IDs, `wouldEscalate`, per-complaint details and explicit
zero-mutation preview methods.

The dry-run concept is useful and can be extracted. It should preview the final
single-config, assigned-only operation and must remain authenticated,
tenant-scoped and demonstrably non-mutating.

### Structured diagnostics and telemetry

The stack adds typed skip reasons, scan totals, child spans, per-complaint
attributes and target/SLA provenance. Those are useful independent ideas. The
final implementation needs fewer reasons because it has no tuple mapping or
role resolver, but it should retain observable outcomes such as:

- SLA not breached;
- no current assignee;
- maximum depth reached;
- no `reportingTo` employee;
- workflow self-loop rejected;
- successful manual or automatic escalation.

### Pre-breach warnings

[#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) detects a configurable percentage crossing and publishes a
`pgr-escalation-prebreach` event. Detection is stateless and can miss a warning
if no scheduler tick occurs in the crossing interval. Delivery to users is not
included.

This is an optional product feature, not required to consolidate escalation.
It should not force retention of the five-source SLA model or a new policy
schema. If retained later, it should consume the same one SLA and dedicated
assignment window as escalation itself.

### Configurator surfaces

The stack includes:

- an editor for the legacy `RAINMAKER-PGR.EscalationConfig`;
- an SLA Matrix for `CRS.CategorySLA`/`CRS.StateSLA`;
- an Escalation Settings page for `CRS.EscalationPolicy` and
  `CRS.WorkflowStateMapping`;
- a role-supervisor pin editor;
- an embedded workflow designer in a new top-level application.

Only the first item directly serves the chosen runtime model. Its user
experience may be extracted after fixing the current MDMS authorization and
schema/runtime-shape problem tracked in
[issue #2034](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2034).
The matrix, policy, role pinning and workflow-designer bundle must not be merged
as prerequisites for automatic escalation.

## Conflicts with the selected contract

| Concern | Escalation v2 final branch | Selected platform contract |
|---|---|---|
| SLA configuration | Five-source cascade across `CRS.*` and legacy MDMS | One `RAINMAKER-PGR.EscalationConfig` record |
| Complaint-type key | Three-level tuple obtained from details or `ServiceDefs` | Exact leaf `serviceCode` |
| Extended hierarchy | Requires tuple conventions/mapping maintenance | Depth-agnostic exact leaf lookup |
| Eligible ownership | Named assignee, plus optional unassigned role inbox | Current assignee required |
| Automatic target | `reportingTo`, or R1/R2/R3 role resolution | Current assignee’s `reportingTo` only |
| Meaning of `ESCALATE` | Automatic reassignment, manual labelled reassignment, and role assignment | One upward reassignment operation |
| Manual target | Caller-supplied assignee | Same `reportingTo` target; arbitrary movement is `REASSIGN` |
| Metadata | Scheduler owns level/event fields | Shared atomic metadata for both triggers |
| SLA clock | General `auditDetails.lastModifiedTime` | Dedicated current-assignment window |
| Workflow state | Depends on whatever `ESCALATE` transition is provisioned | Required same-state self-loop |
| Supervisor concept | Role pins/ladders can be material | No literal role in target selection |
| Unassigned complaint | Optional automatic role escalation | Skip; use `ASSIGN` |

## Workflow relationship

Neither [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) nor [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) removes the old supervisor-state lifecycle from all
workflow seeds. The v2 service issues the action name `ESCALATE`; workflow
configuration decides whether that action is a self-loop or enters
`PENDINGATSUPERVISOR`.

This means the branch can demonstrate an assignment hop while still using the
wrong lifecycle. One Bomet verification comment explicitly reports that its
test complaint moved to `PENDINGATSUPERVISOR`. Once there, the scheduler’s scan
set (`PENDINGATLME`, `PENDINGFORASSIGNMENT`) no longer includes it, so a
state-transition deployment cannot provide automatic multi-hop escalation.

The replacement work must update source-controlled workflow seeds,
provisioned BusinessServices, UI action/status lists, localizations,
notifications, dashboards and tests together. Historical workflow records
should remain readable even after legacy states stop being reachable.

## Documentation drift on `develop`

[#1600](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/1600) was intentionally docs-only and did not merge [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)’s code. The resulting
documents include an honest opening status note, but also contain statements
such as:

- “Canonical Design Doc”;
- five-source SLA resolution;
- six supporting schemas;
- role-level escalation “implemented” and “live-verified”;
- per-state and per-level SLA models coexisting;
- `lastModifiedTime` refresh described as a state-clock reset.

These statements describe [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) and its Bomet experiment, not merged platform
behavior. Readers can easily miss the qualification at the start of a
2,600-line design document.

Required follow-up on `develop`:

1. Replace the canonical/current language with an archival warning, or remove
   the abandoned operator/design set.
2. Point readers to the short current behavior in [#2035](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2035) and the target contract
   in [#2048](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2048).
3. Do not publish a deployment runbook that seeds the `CRS.*` cascade as the
   supported escalation setup.
4. Preserve genuinely useful incident evidence in an explicitly historical
   document rather than presenting it as an operator procedure.

## Live-environment implications

The PR comments establish that branch code and configuration existed on Bomet
even though the PR never merged. They report:

- custom `pgr-services` images from [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815);
- a working `/escalation/_trigger` endpoint;
- direct registration and seeding of `CRS.WorkflowStateMapping`,
  `CRS.EscalationPolicy`, `CRS.CategorySLA`, `CRS.StateSLA`,
  `CRS.SLAAuditLog` and later `CRS.RoleSupervisors` artifacts;
- Configurator escalation settings and SLA-matrix pages;
- role-resolution fixtures and shared-policy mutations;
- real background reassignment of complaints during a role test;
- workflow acceptance of a `SYSTEM` caller even where configured action roles
  apparently did not list it.

The comments also record redeploy drift: a full Ansible deployment temporarily
restored an older image/configuration until the experimental pin was added to a
checked-in Compose file. No conclusion about current Bomet state should be
drawn solely from either Git history or the June report.

Before removing v2 artifacts from any environment:

1. Resolve the running `pgr-services` image digest, not only its tag.
2. Probe whether `/pgr-services/escalation/_trigger` exists and record its
   authorization behavior without running a mutating scan.
3. Inventory active MDMS schemas and records for all six `CRS.*` names.
4. Read the active `CRS.EscalationPolicy` and verify role escalation is disabled
   before other cleanup.
5. Inventory the active PGR BusinessService and complaints in legacy supervisor
   states.
6. Determine whether pre-breach and escalation topics have active consumers.
7. Check whether the Configurator routes and workflow designer are deployed or
   linked from navigation.
8. Review the 27 complaints mentioned in the June role-test report and any
   later entries created by the experimental scheduler.
9. Deploy the supported single-flow implementation and migrate workflows/data
   according to [#2048](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2048) before deleting live configuration.
10. Remove only proven-unused v2 schemas, records, routes, images and UI
    surfaces. Preserve audit/workflow history.

Do not delete `RAINMAKER-PGR.EscalationConfig`: it is the configuration retained
by the selected implementation.

## What can be extracted safely

The old branches should remain readable as GitHub history. Reusable work should
be reimplemented or cherry-picked in focused PRs only after comparison with
current code.

Good candidates:

- structured skip reasons and scan summaries;
- per-complaint telemetry rather than last-writer-wins scan attributes;
- an authenticated, truly non-mutating dry run;
- current-assignee history fallback, if current workflow behavior still needs
  it;
- resolving `maxDepth` once and passing it through the operation;
- tests for assigned complaint → first valid `reportingTo`;
- tests for no assignee, no `reportingTo`, maximum depth and failed self-loop;
- a Configurator editor for the one supported `EscalationConfig` shape;
- enriched audit data, implemented by the shared manual/automatic operation.

Do not extract as platform dependencies:

- the five-source SLA precedence;
- `CRS.WorkflowStateMapping` solely for escalation;
- the category tuple as an alternative complaint identity;
- `CRS.RoleSupervisors` or the R1/R2/R3 resolver;
- automatic escalation of unassigned complaints;
- `lastModifiedTime` as the assignment SLA clock;
- the separate manual-comment policy as a substitute for shared semantics;
- environment-specific image pins, live fixture data or credentials;
- the embedded workflow designer bundled with an escalation change.

Pre-breach warnings and a configuration audit log are independent product
choices. They can be revisited later without reviving the v2 configuration
cascade.

## Closure rationale by PR

### [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775) — workflow-state mapping

Close because the target scheduler has a fixed, documented scan contract and
one SLA source. Adding an MDMS state dictionary only for SLA resolution creates
another configuration dependency. The PR also includes the whole unmerged
foundation and conflicts with current `develop`.

### [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776) — category wiring strategies

Close because it documents how to populate an abandoned three-part
`CategorySLA` tuple. Exact leaf `serviceCode` overrides are the selected
extended-hierarchy contract. The useful historical explanation remains
available through PR history and the docs copied by [#1600](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/1600) pending cleanup.

### [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) — operational gotchas

Close because its recipes operate the v2 schemas/images and should not be used
as current production instructions. Preserve verified incident evidence in
this archive; do not keep a runnable abandoned-model runbook discoverable as
the primary procedure.

### [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) — tenant deployment runbook

Close because it would instruct operators to install the multi-schema cascade
and state mapping for new tenants. That directly conflicts with one
`EscalationConfig`.

### [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) — mapping and CSV tests

Close because its tested features are not being adopted. Individual testing
techniques can be recreated against the final one-config behavior without
carrying the stack.

### [#815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) — cumulative implementation

Close because it is stale, conflicting, failing checks, and contains mutually
incompatible domain models. It does not unify manual and automatic escalation,
does not establish a dedicated assignment clock, adds role-based escalation of
unassigned complaints, retains multiple SLA sources, and does not remove the
supervisor workflow tier. Useful operational improvements must be extracted
independently.

## Decision record

The closure decision is about product and implementation convergence, not the
quality of the investigation. The v2 work generated useful evidence about
workflow assignee persistence, scheduler observability, safe previews, schema
deployment, MDMS redelivery, HRMS ambiguity and live-test blast radius.

Its main architectural lesson is that escalation became hard to explain
because several different concepts were made configurable at once:

- complaint SLA policy;
- workflow-state vocabulary;
- complaint taxonomy identity;
- reporting hierarchy;
- role inbox ownership;
- manual workflow commands;
- deployment diagnostics.

The replacement deliberately separates those concerns. Escalation itself is
one same-state upward reassignment. Assignment, lateral reassignment,
workflow-state progression, role-inbox routing, notification delivery and
workflow design remain distinct capabilities.

## Primary evidence

- [#770: original foundation and stack description](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
- [#770 closure: superseded by #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770#issuecomment-5011468800)
- [#815: cumulative final branch](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)
- [#815: first Bomet PRD-image deployment report](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815#issuecomment-4669711844)
- [#815: Configurator deployment and redeploy-drift report](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815#issuecomment-4672223489)
- [#815: role escalation and 27-complaint live side effect](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815#issuecomment-4675721201)
- [#815: role fixtures, R2/R3 tests and MDMS redelivery finding](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815#issuecomment-4677744709)
- [#1600: v2 documentation copied to `develop`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/1600)
- [#2035: short current automatic-escalation documentation](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/2035)
- [#2037: implementation and metadata inconsistency audit](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2037)
- [#2048: selected one-flow contract and migration acceptance criteria](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2048)
