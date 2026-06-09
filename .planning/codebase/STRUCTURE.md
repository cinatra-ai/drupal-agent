# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
drupal-agent/
├── cinatra/
│   └── oas.json            # Cinatra Flow definition (agent graph, nodes, I/O schema)
├── skills/
│   └── drupal-agent/
│       └── SKILL.md        # LLM behavioral spec (steps, rules, output contract)
├── .github/
│   └── workflows/
│       ├── ci.yml          # CI: runs extension-kind-gate
│       └── release.yml     # Release pipeline
├── extension-kind-gate.mjs # Self-contained CI validation gate (zero npm deps)
├── package.json            # npm manifest with cinatra.kind:"agent" metadata
├── tsconfig.json           # TypeScript config (for gate authoring toolchain only)
├── .npmrc                  # npm registry configuration
├── AGENTS.md               # A2A input/output contract documentation for LLM agents
├── README.md               # Human-facing product description
└── LICENSE                 # Apache-2.0
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Cinatra platform artifacts — the agent's flow definition consumed by the Flow Engine.
- Contains: `oas.json` — the authoritative OAS/Flow JSON (nodes, control-flow edges, data-flow edges, node component definitions).
- Key files: `cinatra/oas.json`

**`skills/drupal-agent/`:**
- Purpose: LLM skill definitions loaded by the LLM bridge at inference time.
- Contains: `SKILL.md` — step-by-step behavioral instructions, prohibited actions, output shape.
- Key files: `skills/drupal-agent/SKILL.md`

**`.github/workflows/`:**
- Purpose: GitHub Actions CI and release automation.
- Contains: `ci.yml` (runs `extension-kind-gate.mjs`), `release.yml` (publish pipeline).
- Key files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

## Key File Locations

**Entry Points:**
- `cinatra/oas.json`: Flow entry point — `start` StartNode defines the agent's public input contract.
- `extension-kind-gate.mjs`: CI entry point — `main()` function, invoked as `node extension-kind-gate.mjs --package-root .`.

**Configuration:**
- `package.json`: Package identity, version, license, and `cinatra` metadata block (`kind`, `apiVersion`, `dependencies`).
- `tsconfig.json`: TypeScript compiler configuration (applies to `extension-kind-gate.mjs` authoring, not a compiled artifact).
- `.npmrc`: npm registry authentication settings.

**Core Logic:**
- `cinatra/oas.json`: Defines the 4-node flow graph, data-flow wiring, LLM prompt templates, and output rendering.
- `skills/drupal-agent/SKILL.md`: Defines all agent behavioral rules enforced at LLM inference time.
- `extension-kind-gate.mjs`: Contains `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate` — the full CI gate surface.

**Documentation:**
- `AGENTS.md`: A2A contract reference — input JSON shape, output JSON shape, WayFlow task.history retrieval note. Read by LLM coding agents working on the integration layer.
- `README.md`: End-user capability summary.

## Naming Conventions

**Files:**
- Cinatra platform artifacts use lowercase with hyphens: `oas.json`, `workflow.bpmn`.
- Skills use `SKILL.md` (uppercase, no prefix).
- The gate script uses kebab-case with `.mjs` extension: `extension-kind-gate.mjs`.
- GitHub Actions workflows use lowercase kebab: `ci.yml`, `release.yml`.

**Directories:**
- Platform artifact directory: `cinatra/` (fixed name, required by Cinatra toolchain).
- Skill directories: `skills/<agent-name>/` — matches the `agent_id` used in `cinatra/oas.json`.
- No `src/` directory — this repo contains no compiled application code.

**Identifiers in OAS:**
- Flow id: `drupal-content-editor-flow` (kebab, `-flow` suffix).
- Node ids: lowercase kebab (`start`, `load_node`, `emit_output`, `end`).
- Input/output titles: camelCase strings (`instanceId`, `nodeId`, `nodeBundle`, `nodeStatus`).

## Where to Add New Code

**New MCP tool call (additional Drupal operation):**
- Update behavioral rules: `skills/drupal-agent/SKILL.md` — add step and prohibition.
- No flow graph change needed unless a new node or output is required.

**New flow output field:**
- Add to `outputs[]` in `cinatra/oas.json` top-level and in `$referenced_components.end.outputs`.
- Add a new DataFlowEdge from `load_node` to `end` for the new field.
- Update `emit_output` Jinja2 `message` template string to include the new field.

**New agent entirely:**
- Create `skills/<new-agent-name>/SKILL.md` with behavioral spec.
- Create `cinatra/oas.json` with the new flow definition (or add a separate repo following this repo's layout).
- Register `cinatra.kind: "agent"` in `package.json`.

**CI gate rule additions (banned primitives):**
- Edit `BANNED_PRIMITIVES` or `BANNED_TYPEHINTS` arrays in `extension-kind-gate.mjs`.
- Keep in sync with the monorepo `scripts/audit/oas-banned-primitives-gate.mjs` (noted in gate file header).

## Special Directories

**`.planning/`:**
- Purpose: GSD planning artifacts — codebase maps, phase plans.
- Generated: By GSD tooling.
- Committed: Yes (planning artifacts are version-controlled).

**`.github/`:**
- Purpose: GitHub Actions workflow definitions.
- Generated: No.
- Committed: Yes.

---

*Structure analysis: 2026-06-09*
