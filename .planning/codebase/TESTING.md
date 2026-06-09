# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:** Not configured in this repo directly. The CI pipeline runs `corepack pnpm test --if-present` for standalone repos; this repo is classified as a "source mirror" (host-internal `@cinatra-ai/*` optional peers) so standalone tests are skipped — the cinatra monorepo runs tests instead.

**Test config files:** None present (`jest.config.*`, `vitest.config.*` not detected).

**Test files:** None present in this repo.

**Run Commands:**
```bash
# Standalone CI gate (the only runnable check in this repo):
node extension-kind-gate.mjs --package-root .

# Full test suite (runs in the cinatra monorepo, not here):
# (monorepo owns install + typecheck + test for source mirrors)
```

## CI Validation Gates

Although there are no unit test files, the repo enforces correctness through the `extension-kind-gate.mjs` CI gate, run in `.github/workflows/ci.yml` under the `kind-gates` job.

**What the gate checks for `kind: "agent"`:**
- `cinatra/oas.json` parses as valid JSON
- No retired CRM primitives (`lists_*`, `accounts_*`, `contacts_*`) appear in LLM-visible OAS fields (`system`, `user`, `description`)
- No banned entity typeHints (`@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`)
- No `objects_list` over CRM entity types

**Gate is self-contained:** Zero dependencies — only Node built-ins. Runs unauthenticated, before the `@cinatra-ai` registry is reachable.

## Test File Organization

Not applicable — no test files exist in this repo. Tests for the agent's behavior live in the cinatra monorepo.

## Testable Units in `extension-kind-gate.mjs`

The gate exports pure functions designed for unit testing (though tests are not co-located here):

| Export | What it validates |
|--------|------------------|
| `parseArgs(argv)` | CLI argument parsing |
| `validateAgent(packageRoot)` | OAS retired-primitive scan |
| `validateWorkflowPackageShape(pkg)` | workflow package.json shape |
| `validateBpmnSanity(xml)` | BPMN XML well-formedness + shape |
| `findWorkflowSidecars(packageRoot)` | Locates `cinatra/workflow.bpmn` files |
| `validateWorkflow(packageRoot)` | Full workflow extension validation |
| `runGate(packageRoot)` | Top-level dispatch by `cinatra.kind` |

All validators are pure (string[] return, no side effects) except file-system reads in `validateAgent`, `validateWorkflow`, and `findWorkflowSidecars`.

## Mocking

Not applicable in this repo. In the monorepo, file-system validators would be tested by providing a `packageRoot` pointing to fixture directories (temp dirs with crafted `package.json` / `cinatra/oas.json` / `cinatra/workflow.bpmn` files).

## Coverage

**Requirements:** None enforced at the extracted-repo level. Coverage is enforced in the cinatra monorepo.

## Test Types

**Unit Tests:** Not present in this repo — owned by the cinatra monorepo.

**Integration Tests:** Not present — agent behavior (MCP tool calls, draft revision workflow) is tested in the monorepo against a live or mocked Drupal MCP server.

**E2E Tests:** Not applicable at this repo level.

**CI Pack Dry-Run:** `npm pack --dry-run` runs in CI (`build` job) to validate package shape and publish payload without registry access. This is the closest thing to a structural test in this repo.

## Structural Validation (Substitute for Tests)

For a content-only agent repo, "correctness" is validated through:

1. **`extension-kind-gate.mjs --package-root .`** — scans `cinatra/oas.json` for banned primitives (CI `kind-gates` job, `extension-kind-gate.mjs`)
2. **`npm pack --dry-run`** — validates package shape (CI `build` job, `.github/workflows/ci.yml`)
3. **First-party dep shape check** — inline Node script in CI ensures no `@cinatra-ai/*` packages leaked into `dependencies`/`devDependencies` (`.github/workflows/ci.yml` lines 48–69)
4. **SKILL.md prompt rules** — the `## What to NEVER do` section in `skills/drupal-agent/SKILL.md` encodes behavioral invariants (never edit published nodes without draft revision, never invent field names, etc.)

---

*Testing analysis: 2026-06-09*
