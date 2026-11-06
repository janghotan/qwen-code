---
name: performance-engineering
description: Measure a performance problem before changing code, then optimize the proven bottleneck.
paths:
  - '**/perf/**'
  - '**/bench/**'
  - '**/benchmarks/**'
  - '**/*.{bench,perf}.{ts,tsx,js,jsx,py,go,rs,java}'
  - '**/*.sql'
---

# Performance engineering

1. Define the metric and workload: latency, throughput, memory, or cost, with a representative input size. Without a measurement, there is no bottleneck.
2. Measure before editing. Keep the command and environment in the report so the result can be reproduced.
3. Profile or instrument the suspected path. Optimize the largest measured contributor, not the most visible code.
4. Prefer fewer allocations, fewer round trips, and existing caches over new machinery. Never trade correctness or unbounded memory for speed.
5. Re-measure with the same workload and report the delta with variance. If the change does not move the metric, revert it.
6. Add a focused regression check for the invariant you optimized, and run the correctness suite.
