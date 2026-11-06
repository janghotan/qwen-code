---
name: root-cause-debugging
description: Reproduce a defect, trace it to its cause, and fix the cause rather than the symptom.
paths:
  - '**/*.{test,spec}.{ts,tsx,js,jsx,py,go,rs,java}'
  - '**/__tests__/**'
  - '**/test/**'
  - '**/tests/**'
  - '**/*.log'
---

# Root-cause debugging

Do not change code until the failure is reproduced or its mechanism is proven.

1. Capture the exact failing command, input, output, and environment. Reduce it to the smallest reproduction.
2. Locate the real path: follow the trace through the code that produces the bad state. Inspect values and control flow at the boundary instead of guessing.
3. Distinguish the root cause from the trigger and from incidental errors. If two explanations fit, design a check that separates them.
4. Fix the cause at the owning layer. Do not add a retry, timeout, or silent fallback that hides an unresolved defect.
5. Add a regression test that fails on the old behavior. Confirm it fails without the fix and passes with it.
6. Re-run the original reproduction and the nearest broader test suite.
