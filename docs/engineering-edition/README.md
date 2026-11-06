# Qwen Code Engineering Edition

This checkout builds the Engineering Edition on top of the existing Qwen Code
CLI. It keeps the selected provider, authentication, and model configuration
in the user's existing Qwen Code settings.

## Requirements

- Node.js 22 or newer.
- The pnpm version declared in the root `package.json`, installed through
  Corepack.

## Install, build, and run

From the repository root:

```bash
corepack pnpm install --frozen-lockfile
npm run build
npm run bundle
node dist/cli.js
```

The CLI uses the existing Qwen Code configuration. For development, `npm run
dev` runs the CLI from TypeScript source after dependencies have been prepared.

## Optional workflow quota

The session provider-token quota is disabled unless configured. Set a positive
integer to warn at 80% and stop new optional workflow-agent dispatches and
optional `Agent` tool spawns at the limit:

```bash
QWEN_CODE_MAX_PROVIDER_TOKENS_PER_SESSION=200000 node dist/cli.js
```

This is not a spend limit. It applies to optional workflow-agent dispatches and
optional `Agent` tool spawns; it does not interrupt the primary response or
active requests. If enabled and provider-reported total usage is unavailable,
those optional requests are refused because the quota cannot be checked
accurately.

## Offline evaluation

The comparator and synthetic schema fixtures require no model credentials:

```bash
node --test evaluation/compare.test.mjs
node evaluation/compare.mjs \
  --baseline evaluation/fixtures/synthetic-baseline.json \
  --candidate evaluation/fixtures/synthetic-candidate.json
```

The local fake-provider CLI smoke test runs after building the bundle:

```bash
QWEN_SANDBOX=false npx vitest run --root ./integration-tests engineering-evaluation.test.ts
```

See [BENCHMARKS.md](BENCHMARKS.md) for the optional upstream comparison and
saved run-record instructions. The checked-in evaluation does not contact a
configured live model endpoint.

## Implementation status

See [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for verified work and
remaining scope, [ARCHITECTURE.md](ARCHITECTURE.md) for the existing extension
points, and [ROADMAP.md](ROADMAP.md) for the project ledger.
