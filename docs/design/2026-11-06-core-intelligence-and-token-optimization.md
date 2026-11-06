# Core Intelligence and Token Optimization

[中文版](2026-11-06-core-intelligence-and-token-optimization.zh-CN.md)

## Context

As multi-turn software engineering tasks progress, models frequently accumulate redundant context, duplicate search queries, and repetitive file reads. Furthermore, standard context compaction summaries often drop essential engineering state—such as architectural invariants, symbol diff anchors, and root-cause hypotheses—causing hallucinations or regression errors in long-running sessions. When test commands or compiler outputs exceed preview limits, critical stack traces and failure diagnostics in the middle of the output were previously dropped, depriving the model of necessary debugging clues.

## Decision

1. **Context Compaction Engineering State Preservation (`prompts.ts`)**:
   Enriched `getCompressionPrompt()` with explicit, high-priority preservation requirements for:
   - Architectural invariants and critical constraints.
   - Exact relative paths of all modified files.
   - Symbol diff anchors and line-level changes.
   - Active diff summaries across all modified workspaces.
   - Root-cause conclusions versus disproven hypotheses.
   - Pending verification commands and unresolved test failures.

2. **Intelligent File Range-Read & Deduplication (`fileReadCache.ts`, `read-file.ts`)**:
   Extended `FileReadCache` to track `FileRange` (`startLine` to `endLine`) and monotonic `writeGeneration`. When consecutive identical ranged reads are requested on an unchanged file, `read-file` short-circuits with an `unchangedRangeResult` placeholder, eliminating redundant token consumption while preserving the invariant that partial reads never re-arm full-file placeholder authority (`readResidentInHistory`).

3. **Diagnostic-Aware Output Truncation (`truncation.ts`)**:
   Introduced diagnostic pattern extraction (`DIAGNOSTIC_PATTERNS`) covering unit test runners (vitest, jest, mocha, pytest), language compilers (TypeScript, Rust, Go), and runtime exceptions. When tool output exceeds the preview budget and middle lines are omitted, extracted diagnostic failure lines are preserved inside the separator (`[Key Diagnostic Excerpts from Truncated Output]`) within safety bounds.

4. **Idempotent Search Memoization (`grep.ts`, `glob.ts`)**:
   Added LRU-bounded search caches for `GrepTool` and `GlobTool` keyed by query parameters and tied to `fileReadCache.getWriteGeneration()`. Repeated exploration calls during unchanged workspace states resolve instantly from memory with zero disk I/O, subprocess spawns, or redundant downstream processing.

## Consumers and boundaries

- `FileReadCache` provides monotonic `writeGeneration` mutated by `recordWrite`, `invalidate`, `invalidateByPath`, and `clear`.
- `ReadFileTool` consumes `fileReadCache.getLastReadRange()` and `fileReadCache.recordRead()`.
- `TruncationService` (`truncateText`, `truncateSharedOutput`) consumes `extractDiagnosticLines()`.
- `GrepTool` and `GlobTool` consume `fileReadCache.getWriteGeneration()`.
- Neither the user-facing CLI behavior nor the model's reasoning effort is reduced; optimization occurs at the execution workflow and context hygiene layer.

## Limitations

- Ranged read deduplication requires matching `startLine` and `endLine`; intersecting or sub-range reads are still read fresh to guarantee exact context.
- Diagnostic extraction respects `previewBudget`; if the budget is severely constrained (< 1/3 available), diagnostics gracefully yield to standard compact separators.
- Search memoization clears completely on any workspace file modification, preventing stale cache hits.

## Verification

- Added regression tests in `prompts.test.ts`, `fileReadCache.test.ts`, `read-file.test.ts`, `truncation.test.ts`, `grep.test.ts`, and `glob.test.ts`.
- Verified typechecking across all packages (`npm run typecheck`).
- Executed offline ten-category engineering benchmark with 10/10 categories passing.
