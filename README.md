# Drupal Agent

Edit Drupal content from plain-language instructions and return a field diff for review. A published page is never edited in place: the agent saves the change as an unpublished draft revision of the SAME node, and the live page stays unchanged until someone publishes that draft on the site. This agent never publishes. It needs the Cinatra Drupal module's protected draft tools and a Content Moderation workflow with an unpublished draft state; without them the site refuses the write and nothing is saved.

**Install.** Install from the Cinatra marketplace; use your workspace's Drupal connector.

**Configuration.** Each call's `instanceId` selects a connected Drupal site.

**Usage.** Inputs: `instanceId`, `nodeId` (numeric ID), `nodeBundle`, `nodeStatus`, `instructions` (requested change). Status and bundle come from the node read, never from caller hints. Output: `nodeId`, `reason` (empty on success), `changes` (`field`, `before`, `after`), `error` (`code`, `message`).

**How it works.** The read and the write are made in code, never by a model. One model step proposes the change and is served no tool. A person reviews the proposed page; the write sends only the fields of the approved revision, with the read's binding, so the site saves only if the page is unchanged since the read. A published page goes to `drupal_node_create_draft_revision`, an unpublished page to `drupal_node_update`; each write has its own publish card.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. Default agent port: 3020. Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**Troubleshooting.** If the page changed on the site after the read, nothing is written and the change is proposed again for a new review. Any other refusal ends the run with `error.code` and a reason. `write_unverified` means a change may have been saved: check the page on the site before you try again. A failed read, or a reviewed revision that is unreadable or of another node, fails the run before any write. A request to publish is refused. If no change was proposed, the run completes with empty `changes` and `reason` repeats the request.

## Works with

- Drupal

## Capabilities

- Edit a node from plain-language instructions
- Save published-page edits as a draft revision of the same node
- Write only if the page is unchanged since the read
- Preserve fields not requested for change
- Return before-and-after field diffs
