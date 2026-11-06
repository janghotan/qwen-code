---
name: engineering-implementation
description: Implement or change code in an existing repository with minimal, maintainable edits and real verification.
paths:
  - '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,cs,cpp,c,h}'
---

# Engineering implementation

Match the repository before writing code.

1. Read the target file, its callers, and one nearby pattern that solves a similar problem. Reuse existing helpers and style; do not introduce a framework or abstraction for one use.
2. Confirm the requirement and the smallest complete change. State what is in scope and what is not. Do not refactor unrelated code.
3. Prefer typed, explicit code. Handle real failure paths; do not add guards for impossible states.
4. Add or update the collocated test that would fail without the change.
5. Run the narrowest relevant test, type-check, and lint for the touched package. Read failures rather than suppressing them.
6. Review the diff for accidental files, debug output, and behavior changes you cannot explain.

Report what changed, what you ran, and what remains unverified. Never claim a check passed that you did not run.
