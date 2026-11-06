---
name: test-engineering
description: Add, repair, or assess tests that pin real behavior and fail when the behavior regresses.
paths:
  - '**/*.{test,spec}.{ts,tsx,js,jsx,py,go,rs,java,kt}'
  - '**/__tests__/**'
  - '**/test/**'
  - '**/tests/**'
  - '**/testing/**'
---

# Test engineering

1. Find the existing test layer and harness for the module before writing a new one. Use its fixtures, helpers, and naming.
2. Test observable behavior and contracts, not private implementation. One behavior per case; name the condition and expected result.
3. Cover the boundary that can regress: empty and malformed input, the error path, ordering, and persistence if relevant. Skip cases that cannot fail.
4. Assert structurally where possible. A test that only checks that a string is present often survives the bug it claims to catch.
5. Prove the test: run it, break the behavior, watch it fail, restore, watch it pass. Never report a green test you did not see fail first.
6. Run the focused file, then the package suite for related modules. Fix flakiness at its source; do not add sleeps or retries.
