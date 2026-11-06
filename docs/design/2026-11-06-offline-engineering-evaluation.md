# Offline Engineering Evaluation

[English](2026-11-06-offline-engineering-evaluation.md) | [简体中文](2026-11-06-offline-engineering-evaluation.zh-CN.md)

## Intent and current state

The engineering edition needs repeatable comparisons that keep usage
accounting distinct from engineering quality. The repository already has
startup and integration benchmarks, but no offline report format for coding
task outcomes and provider usage. This design adds a local comparator, a single
CLI smoke task, and a deterministic ten-category benchmark, all using a local
fake provider; it does not call a configured model.

## Goals and boundaries

- Compare matching baseline and candidate records for ten engineering task
  categories.
- Report token, request, retry, tool, subagent, compaction, and provider
  reported cost totals separately from completion, test, regression, and
  human review outcomes.
- Keep unknown cost unknown and label synthetic fixtures explicitly.
- Reject malformed or mismatched runs.
- Do not add dependencies, credentials, live endpoints, or quality claims
  inferred from token counts.

This is a comparison harness over recorded/mock usage, not an agent evaluation
runner, cost estimator, or automated code-quality judge.

## Approaches

1. Add evaluation logic to the production core telemetry service. This would
   couple test reporting to runtime code and expand core scope unnecessarily.
2. Build a standalone offline comparator and versioned fixture schema. This
   is chosen because it keeps benchmark tooling isolated and can validate
   provider usage without network access.
3. Call real model endpoints from a benchmark runner. This requires credentials
   and spends quota, so it is outside this local implementation.

## Design

`evaluation/cases.json` defines stable case identifiers. `evaluation/compare.mjs`
validates versioned JSON run sets, requires the same provider/model/protocol/
configuration fingerprint and identical case/sample pairs, aggregates
provider metrics, and calculates percentage changes only when the baseline
value is known and nonzero. Cost is reported only when every paired input has
provider-reported cost. Any unreported usage field remains `null` through
aggregation rather than being treated as zero. Quality remains a separate baseline/candidate summary.
The command writes JSON to stdout or creates a new output path without
overwriting an existing file.

The synthetic fixtures exercise the schema across all ten categories. Their
values are explicitly not measured results. Future recorded comparisons must
use the same cases, samples, provider/model configuration, and task conditions
for both sides; human reviewers must inspect code before accepting quality
claims.

`integration-tests/engineering-evaluation.test.ts` separately runs one fixed
file-writing task through the bundled CLI and the existing localhost fake
OpenAI-compatible server. It checks resulting file contents and the mock's
known usage. If `QWEN_EVALUATION_BASELINE_CLI` points to a separately built
baseline CLI, it runs the same task against both baseline and candidate. This
smoke test can write schema-v1 synthetic run records to
`QWEN_EVALUATION_RUNS_DIR`; fields it cannot observe remain `null`. This does
not produce measured savings or measure broad engineering quality.

`integration-tests/engineering-benchmark.test.ts` runs one deterministic task
in each of the ten categories through the bundled CLI and the same local fake
server. Every case checks task completion, test outcome, and regression defects
separately from token usage. The long-session case forces compaction with a
reduced context window, and the recovery case records a session and resumes it
with `--continue`. An optional baseline CLI and saved run records use the same
environment variables as the smoke task.

## Validation and acceptance

- Node's built-in test runner covers aggregation, zero baselines, malformed
  identifiers, mismatched experiment settings, and unknown usage/cost fields.
- The checked-in synthetic comparison runs offline and reports no measured
  savings.
- The one-case fake-provider CLI smoke task runs without external network
  access and validates its file change and mocked usage totals.
- An optional baseline CLI can be exercised with the same task and mock
  responses; the fixed usage values are equal by construction.
- The ten-category benchmark passes for both the baseline and candidate CLIs
  and verifies each task's completion and tests offline.
- No model endpoint or external service is contacted.
- Documentation states the schema and its limits.

## Limitations

The comparator itself does not launch agents, capture usage, execute tests,
normalize model-specific price sheets, or score human-reviewed code quality.
The smoke test covers only one deterministic task. The ten-category benchmark
proves execution and schema compatibility, but both sides receive the same
scripted responses, so it does not measure savings. Human-reviewed quality
measurements and any authorized live comparison remain future work.
