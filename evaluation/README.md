# Offline Engineering Evaluation

This local comparator checks baseline and candidate run records without
starting Qwen Code or contacting a model endpoint. It reports provider usage
separately from task completion, test outcomes, regression defects, and human
review state. Usage fields and `reportedCostUsd` accept `null` when a provider
does not report a value. Aggregates stay unknown if any included run is
unknown; do not substitute zero or put estimated cost in `reportedCostUsd`.

Run the synthetic schema fixture:

```bash
node evaluation/compare.mjs \
  --baseline evaluation/fixtures/synthetic-baseline.json \
  --candidate evaluation/fixtures/synthetic-candidate.json
```

To save a report, add `--output report.json`. The output file must not already
exist. Replace the fixture inputs with JSON run records from an offline mock
provider or an explicitly authorized recorded evaluation. Both inputs must
use `schemaVersion: 1`, identify the same provider, model, protocol, and
`configHash`, contain matching `caseId`/`sampleId` pairs, and use the same
`source` value (`synthetic` or `recorded`). See `cases.json` for the supported
categories.

Run the comparator tests with `node --test evaluation/compare.test.mjs`.

Run the local CLI fake-provider smoke task after building the bundle:

```bash
npm run build && npm run bundle
QWEN_SANDBOX=false npx vitest run --root ./integration-tests engineering-evaluation.test.ts
```

The smoke task writes and checks a file using a local fake OpenAI-compatible
server and asserts the known mock usage totals. It sends no request to a
configured provider. It validates one execution path; it is not a broad
engineering benchmark and its synthetic usage is not a savings claim.

## Ten-category offline benchmark

`integration-tests/engineering-benchmark.test.ts` executes one deterministic
task in each of the ten categories with the bundled CLI and a local fake
provider:

```bash
npm run build && npm run bundle
QWEN_SANDBOX=false npx vitest run --root ./integration-tests engineering-benchmark.test.ts
```

Set `QWEN_EVALUATION_BASELINE_CLI` to another `dist/cli.js` to run the same
tasks against a baseline checkout, and `QWEN_EVALUATION_RUNS_DIR` to save
schema-v1 records for `evaluation/compare.mjs`:

```bash
QWEN_SANDBOX=false \
QWEN_EVALUATION_BASELINE_CLI=/path/to/baseline/dist/cli.js \
QWEN_EVALUATION_RUNS_DIR=/path/to/empty-runs-dir \
npx vitest run --root ./integration-tests engineering-benchmark.test.ts
```

Current local result: 10/10 cases passed on this fork and 10/10 on upstream
v0.26.8. Both recorded 68,781 input, 2,558 output, 17,189 cached, 54 requests,
40 tool calls, and 6 compaction requests. Equality is expected because both
CLIs receive the same scripted responses; it is not measured savings. All ten
quality checks passed with zero regression defects, and human review remains
pending.

To run the same task against an upstream baseline CLI and this checkout, build
the requested baseline commit in a separate checkout, then set
`QWEN_EVALUATION_BASELINE_CLI` to its `dist/cli.js` path before running the
same command. The test runs baseline and candidate independently in temporary
projects against deterministic mock responses. Equal mock token totals are
expected and do not measure savings. This was verified locally on 2026-11-06
against upstream `21ed8f1efbb351b973d96e2bc9efa78f278df99c` and the current
fork: both created the expected file and used 400 input, 42 output, and 80
cached mock tokens over 3 requests.

To save comparable run records for the smoke case, set
`QWEN_EVALUATION_RUNS_DIR` to a new or empty directory along with the baseline
CLI variable. The test writes `upstream-baseline.json` and
`engineering-edition.json` as synthetic schema-v1 run sets. Compare them with:

```bash
node evaluation/compare.mjs \
  --baseline /path/to/runs/upstream-baseline.json \
  --candidate /path/to/runs/engineering-edition.json
```

The records preserve unknown reasoning, retry, subagent, compaction, and cost
values as `null`; the smoke task does not observe those fields.

The checked-in fixture values are synthetic examples. Their equality is a
schema and execution check, not a benchmark result or evidence of token
savings. Human review remains pending in the example records. The comparator
does not collect live provider telemetry, judge code quality, or calculate
pricing from token counts. The separate CLI tests execute coding tasks through
a deterministic fake provider: one smoke case and the ten benchmark categories.
