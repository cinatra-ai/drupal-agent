# Drupal Agent

Edit Drupal content from plain-language instructions and return a field diff for review. A published page is never edited in place: the agent saves the change as an unpublished draft revision of the SAME node, and the live page stays unchanged until someone publishes that draft. This needs the Cinatra Drupal module's protected draft tools on the site and a Content Moderation workflow with an unpublished draft state; without them the agent refuses before any content write and never creates a separate page.

**Install.** Install from the Cinatra marketplace; use the Drupal connector configured in your workspace.

**Configuration.** Each call's `instanceId` selects a connected Drupal site. One agent installation serves multiple sites.

**Usage.** Inputs: `instanceId`, `nodeId` (numeric ID), `nodeBundle` (content type), `nodeStatus` (`"published"` or `"draft"`), `instructions` (requested change). Actual status and bundle come from the node read; caller hints cannot authorize a live edit. Output: `nodeId`, plain `reason` (empty on ordinary success/no-change), and `changes`, containing `field`, `before`, `after`. Asking to retitle a published node saves the new title on a draft revision of that node; the diff reads the values stored on that draft.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. Default agent port: 3020. Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**API contract.** Inputs are strings; `changes` contains `{field, before, after}` objects. Publishing requires an explicit `drupal_node_publish` request. A published edit is one `drupal_node_create_draft_revision` call that saves the draft and reads it back; it is never followed with a generic live-default update.

**Troubleshooting.** Read `reason` on refusal: Content Moderation, an authorized non-published/non-default transition and exact-revision MCP reading are required. Refusal writes no content. A separate page requires explicit choice. Empty `changes` and empty `reason` mean no field diff; an explicit publish-only action also has no field diff.

## Works with

- Drupal

## Capabilities

- Edit a node from plain-language instructions
- Save published-page edits as a draft revision of the same node, or refuse before any write
- Preserve fields not requested for change
- Return before-and-after field diffs
- Use any connected Drupal site
