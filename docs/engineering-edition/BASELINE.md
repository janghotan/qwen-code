# Engineering Edition Baseline

- Repository: `/home/tan/Projects/qwen-code`; remote `origin` points to the public fork `janghotan/qwen-code` (URL contains no embedded credentials).
- Branch/revision: `main`, `1ecf44401`; tracked files were clean at inspection. An untracked `docs/engineering-edition/` directory pre-existed this work and was preserved.
- Package version and toolchain declaration: `0.26.8`, Node `>=22`, pnpm `11.24.0`.
- Requested upstream baseline `21ed8f1efbb351b973d96e2bc9efa78f278df99c` was fetched into an isolated temporary clone at `/tmp/qwen-upstream-baseline` and built successfully as v0.26.8. The checkout's `origin` still tracks the public fork; no `upstream` remote was added and local history was not rewritten.
- Build/test status at initial inspection: not run; dependencies/build artifact availability had not yet been established. Later build and test evidence is recorded in `IMPLEMENTATION-STATUS.md`.
- Existing source already includes deferred tool search, output sizing/truncation/recovery, chat compression, context usage telemetry, Gemini cache provenance, reasoning token convention handling, and workflow token budgets.
- Fork workflow risk: many workflows are upstream-specific, including self-hosted runner routing and secret-backed release/automation. This work will not enable or run them. Review any workflow-specific change separately.
- Rollback: revert only this task's isolated commits/diff; no history rewrite, force push, publishing, or remote operations are planned.
