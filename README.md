# Drupal Agent

Edit Drupal content from plain-language instructions and return a field diff for review. A published page is never edited in place: the agent saves the change as an unpublished draft revision of the SAME node, and the live page stays unchanged until someone publishes that draft. This needs the Cinatra Drupal module's protected draft tools on the site and a Content Moderation workflow with an unpublished draft state; without them the agent refuses before any content write and never creates a separate page.

**Install.** Install from the Cinatra marketplace; use your workspace's Drupal connector.

**Configuration.** Each call's `instanceId` selects a connected Drupal site.

**Usage.** Inputs: `instanceId`, `nodeId` (numeric ID), `nodeBundle` (content type), `nodeStatus` (`"published"` or `"draft"`), `instructions` (requested change). Status and bundle come from the node read, never from caller hints. Output: `nodeId`, `reason` (empty on success/no-change), and `changes`, containing `field`, `before`, `after`.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. Default agent port: 3020. Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**API contract.** Inputs are strings; `changes` holds `{field, before, after}`. The write takes every value and the publish flag only from the approved page snapshot revision, read back after the review; a publish also needs an explicit request. A published edit is one `drupal_node_create_draft_revision` call that saves the draft and reads it back, never followed by a generic live-default update.

**Troubleshooting.** A refused edit ends the run as failed with the reason: Content Moderation, an authorized non-published/non-default transition and exact-revision MCP reads are required. A reviewed revision that is unreadable, of another node or empty fails the run (`reviewed_change_unavailable`) before any site call. A refusal after dispatch may leave a draft. A separate page requires explicit choice. Empty `changes` in a completed run mean no edit needed (a publish alone is refused); a reviewed change that saved nothing ends the run as failed, never as an empty diff.

## Works with

- Drupal

## Capabilities

- Edit a node from plain-language instructions
- Save published-page edits as a draft revision of the same node, or refuse before any write
- Preserve fields not requested for change
- Return before-and-after field diffs
- Use any connected Drupal site
