# ADR 0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-09

## Context

`docs/PLAN.md` requires an ADR for every decision about architecture, security, data model, cost or a new dependency. The agent and the product owner need one place to see what was decided, why, and what it costs.

## Decision

- ADRs live in `docs/adr/` as `NNNN-short-title.md`, numbered in order and never reused. Numbers reserved in a phase plan keep their number even if they land out of order.
- Each ADR has: Status (Proposed, Accepted, Superseded by ADR NNNN), Date, Context, Options, Decision, Consequences. Spike ADRs also record the raw measurements, the method and the date measured.
- An ADR merges in the same pull request as the change it describes. A later change of mind is a new ADR that supersedes the old one; accepted ADRs are not rewritten, except to update the Status line.

## Consequences

- Decisions are reviewable in the pull request, next to the code.
- A short ADR is better than none; one page is the target.

## Template

```markdown
# ADR NNNN: Title

- Status: Proposed
- Date: YYYY-MM-DD

## Context
## Options
## Decision
## Consequences
```
