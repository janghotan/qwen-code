# Session provider-token quota

[中文版](2026-11-06-session-provider-quota.zh-CN.md)

## Context

Workflow runs can dispatch optional agent requests after the main request. The
existing workflow token budget counts output tokens and does not account for
provider-reported total usage, including cached input. Provider usage is
already normalized into API response telemetry, but session telemetry did not
retain whether every response supplied an exact total.

## Decision

Add a session-scoped exact total counter to `UiTelemetryService`. Sum only
positive provider-reported `total_token_count` values. If any successful
response reports no total or a non-positive total, the session total becomes
unknown and remains unknown until reset. Historical model-only restore is
unknown because it cannot reconstruct per-response provider totals. Replay
rollback snapshots preserve the exact/unknown state. Closed sessions are
unknown so an active optional workflow cannot mistake cleared telemetry for
unused quota.

Add optional `QWEN_CODE_MAX_PROVIDER_TOKENS_PER_SESSION`. When configured, the
workflow host refuses new optional workflow agent dispatches and the `Agent`
tool refuses new optional spawns at or above the cap, and both fail closed if
session usage is unknown. It warns once after 80% of the cap. The workflow host
checks both dispatch entry and scheduler slot acquisition. Active requests and
the primary model response are never interrupted. The existing output-token
workflow cap remains independent.

## Consumers and boundaries

The shared quota resolution and error text live in `telemetry/provider-quota.ts`.
The new telemetry getter is consumed by `WorkflowBudgetImpl.fromConfig` and the
`Agent` tool's spawn admission check. The host-only quota state is checked in
both gates in `workflow-orchestrator.ts`; it is not exposed to workflow
JavaScript. Existing telemetry replay consumers continue using the same
snapshot transaction.

## Limitations

The cap is session-wide, not a currency limit or a per-turn budget. Providers
that omit a total or report a non-positive total cause optional workflow
dispatches and `Agent` spawns to be refused once a cap is enabled. The gate
cannot bound already-running requests or the primary request; parallel
in-flight agents can cross a cap before their responses are recorded.

## Verification

Add tests for aggregation, unknown usage, reset/removal, replay rollback,
configuration parsing, warning behavior, both workflow dispatch gates, and
`Agent` spawn admission. Run focused telemetry, workflow budget/orchestrator,
and agent tests, then build and typecheck the workspace.
