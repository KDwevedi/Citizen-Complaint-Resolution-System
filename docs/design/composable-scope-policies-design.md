# Access Control — Configurable Per-Role Record-Scope Axes (superseded)

**Author:** Vinoth Rallapalli · **Original date:** 2026-07-15 · **Status:** Superseded 2026-08-12 — do not implement

This proposal assumed the established PGR employee row-access contract required both department
and jurisdiction. Live differential verification disproved that premise: a DEPT_5 principal saw
three legacy rows, while the mandatory locality/jurisdiction predicate reduced the same result to
one.

The compatibility contract is therefore:

- citizens: own complaints only;
- constrained employees: complaints in their HRMS department, across localities;
- explicitly tenant-wide roles: no department restriction;
- existing RoleAction mappings: unchanged;
- field masking: additive after row authorization.

The implementation removes jurisdiction/locality from `PrincipalScopeResolver`, `AnalyticsScope`,
`PGRQueryBuilder`, `PolicyInputBuilder`, and action 2008's condition. If a deployment later needs a
new locality-based authorization rule, it requires a fresh compatibility and threat-model review;
this obsolete configurable-axes proposal must not be revived as the default.

The original proposal remains available in Git history.
