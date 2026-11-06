---
name: security-code-review
description: Review a change for input validation, authorization, data exposure, and unsafe execution.
paths:
  - '**/auth/**'
  - '**/security/**'
  - '**/permissions/**'
  - '**/*permission*'
  - '**/*auth*'
  - '**/*.env*'
  - '**/*.{pem,key,crt}'
  - '**/*.sql'
  - '**/.github/workflows/**'
  - '**/Dockerfile*'
  - '**/*.tf'
---

# Security and code review

Review the diff first; do not flag pre-existing code unless the change exposes it.

1. Trace every new input from its source to its sink. Check type, length, encoding, path traversal, and injection at the boundary that owns validation.
2. Verify authorization at the operation, not only at the route. Check that the caller cannot choose an identity, tenant, or scope they do not own.
3. Look for secrets, tokens, credentials, and personal data in code, logs, errors, fixtures, and generated files.
4. Check error paths: fail closed, do not leak internals, and do not leave partial state after a failure.
5. Treat shell, SQL, template, deserialization, and filesystem operations as sinks. Prefer the existing safe wrapper to escaping by hand.
6. Report only actionable findings with a concrete trigger, impact, and fix. State residual risk and what you could not verify.
