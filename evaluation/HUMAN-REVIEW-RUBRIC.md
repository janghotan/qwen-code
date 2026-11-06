# Human Review Rubric for Engineering Quality Evaluation

This document defines the standardized human review protocol and rubric for evaluating coding outputs between upstream Qwen Code and Qwen Code Engineering Edition across the 8 engineering quality dimensions.

## Purpose and Scope

Deterministic scripted benchmarks and offline unit test passes verify harness execution and schema compatibility; they **do not prove** superior real-world code quality or token savings. When live model evaluations are eventually conducted, human reviewers must independently evaluate the generated code diffs against this rubric.

## Eight Engineering Quality Dimensions

Each task under evaluation is evaluated across eight dimensions:

| Dimension                       | Evaluation Criteria                                                                                                                    | Pass Threshold                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **1. Bug-Fix Correctness**      | Addresses the root cause rather than patching symptoms; preserves existing intended behavior; passes regression tests.                 | Root cause solved; 0 regression defects.            |
| **2. Feature Completeness**     | Implements all requested requirements in the task specification; handles edge cases and boundary conditions.                           | All acceptance criteria satisfied.                  |
| **3. Multi-File Consistency**   | Updates type definitions, implementations, exports, and call-sites consistently across all affected files without orphaned references. | Zero broken imports or type mismatches.             |
| **4. Root-Cause Debugging**     | Investigates failures through systematic inspection; isolates minimal failing reproductions; avoids speculative trial-and-error edits. | Minimal, targeted edit solving underlying flaw.     |
| **5. Test Quality**             | Collocates unit and integration tests; asserts meaningful behavior rather than trivial mock returns; covers edge cases.                | High-signal assertions; no brittle or hollow tests. |
| **6. Refactoring Safety**       | Preserves public APIs and backward compatibility; maintains encapsulation; reduces complexity without behavioral change.               | All existing tests pass; no breaking API change.    |
| **7. Security Issue Detection** | Avoids command injection, path traversal, unchecked deserialization, credential leakage, and unsafe shell interpolations.              | Zero introduced vulnerabilities.                    |
| **8. Maintainability**          | Minimal code that solves the problem (Simplicity First); conforms to repository style; zero speculative abstractions or dead switches. | Senior engineer review approval.                    |

## Review Outcome States

In accordance with schema v1 (`evaluation/compare.mjs`), each run receives one of three standardized states:

- `approved`: All criteria pass with 0 regressions and high maintainability.
- `needs_changes`: Functional defect, regression, security risk, or overcomplicated code.
- `pending`: Awaiting human reviewer evaluation.

## Human Review Template

When reviewing a run pair (baseline vs. candidate), copy this template into the evaluation record or pull request review:

```markdown
### Engineering Review: [caseId] (Sample: [sampleId])

- Evaluator: [Reviewer Name / GitHub Handle]
- Date: [YYYY-MM-DD]
- Candidate Diff: [link or commit]
- Baseline Diff: [link or commit]

#### Dimensional Assessment

1. Bug-Fix Correctness: [Pass / Fail / N/A] - Notes: ...
2. Feature Completeness: [Pass / Fail / N/A] - Notes: ...
3. Multi-File Consistency: [Pass / Fail / N/A] - Notes: ...
4. Root-Cause Debugging: [Pass / Fail / N/A] - Notes: ...
5. Test Quality: [Pass / Fail / N/A] - Notes: ...
6. Refactoring Safety: [Pass / Fail / N/A] - Notes: ...
7. Security Issue Detection: [Pass / Fail / N/A] - Notes: ...
8. Maintainability: [Pass / Fail / N/A] - Notes: ...

#### Outcome

- Human Review Decision: [approved | needs_changes]
- Justification: [Concise rationale comparing baseline and candidate approaches]
```
