# Engineering Edition Architecture

This fork is currently based on the upstream `0.26.8` package version, but the checkout is a later fork commit. It retains Qwen Code's existing runtime; the engineering edition adds no parallel agent loop.

## Existing runtime and extension points

- `packages/core/src/core/agent-loop.ts`, `client.ts`, and `coreToolScheduler.ts` own model turns, request lifecycle, and tool dispatch. Agent construction also lives in `agents/runtime/agent-core.ts` and `agent-headless.ts`.
- `core/prompts.ts`, `environmentContext.ts`, `services/chatCompressionService.ts`, and `memory/request-context.ts` assemble prompts and compact history. `agents/forkedAgent.ts` supplies isolated agent execution.
- `tools/tool-registry.ts`, `tool-search.ts`, and `code-mode.ts` already support deferred schema discovery and bridged calls. Output limits, truncation, retention, and recovery are in `tool-output-size.ts`, `truncation.ts`, `tool-result-retention.ts`, and `tool-output-recovery.ts`.
- `telemetry/gen-ai-usage.ts`, `context-usage.ts`, and `api-activity-tracker.ts` observe usage; `tokenLimits.ts`, `turn-budget.ts`, and `agents/runtime/workflow-budget{,-ledger}.ts` provide budget controls.
- Provider translation is split among `providers/provider-config.ts`, `core/contentGenerator.ts`, and the OpenAI Chat Completions, OpenAI Responses, and Gemini generators. Skills and delegation already use `skills/skill-manager.ts`, `skill-activation.ts`, `skill-load.ts`, and `subagents/subagent-manager.ts`.
- LSP support is implemented in `packages/core/src/lsp/` and `tools/lsp.ts`; CLI settings are in `packages/cli/src/config/settings{,Schema}.ts`.

## Intended direction

Keep decisions provider-independent and deterministic where possible. Extend existing telemetry, policy, prompt/skill, and budget extension points before proposing new top-level modules. Treat provider-reported, locally estimated, and unavailable usage distinctly. Do not infer capabilities from model aliases. Keep verification in existing local build/lint/test tools. Any new behavior must preserve existing permission, confirmation, and tool scheduling paths.

## Implemented quota extension

Session telemetry exposes an exact provider-reported total when every
successful API response supplied `total_token_count`; otherwise it reports
unknown. Historical model-only restoration is unknown, and replay rollback
preserves the exact/unknown value. Cached input is included only as counted by
the provider's total.

`QWEN_CODE_MAX_PROVIDER_TOKENS_PER_SESSION` warns at 80% and gates new optional
workflow-agent dispatches and optional `Agent` tool spawns at the cap. Unknown
usage fails closed for those requests. The workflow gate checks both entry and
scheduler slot acquisition. It does not interrupt active calls or the primary
response. This is a session token cap, not a cost cap; see the
[quota design](../design/2026-11-06-session-provider-quota.md).
