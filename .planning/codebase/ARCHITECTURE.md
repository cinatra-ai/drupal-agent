<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                     External Caller                             │
│  chat/route.ts (A2A blocking dispatch)                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ A2A user message (JSON-stringified inputs)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cinatra Flow Engine                           │
│               `cinatra/oas.json` — Flow definition              │
│                                                                 │
│  StartNode (Inputs)                                             │
│    → ApiNode "load_node" (POST /api/llm-bridge)                 │
│    → OutputMessageNode "emit_output"                            │
│    → EndNode (Outputs)                                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │ LLM call with skill + tools
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│               LLM Bridge + Drupal MCP Server                    │
│  drupal_node_get / drupal_node_create_draft_revision /          │
│  drupal_node_update / drupal_node_publish                       │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Flow definition (OAS) | Declares the full agent flow: inputs, nodes, edges, outputs | `cinatra/oas.json` |
| StartNode "Inputs" | Receives instanceId, nodeId, nodeBundle, nodeStatus, instructions | `cinatra/oas.json` (`$referenced_components.start`) |
| ApiNode "load_node" | POSTs to `/api/llm-bridge`; drives LLM with system+user prompt + drupal-content-editor agent_id | `cinatra/oas.json` (`$referenced_components.load_node`) |
| OutputMessageNode "emit_output" | Renders JSON diff as the agent's final assistant message using Jinja2 template | `cinatra/oas.json` (`$referenced_components.emit_output`) |
| EndNode "Outputs" | Exposes nodeId and changes[] as typed flow outputs | `cinatra/oas.json` (`$referenced_components.end`) |
| Skill (SKILL.md) | LLM behavioral rules: read-before-write, draft-before-publish, field-scoping, diff shape | `skills/drupal-agent/SKILL.md` |
| CI gate | Validates agent OAS parses and contains no retired CRM primitives in LLM-visible fields | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** Cinatra Flow (WayFlow node-type leaf agent) — declarative LLM pipeline defined as a JSON OAS graph.

**Key Characteristics:**
- The agent is a single-node LLM call wrapped in a 4-node control-flow graph (start → load_node → emit_output → end).
- Behavioral logic lives in `SKILL.md` (loaded by the LLM bridge at runtime), not in imperative code.
- All Drupal interaction is via named MCP tool calls (`drupal_*`) invoked by the LLM during the `load_node` step.
- The draft-revision safety guard (never edit a published node directly) is enforced by SKILL.md rules, not application code.
- Outputs are a structured JSON diff (`{ nodeId, instanceId, changes[] }`), not prose.

## Layers

**Flow Layer:**
- Purpose: Declares the agent's execution graph, input/output schema, and LLM prompt templates.
- Location: `cinatra/oas.json`
- Contains: StartNode, ApiNode (LLM call), OutputMessageNode (message renderer), EndNode.
- Depends on: Cinatra Flow Engine (runtime), `/api/llm-bridge` endpoint.
- Used by: Cinatra marketplace / A2A caller.

**Skill Layer:**
- Purpose: LLM-readable behavioral specification — step-by-step instructions, prohibited actions, and output shape contract.
- Location: `skills/drupal-agent/SKILL.md`
- Contains: Ordered steps, "what to NEVER do" rules, output JSON schema, MCP tool call sequence.
- Depends on: Nothing at build time; loaded by LLM bridge at inference time.
- Used by: `load_node` ApiNode (referenced via `agent_id: "drupal-content-editor"`).

**Gate Layer:**
- Purpose: Self-contained CI sanity gate for the extracted repo; validates OAS structure and bans retired CRM primitives from LLM-visible prompt strings.
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`.
- Depends on: Node.js builtins only (zero npm dependencies by design — runs unauthenticated in public CI).
- Used by: `.github/workflows/ci.yml`.

## Data Flow

### Primary Request Path

1. External caller sends A2A user message (JSON-stringified `{ instanceId, nodeId, nodeBundle, nodeStatus, instructions }`) → `cinatra/oas.json` StartNode.
2. Control flows to `load_node` ApiNode — POSTs to `/api/llm-bridge` with system prompt, user prompt (template-interpolated inputs), and `agent_id: "drupal-content-editor"` (`cinatra/oas.json` `$referenced_components.load_node`).
3. LLM bridge resolves `drupal-content-editor` agent → loads `skills/drupal-agent/SKILL.md` for behavioral rules.
4. LLM calls `drupal_node_get(instanceId, nodeId)` to read current field values.
5. If `nodeStatus === "published"`: LLM calls `drupal_node_create_draft_revision(instanceId, nodeId)` before any write.
6. LLM calls `drupal_node_update(instanceId, nodeId, fields)` with only explicitly changed fields.
7. LLM emits final assistant message as JSON `{ nodeId, instanceId, changes[] }` → `load_node` outputs `nodeId` and `changes`.
8. `emit_output` OutputMessageNode renders the JSON message via Jinja2 template.
9. `end` EndNode exposes `nodeId` (string) and `changes` (array of objects) as flow outputs.
10. A2A caller reads `task.history` (final assistant message text), JSON-parses it to extract `nodeId` and `changes`.

### CI Gate Path

1. `.github/workflows/ci.yml` runs `node extension-kind-gate.mjs --package-root .` (`extension-kind-gate.mjs` `main()`).
2. `runGate` reads `package.json`, detects `cinatra.kind === "agent"`, delegates to `validateAgent`.
3. `validateAgent` reads `cinatra/oas.json`, walks all LLM-visible fields (`system`, `user`, `description`), scans for banned primitive tokens and legacy type hints.
4. Exits 0 on pass, 1 with violation details on failure.

**State Management:**
- No persistent state within the agent. All state is Drupal-side (nodes, revisions). Draft revision creation is the only stateful side-effect, and it is idempotent (creating a draft on an already-draft node is a no-op per SKILL.md step 2).

## Key Abstractions

**MCP Tool Calls (`drupal_*`):**
- Purpose: Named primitives the LLM invokes to read and write Drupal content.
- Tools used: `drupal_node_get`, `drupal_node_create_draft_revision`, `drupal_node_update`, `drupal_node_publish`.
- Pattern: All calls require `instanceId` (which Drupal site) + `nodeId`. The LLM never invents field names — it uses only fields returned by `drupal_node_get`.

**Structured Diff Output (`changes[]`):**
- Purpose: Field-by-field before/after record consumed by the calling widget to render diff highlights.
- Shape: `{ "field": "...", "before": "...", "after": "..." }` per changed field.
- Only explicitly user-requested fields appear — omitting unchanged fields is a hard rule.

**Draft Revision Guard:**
- Purpose: Protects the live frontend by parking edits on an unpublished revision before writing.
- Trigger: `nodeStatus === "published"` on the input context.
- Enforcement: SKILL.md rule 2 (behavioral, not code-level).

## Entry Points

**Flow Entry:**
- Location: `cinatra/oas.json` `start` StartNode
- Triggers: A2A dispatch from external caller (e.g., `/api/drupal-widget/chat/route.ts`)
- Responsibilities: Validates and forwards `instanceId`, `nodeId`, `nodeBundle`, `nodeStatus`, `instructions` to the `load_node` ApiNode.

**CI Entry:**
- Location: `extension-kind-gate.mjs` `main()`
- Triggers: `node extension-kind-gate.mjs --package-root .` in CI
- Responsibilities: Reads `package.json`, routes to `validateAgent`, validates `cinatra/oas.json`.

## Architectural Constraints

- **No application code:** All agent logic is declarative (OAS JSON + SKILL.md). There is no TypeScript src/ or compiled bundle.
- **Zero-dependency gate:** `extension-kind-gate.mjs` uses only Node.js builtins — no npm install required in public CI.
- **LLM model:** `load_node` specifies `preferredProvider: "openai"`, `preferredModel: "gpt-5.5"` — runtime falls back to Cinatra defaults if unavailable.
- **Output channel:** A2A caller reads from `task.history` (final assistant message text), not `task.artifacts` — `task.artifacts` is not implemented in WayFlow.
- **Field scoping:** Passing an empty string `""` for an unchanged field may silently clear it — only explicitly changed fields must appear in `drupal_node_update`.
- **Global state:** None. No module-level singletons.
- **Circular imports:** Not applicable (single `.mjs` gate file; no import graph).

## Anti-Patterns

### Editing a published node without creating a draft first

**What happens:** Caller passes `nodeStatus: "published"` and LLM calls `drupal_node_update` directly.
**Why it's wrong:** Overwrites the live revision, exposing mid-edit content to the public frontend immediately.
**Do this instead:** Call `drupal_node_create_draft_revision(instanceId, nodeId)` before any `drupal_node_update` when `nodeStatus === "published"` (`skills/drupal-agent/SKILL.md` step 2).

### Including unchanged fields in `drupal_node_update`

**What happens:** LLM passes all fields (including ones the user did not mention) with empty strings or original values.
**Why it's wrong:** Passing `""` may clear existing field values; passing original values creates spurious diff entries.
**Do this instead:** Include only fields the user explicitly asked to change in the `fields` object (`skills/drupal-agent/SKILL.md` rule 3).

### Reading outputs from `task.artifacts`

**What happens:** A2A caller attempts to read `task.artifacts` instead of `task.history`.
**Why it's wrong:** `task.artifacts` is not implemented in WayFlow — the diff JSON is in the final assistant message in `task.history`.
**Do this instead:** JSON-parse the last assistant message from `task.history` (`AGENTS.md` A2A output contract).

## Error Handling

**Strategy:** Not implemented at the flow level. Error handling is delegated to the LLM (which will not emit a changes array on failure) and the calling layer (which must handle parse errors on `task.history`).

**Patterns:**
- CI gate returns non-zero exit code with human-readable violation list on validation failure.
- SKILL.md prohibits calling `drupal_node_publish` unless the user explicitly requests it — implicit publish is the primary guarded error.

## Cross-Cutting Concerns

**Logging:** Not applicable — no application server. CI gate logs to stdout/stderr.
**Validation:** `extension-kind-gate.mjs` performs pre-publish OAS structural validation and banned-primitive scanning.
**Authentication:** `instanceId` routes the LLM's MCP calls to the correct authenticated Drupal site connection — authentication is managed by the MCP server, not the agent.

---

*Architecture analysis: 2026-06-09*
