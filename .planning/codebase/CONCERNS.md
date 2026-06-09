# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Phantom `src/` directory with no source files:**
- Issue: `tsconfig.json` declares `"rootDir": "src"` and `"include": ["src/**/*.ts", "src/**/*.tsx"]` but no `src/` directory exists in the repo. The config is a stub carried over from an extraction template and has no actual TypeScript to compile.
- Files: `tsconfig.json`
- Impact: Running `tsc` will error with TS18003 ("No inputs were found") or similar. The CI workflow's typecheck step skips this via the `first_party=1` branch, masking the dead config. Any standalone typecheck attempt will fail confusingly.
- Fix approach: Either create a minimal `src/` placeholder, remove `tsconfig.json` entirely (this is a content-only extension with no TypeScript sources), or add a `noEmit: true` + empty `files: []` override.

**`extension-kind-gate.mjs` shipped inline instead of imported:**
- Issue: The gate script is a full ~390-line copy-paste self-contained file rather than a versioned shared package. Comments acknowledge it must stay "ported verbatim" in sync with the monorepo's `scripts/audit/oas-banned-primitives-gate.mjs`.
- Files: `extension-kind-gate.mjs`
- Impact: If the monorepo's banned-primitive list or BPMN validation rules change, this copy silently diverges. There is no automated mechanism to detect the drift.
- Fix approach: Once the `@cinatra-ai` registry is reachable from public CI, replace with a versioned published package; until then, add a comment pinning the monorepo commit SHA the copy was taken from so drift can be detected.

**`cinatra.dependencies` is an empty array with no enforcement:**
- Issue: `package.json` declares `"dependencies": []` under `cinatra` but this agent depends on `@cinatra-ai/drupal-connector` for all MCP primitives (`drupal_node_get`, `drupal_node_create_draft_revision`, `drupal_node_update`, `drupal_node_publish`). The dependency is documented in `AGENTS.md` ("registered by `@cinatra-ai/drupal-connector` via `src/lib/mcp-server.ts`") but not declared in the manifest.
- Files: `package.json`, `AGENTS.md`
- Impact: Marketplace install may omit the connector, leaving the agent non-functional at runtime. The CI gate does not validate that runtime MCP dependencies are declared.
- Fix approach: Add `@cinatra-ai/drupal-connector` to `cinatra.dependencies` once the schema supports it, or document that dependency resolution is handled by the host platform rather than the manifest.

**Hard-coded model preference for a non-existent model:**
- Issue: `cinatra/oas.json` pins `"preferredModel": "gpt-5.5"` in the `load_node` ApiNode. As of the analysis date this model identifier is unrecognised; it is likely a forward-looking placeholder or a typo for a current model.
- Files: `cinatra/oas.json` (line 249)
- Impact: If the LLM bridge falls back on an unknown model ID, behaviour is unpredictable — silent fallback to a different model or a hard failure depending on the bridge implementation.
- Fix approach: Set to a known stable model (e.g., `gpt-4o`) and update when the target model is actually available; or remove the pin entirely and rely on the platform default.

## Known Bugs

**OAS `emit_output` node output is not wired to `end` — redundant data flow:**
- Symptoms: `cinatra/oas.json` wires `load_node → emit_output` AND `load_node → end` for both `nodeId` and `changes`. The `emit_output` node outputs are never connected to `end`, meaning the structured output emitted by `emit_output` is orphaned in the control flow graph.
- Files: `cinatra/oas.json` (data_flow_connections section, lines 100–208)
- Trigger: Always — this is a structural issue in the OAS graph definition.
- Workaround: The caller reads from `task.history` (final assistant message text) rather than `task.artifacts`, so the missing wiring is currently papered over at the A2A protocol level.

## Security Considerations

**`nodeStatus` is caller-supplied and trusted without verification:**
- Risk: The agent branches on `nodeStatus === "published"` to decide whether to create a draft revision before editing. This value is injected by the upstream caller (`chat/route.ts`) and is not re-verified by calling `drupal_node_get` first in all cases. A caller that passes `nodeStatus: "draft"` for a node that is actually published would cause the agent to edit the live revision directly.
- Files: `skills/drupal-agent/SKILL.md`, `AGENTS.md`, `cinatra/oas.json`
- Current mitigation: `SKILL.md` Step 1 instructs the LLM to call `drupal_node_get` first and "capture the current value of every field the user might be editing." The returned node object includes `nodeStatus`, so the LLM can cross-check — but this is a convention, not an enforced code path.
- Recommendations: Add an explicit instruction in `SKILL.md` to always re-derive `nodeStatus` from the `drupal_node_get` response rather than from the injected input, or enforce this in the OAS flow graph with a conditional branch node.

**`.npmrc` exists — not read (may contain auth tokens):**
- The `.npmrc` file is present at the repo root. Its contents were not inspected. If it contains registry auth tokens it should not be committed to version control.
- Files: `.npmrc` (existence noted only)

**`requiresApproval: false` on a write-class operation:**
- Risk: The `load_node` ApiNode in the OAS declares `"riskClass": "write"` but `"requiresApproval": false`. Write operations to a live CMS that can affect published content run without any human-in-the-loop gate.
- Files: `cinatra/oas.json` (lines 291–296)
- Current mitigation: The draft-revision workflow prevents direct published-node mutation, but a misconfigured or compromised caller bypassing `nodeStatus` (see above) could trigger live edits without approval.
- Recommendations: Consider setting `requiresApproval: true` for production deployments, or at minimum documenting the trust assumption explicitly.

## Performance Bottlenecks

**10-minute A2A timeout with no progress signalling:**
- Problem: The A2A client timeout is `600_000 ms` (10 minutes). For a read → draft → update cycle this is appropriate, but there is no streaming or partial-result mechanism. The caller blocks for up to 10 minutes with no intermediate feedback.
- Files: `AGENTS.md` (Timeout section)
- Cause: WayFlow A2A blocking dispatch does not support streaming; the full cycle must complete before any response is returned.
- Improvement path: If the Drupal MCP server or WayFlow gains streaming support, wire it through. Until then, surface a loading indicator in `chat/route.ts` UI to prevent perceived hangs.

## Fragile Areas

**LLM output parsing — JSON extracted from free-form assistant message text:**
- Files: `AGENTS.md` (A2A output contract section), `cinatra/oas.json`
- Why fragile: The caller JSON-parses the final assistant message text to extract `nodeId` and `changes`. If the LLM wraps the JSON in markdown fences, adds prose commentary, or produces malformed JSON, the parse will fail silently or throw. There is no schema validation or retry logic described.
- Safe modification: Add a JSON extraction utility in `chat/route.ts` that strips markdown fences and validates against the expected `{ nodeId, changes[] }` shape before consuming the result.
- Test coverage: No tests exist for this parsing path.

**Draft revision workflow relies entirely on LLM instruction-following:**
- Files: `skills/drupal-agent/SKILL.md`
- Why fragile: The critical safety invariant (never edit a published node without creating a draft first) is enforced only through natural-language instructions to the LLM. There is no code-level guard, no OAS conditional branch, and no post-hoc verification that the draft step was actually executed.
- Safe modification: Add a guard in the OAS flow graph that calls `drupal_node_create_draft_revision` unconditionally when `nodeStatus === "published"` is passed as input, removing reliance on LLM compliance for the safety-critical step.
- Test coverage: None — no tests in this repo.

## Scaling Limits

**Single-node sequential flow — no parallelism:**
- Current capacity: One Drupal node edit per agent invocation, fully sequential (read → draft → update → respond).
- Limit: Bulk content editing (multiple nodes or multiple fields requiring separate MCP calls) requires multiple separate agent invocations with no batching mechanism.
- Scaling path: Not applicable to current stated scope; document as a known limitation for bulk-edit feature requests.

## Dependencies at Risk

**`@cinatra-ai/drupal-connector` (undeclared runtime dependency):**
- Risk: All four MCP primitives the agent uses (`drupal_node_get`, `drupal_node_create_draft_revision`, `drupal_node_update`, `drupal_node_publish`) are provided by `@cinatra-ai/drupal-connector`, which is not declared in `package.json` `cinatra.dependencies`. If the connector is absent or incompatible, the agent silently fails at tool-call time with no manifest-level warning.
- Impact: Agent is non-functional without the connector; dependency is invisible to marketplace tooling.
- Migration plan: Declare the connector in `cinatra.dependencies` once the platform schema supports runtime MCP dependencies.

## Missing Critical Features

**No error handling or fallback for failed MCP calls:**
- Problem: The SKILL.md and OAS define the happy path (read → draft → update → diff) but provide no instructions or flow branches for failure cases: `drupal_node_get` returning an error, `drupal_node_create_draft_revision` failing (e.g., already a draft), or `drupal_node_update` rejecting unknown field names.
- Blocks: Reliable production use — any MCP error will cause the LLM to either hallucinate a response or return a non-JSON final message that breaks the caller's parse step.

**No input validation on `nodeId` or `instanceId`:**
- Problem: `instanceId` and `nodeId` are passed as bare strings with no format validation. A malformed or injected value (e.g., containing path traversal or SQL fragments) is forwarded directly to the MCP server without sanitisation.
- Blocks: Safe use in multi-tenant environments where `instanceId` selects a Drupal site.

## Test Coverage Gaps

**No tests exist:**
- What's not tested: The entire agent behaviour — draft-revision branching logic, JSON diff output format, field omission (not passing empty strings), LLM output parsing, error handling.
- Files: Entire repo — no `*.test.*` or `*.spec.*` files found.
- Risk: Regressions in SKILL.md prompt wording, OAS flow graph wiring, or the gate script's banned-primitive list go undetected until runtime failures in production.
- Priority: High — the draft-revision safety invariant and the JSON output contract are both load-bearing and entirely untested.

**`extension-kind-gate.mjs` has no unit tests:**
- What's not tested: `validateAgent`, `validateBpmnSanity`, `validateWorkflowPackageShape`, `findWorkflowSidecars`, `parseArgs` — all exported pure functions.
- Files: `extension-kind-gate.mjs`
- Risk: Edge cases in the BPMN XML parser (malformed namespace declarations, single-quoted attributes, CDATA stripping) or the banned-primitive regex patterns could produce false negatives that allow retired primitives through CI.
- Priority: Medium — the functions are pure and straightforward to unit-test with a standard Node test runner.

---

*Concerns audit: 2026-06-09*
