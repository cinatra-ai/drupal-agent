# Coding Conventions

**Analysis Date:** 2026-06-09

## Repository Type

This is a content-only Cinatra extension repo (kind: `agent`). It ships no TypeScript `src/` — the agent logic lives entirely in declarative files: `skills/drupal-agent/SKILL.md` (LLM prompt/rules), `cinatra/oas.json` (OAS surface), and `AGENTS.md` (A2A contract). The one executable file is `extension-kind-gate.mjs`, a self-contained CI gate tool.

## Naming Patterns

**Files:**
- SKILL.md, AGENTS.md, README.md — uppercase for documentation files
- `extension-kind-gate.mjs` — kebab-case for standalone scripts
- `cinatra/oas.json` — fixed by platform convention
- `package.json`, `tsconfig.json` — standard Node.js naming

**Functions (in `extension-kind-gate.mjs`):**
- camelCase: `parseArgs`, `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`, `walkLlmStrings`, `scanOasString`, `wordBoundary`
- Private helpers are module-level unexported functions; public API is named exports

**Variables:**
- camelCase for locals: `packageRoot`, `oasPath`, `bpmnPrefixes`, `allSidecars`
- SCREAMING_SNAKE_CASE for module-level constants: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`

**Types:**
- No TypeScript types in this repo — `extension-kind-gate.mjs` is plain ESM JavaScript. The `tsconfig.json` targets a `src/` that does not currently exist (present for scaffold completeness).

## Code Style

**Formatting:**
- No Prettier or ESLint config detected in repo root. `extension-kind-gate.mjs` uses 2-space indentation consistently.
- Strings use double-quotes in Node builtins imports, template literals for interpolation.

**Linting:**
- Not configured — no `.eslintrc*` or `biome.json` present.

## Module Design

**Module system:** ESM (`"type": "module"` in `package.json`)

**Exports:** Named exports from `extension-kind-gate.mjs` (`parseArgs`, `validateAgent`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`, `validateWorkflow`, `runGate`). The `main()` function is not exported — it runs only when the file is invoked directly (guarded by `invokedDirectly` check).

**Zero-dependency constraint:** `extension-kind-gate.mjs` MUST import only Node built-ins (`node:fs`, `node:path`). No `@cinatra-ai/*` imports, no `pnpm dlx` — required so CI can run unauthenticated before the registry is reachable.

**Barrel files:** Not applicable (no `src/` directory).

## Import Organization

`extension-kind-gate.mjs` uses only Node built-in imports at the top:

```javascript
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename, dirname, relative } from "node:path";
```

Use `node:` protocol prefix for all built-in imports.

## Error Handling

**Pattern in `extension-kind-gate.mjs`:** Pure functions return `string[]` errors — callers accumulate errors from sub-validators and the outermost `runGate` returns `{ kind, errors }`. This allows multiple violations to surface in a single CI run rather than failing on the first error.

**IO errors** (file reads) use try/catch and push a descriptive string to `errors[]`, then return early. Never throw from validator functions.

**Process exit:** Only `main()` calls `process.exit()` — validators are pure and testable.

**Example pattern:**
```javascript
export function validateAgent(packageRoot) {
  const errors = [];
  // ... check preconditions, push strings on failure
  return errors;
}
```

## Prompt/Content Conventions

**SKILL.md format (`skills/drupal-agent/SKILL.md`):**
- YAML frontmatter with `name` and `description`
- Sections: `## Rules`, `## Steps`, `## How inputs arrive`, `## What to NEVER do`
- Steps are numbered with `**STEP N — Label:**` headers
- Rules are numbered lists
- "What to NEVER do" section uses bullet list with rationale in parentheses

**AGENTS.md format:**
- Markdown with `##` sections for: Agent role, A2A input contract, A2A output contract, MCP primitives (table), Timeout, Local dev URL
- JSON code blocks for input/output contract examples
- Tables for MCP primitives

## Logging

No application logging — this is a prompt-based agent. The CI gate (`extension-kind-gate.mjs`) uses `console.log` for success and `console.error` for failures (matching stdout/stderr semantics).

## Comments

`extension-kind-gate.mjs` uses inline block comments (`// ---`) for section separators and JSDoc-style block comments on exported functions. Key design constraints (zero-dependency, why OAS is optional, etc.) are documented in comments directly above the affected code.

---

*Convention analysis: 2026-06-09*
