# Drupal Agent

Edit Drupal content from plain-language instructions and return a field diff for review. Published edits require a protected non-default draft of the SAME node and exact-revision MCP readback. This version refuses those edits before content writes while the backend lacks that reader; it never changes the live page or creates a stray new one.

**Install.** Install from the Cinatra marketplace; use the Drupal connector configured in your workspace.

**Configuration.** Each call's `instanceId` selects a connected Drupal site. One agent installation serves multiple sites.

**Usage.** Inputs: `instanceId`, `nodeId` (numeric ID), `nodeBundle` (content type), `nodeStatus` (`"published"` or `"draft"`), `instructions` (requested change). Actual status and bundle come from the node read; caller hints cannot authorize a live edit. Output: `nodeId`, plain `reason` (empty on ordinary success/no-change), and `changes`, containing `field`, `before`, `after`. Asking to retitle a published node currently returns the protected-edit refusal instead of changing the live page.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. Default agent port: 3020. Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**API contract.** Inputs are strings; `changes` contains `{field, before, after}` objects. Publishing requires an explicit `drupal_node_publish` request. A protected draft request is never followed with a generic live-default update.

**Troubleshooting.** Read `reason` on refusal: Content Moderation, an authorized non-published/non-default transition and exact-revision MCP reading are required. Refusal writes no content. A separate page requires explicit choice. Empty `changes` and empty `reason` mean no field diff; an explicit publish-only action also has no field diff.

## Works with

- Drupal

## Capabilities

- Edit a node from plain-language instructions
- Refuse live-page edits without verified same-node non-default draft support
- Preserve fields not requested for change
- Return before-and-after field diffs
- Use any connected Drupal site
