# Drupal Agent

Edit Drupal content from plain-language instructions. Tell the agent which node to change and what to change about it, and it reads the page, applies only the fields you asked for, and returns a structured diff you can review. When the page is already live, it requires a protected draft revision of the same node and an exact-revision MCP readback. This version refuses that edit before any content write while the backend lacks that reader; it never changes the live page or creates a stray new one.

**Install.** Install the Drupal Agent from the Cinatra marketplace. The agent has no additional dependencies; it uses the Drupal connector your workspace already has configured.

**Configuration.** The agent requires a connected Drupal site set up via the Drupal connector. Each call passes an `instanceId` that selects which connected site to target, so a single agent installation serves multiple Drupal sites.

**Usage.** The agent accepts five inputs: `instanceId` (your connected site identifier), `nodeId` (the numeric node ID), `nodeBundle` (content type, e.g. `article`), `nodeStatus` (`"published"` or `"draft"`), and `instructions` (plain-language description of the change). Status and bundle are read from the node; caller hints never authorize a live edit. It returns `nodeId`, a plain `reason` (empty on ordinary success/no-change), and a `changes` array, each entry containing `field`, `before`, and `after` values. Example: `nodeId: "42"`, `nodeStatus: "published"`, `instructions: "Change the title to 'New headline'."` — the agent reads the node and explains why protected editing is currently unavailable instead of changing the live page.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. The agent runs on port 3020 by default. Override the URL via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**API contract.** Input fields are all strings. Output `changes` is an array of `{field, before, after}` objects. The agent never publishes content unless `drupal_node_publish` is explicitly requested.

**Troubleshooting.** Read `reason` when an edit is refused: the site needs Content Moderation, an authorized non-published/non-default transition and supported exact-revision MCP reading. No Drupal content is written on refusal. A separate new page is an option only by your explicit choice. Empty `changes` with an empty reason means no field diff; an explicit publish-only action also has no field diff.

## Works with

- Drupal

## Capabilities

- Edit a Drupal node from a plain-language description of the change
- Protect live pages by refusing edits that cannot be saved and verified on a same-node non-default draft
- Leave untouched any field you did not explicitly ask to change
- Return a field-by-field before-and-after diff for review
- Operate against any of your connected Drupal sites
