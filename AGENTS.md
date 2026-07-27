# drupal-agent — AGENTS.md

Agent-specific guidance for `@cinatra/drupal-agent`. Read alongside the repo-root `AGENTS.md` and the agent instructions in `cinatra/oas.json` (the `load_node` node's `data.system`).

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
