# drupal-agent — AGENTS.md

Agent-specific guidance for `@cinatra/drupal-agent`. Read alongside the repo-root `AGENTS.md` and the agent instructions in `cinatra/oas.json` (the `load_node` node's `data.system`).

## Repair capability (cinatra-ai/cinatra#2046, #2286) — declared, inert until cinatra's pin advances

`package.json`'s `cinatra.lifecycle.repairCapable: true` means this template's own runs can be re-driven for a repair round-trip: when a reviewer requests changes on a node this agent already edited, cinatra core can dispatch a NEW run of this SAME template instead of escalating straight to a human. That dispatched run uses no new input shape — it is the ordinary `instanceId`/`nodeId`/`nodeBundle`/`nodeStatus`/`instructions` contract documented below, with `instructions` describing the reviewer's findings instead of a person's free-form request. `cinatra/oas.json`'s `load_node.data.system` has a "Repair-shaped tasks (reviewer findings)" section that tells the prompt how to recognize and act on that.

There is no producer-side code in this repo for repair, and none is needed: under cinatra's Path 2 design a repairing producer's own normal run execution IS the handler. Core supplies the CMS-generic glue either side of it — the task text it hands the run, and the completion adapter that reads the run's re-staged capture back into the repair record (`packages/agents/src/lifecycle-repair-cms-production-bridge.ts` in the cinatra monorepo, which keys on core's own outbox/snapshot-target rows and never on a package name).

**This declaration has no effect by itself.** It only starts doing anything once cinatra's pin for this package advances to a version carrying it — until then `repairCapable` is a harmless, unused label on the manifest. The `changes_requested` route resolves it from `agent_templates.lifecycle_config`, which is compiled from this block at install time.

**Repair rounds never widen what this agent writes.** A repair round is subject to the same rules as any other edit: draft-revision-before-editing for a published node, only the fields the findings name, and never `drupal_node_publish` unless a human explicitly asked. It also carries a no-content-write guard — when nothing named in the findings is actionable, or every requested value already matches the node, the agent makes NO Drupal content write at all (not even a draft revision) and returns the NO-CHANGE RESULT shape (empty `changes`, no `proposalId`). That guard is scoped to CONTENT writes: an explicit user request to publish is still honoured exactly as before (a reviewer finding is never a publish request).

## Agent role

A WayFlow `node`-type leaf agent. Receives natural language editing instructions and a Drupal node context, applies the changes via `drupal_*` MCP primitives, and returns a structured diff. Invoked via A2A blocking dispatch from `/api/drupal-widget/chat/route.ts`.

## A2A input contract

The caller (`chat/route.ts`) sends a single `user` message whose text is a JSON-stringified object:

```json
{
  "instanceId": "site-1",
  "nodeId": "42",
  "nodeBundle": "article",
  "nodeStatus": "published",
  "instructions": "Change the title to 'New headline' and fix the second paragraph."
}
```

All fields are strings. `nodeStatus` is `"published"` or `"draft"`. The agent reads these from the most recent user message in the conversation history — they are not injected as named DFE inputs (per WayFlow's `A2AAgent.input_descriptors = []` convention).

## A2A output contract

The agent emits a single final assistant message containing a JSON object:

```json
{
  "nodeId": "42",
  "instanceId": "site-1",
  "changes": [
    { "field": "title", "before": "Old headline", "after": "New headline" },
    { "field": "body",  "before": "Old paragraph...", "after": "Fixed paragraph..." }
  ]
}
```

The caller (`chat/route.ts`) reads this from `task.history` (not `task.artifacts`) — WayFlow returns the conversation history in the `task` object; `task.artifacts` is not implemented. The caller JSON-parses the final assistant message text to extract `nodeId` and `changes`.

## Draft revision workflow (critical)

Published nodes must NEVER be edited directly. The agent prompt enforces:

1. `drupal_node_get` → read current content
2. If `nodeStatus === "published"` → `drupal_node_create_draft_revision` first
3. `drupal_node_update` → apply changes to the draft
4. Return diff JSON

Bypassing step 2 silently overwrites the live frontend revision without creating a content history entry. The `chat/route.ts` passes `nodeStatus` explicitly so the agent can branch correctly without an extra read.

## MCP primitives used

| Primitive | Purpose |
|---|---|
| `drupal_node_get` | Read current node content (uses search proxy — see connector AGENTS.md) |
| `drupal_node_create_draft_revision` | Demote published node to draft before editing |
| `drupal_node_update` | Apply field changes (`fields` map) |
| `drupal_node_publish` | Publish only if user explicitly requests it |

These are registered by `@cinatra-ai/drupal-connector` via `src/lib/mcp-server.ts`. The agent accesses them through Cinatra's MCP server (not directly).

## Timeout

The A2A client in `chat/route.ts` uses `timeoutMs: 600_000` (10 minutes). This covers a full read → draft → update cycle including any LLM latency. Do not reduce this timeout without verifying that all Drupal MCP operations complete well within the new limit.

## Local dev URL

Default WayFlow agent URL: `http://localhost:3020`. Start with:

```bash
docker compose --profile drupal up -d
```

Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local` (e.g. `http://wayflow-drupal-content-editor:3020` when Cinatra itself runs inside Docker).
