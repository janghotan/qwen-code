# Engineering Edition Quality Standards

- Correctness, interfaces, security, and maintainability outrank token reduction. No speculative framework or duplicate runtime.
- Preserve existing fork/user changes; do not reset, clean, rewrite history, push, publish, or alter GitHub settings.
- Never call configured live model endpoints. Provider tests use local mocks.
- Report provider-reported values as reported, estimates as estimates, and unavailable values as unknown. Never double-count reasoning or infer exact tokens from characters.
- Keep tool permissions, confirmations, hooks, scheduling, and recovery semantics intact. A nonzero command exit must remain visible.
- Keep quality guidance compact and on-demand; do not add an LLM classification call for ordinary deterministic policy.
- Add focused colocated tests for behavior changes and run only relevant verification plus required build/type checks before claiming completion.
- Keep provider behavior explicit and capability-driven; unknown capability means unsupported/unknown, not presumed support.
- Every milestone records changed files, checks and outcomes, usage findings, unresolved issues, and the exact next task in `IMPLEMENTATION-STATUS.md`.
