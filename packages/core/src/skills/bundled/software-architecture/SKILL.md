---
name: software-architecture
description: Evaluate system boundaries, dependencies, and design trade-offs before a structural change.
paths:
  - 'docs/**'
  - '**/ARCHITECTURE.md'
  - '**/ADR/**'
  - '**/package.json'
  - '**/Cargo.toml'
  - '**/go.mod'
  - '**/pom.xml'
  - '**/build.gradle*'
  - '**/pyproject.toml'
---

# Software architecture

Use for changes that cross module, package, process, or persistence boundaries.

1. Map the boundary: who calls whom, what data crosses it, and which side owns validation and failure handling. Name the downstream consumers of anything you change.
2. Read the current design and adjacent implementations before proposing a new layer. Prefer extending an existing seam to adding a parallel one.
3. State the trade-off in one sentence each: coupling, migration cost, compatibility, and operational risk. Prefer the smallest reversible step.
4. Preserve public contracts and persisted formats, or provide an explicit migration. Never break a consumer silently.
5. Record consequential decisions where this repository keeps design docs. Keep the record short: context, decision, consequences.
6. Verify the build and the boundary-level tests, not only the leaf that changed.
