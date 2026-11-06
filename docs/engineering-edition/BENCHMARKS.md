# Engineering Benchmarks

`evaluation/compare.mjs` compares baseline and candidate usage and quality
records offline. It covers ten categories in `evaluation/cases.json` and emits
per-category and aggregate JSON metrics for input, output, cached and reasoning
tokens; requests; retries; subagent and compaction requests; tool calls; and
provider-reported cost. Quality is reported separately as completion, test
pass rate, regression defects, and human-review state.

Run inputs use schema version 1 and must match on provider, model, protocol,
configuration fingerprint, case, and sample. Any token or cost field that was
not reported must be `null`; the comparator keeps its aggregate unknown rather
than treating it as zero. It calculates percentage changes only when the
baseline is known and nonzero.

Run the checked-in synthetic example:

```bash
node evaluation/compare.mjs \
  --baseline evaluation/fixtures/synthetic-baseline.json \
  --candidate evaluation/fixtures/synthetic-candidate.json
```

Current result: 10 fixture cases compare successfully; baseline and candidate
fixture counters are equal by construction. This is a schema/runner check, not
a performance result. The examples have unknown provider cost and pending
human review. See `evaluation/README.md` for the record format and limitations.

The local CLI fake-provider smoke task is runnable after building the bundle:

```bash
npm run build && npm run bundle
QWEN_SANDBOX=false npx vitest run --root ./integration-tests engineering-evaluation.test.ts
```

It performs one deterministic file-writing task and checks its resulting
content and the mock provider's reported usage. Those synthetic values are
useful for exercising the CLI and fake-provider boundary; they do not establish
baseline-vs-candidate savings or human-reviewed code quality.

For a same-task upstream comparison, build the requested v0.26.8 commit in a
separate checkout and set `QWEN_EVALUATION_BASELINE_CLI` to its `dist/cli.js`
path before running the integration test. The test then runs both CLIs against
the same fixed fake-provider responses in isolated project directories. This
is a behavioral smoke comparison; synthetic usage is equal by construction.
This was verified against upstream commit
`21ed8f1efbb351b973d96e2bc9efa78f278df99c` and the local fork: both created the
expected file and each consumed 400 input, 42 output, and 80 cached mock tokens
in 3 requests.

Set `QWEN_EVALUATION_RUNS_DIR` to save schema-v1 synthetic records for the
baseline and candidate. The test writes `upstream-baseline.json` and
`engineering-edition.json`; pass those files to `evaluation/compare.mjs` for a
structured report. Unobserved retries, reasoning, subagent/compaction usage,
and cost remain unknown (`null`).

## Offline ten-category benchmark

`integration-tests/engineering-benchmark.test.ts` runs all ten categories
through the bundled CLI against a local fake OpenAI-compatible server:

| Category                      |
| ----------------------------- |
| Simple bug fix                |
| Normal feature implementation |
| Multi-file feature            |
| Complex debugging             |
| Architectural refactoring     |
| Unit-test implementation      |
| Security review               |
| Large repository exploration  |
| Long-session compaction       |
| Interrupted-session recovery  |

Run it after building and bundling:

```bash
npm run build && npm run bundle
QWEN_SANDBOX=false npx vitest run --root ./integration-tests engineering-benchmark.test.ts
```

Each case checks task completion, test outcome, and regression defects
independently of token counts. The long-session case forces compaction with a
40,000-token context window; the recovery case records a session and resumes it
with `--continue`. Fixtures live inside this `"type": "module"` repository, so
the test pins them to CommonJS.

Set `QWEN_EVALUATION_BASELINE_CLI` to another `dist/cli.js` to run the same
cases against a baseline checkout, and `QWEN_EVALUATION_RUNS_DIR` to save
schema-v1 records for `evaluation/compare.mjs`.

Current local result: 10/10 cases passed on this fork and 10/10 on upstream
v0.26.8 (20/20 total). Both CLIs recorded the same scripted totals: 68,781
input, 2,558 output, 17,189 cached, 54 requests, 40 tool calls, and 6
compaction requests, with zero regression defects. Because both CLIs receive
the same scripted fake responses, equal usage is an execution and schema check,
not evidence of token savings. Human review remains pending.

The comparator does not collect live provider telemetry, price tokens, or
establish code quality. No live endpoint was contacted. A measured
baseline-vs-candidate engineering benchmark remains pending.
