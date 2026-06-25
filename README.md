# Drupal Agent

Edit Drupal content from plain-language instructions. Tell the agent which node to change and what to change about it, and it reads the page, applies only the fields you asked for, and returns a structured diff you can review. When the page is already live, it parks the change on a draft revision so the public site stays untouched until somebody publishes the new version.

**Install.** Install the Drupal Agent from the Cinatra marketplace. The agent has no additional dependencies; it uses the Drupal connector your workspace already has configured.

**Configuration.** The agent requires a connected Drupal site set up via the Drupal connector. Each call passes an `instanceId` that selects which connected site to target, so a single agent installation serves multiple Drupal sites.

**Usage.** The agent accepts five inputs: `instanceId` (your connected site identifier), `nodeId` (the numeric node ID), `nodeBundle` (content type, e.g. `article`), `nodeStatus` (`"published"` or `"draft"`), and `instructions` (plain-language description of the change). It returns `nodeId` and a `changes` array, each entry containing `field`, `before`, and `after` values. Example: `nodeId: "42"`, `nodeStatus: "published"`, `instructions: "Change the title to 'New headline'."` — the agent reads the node, creates a draft revision, applies the edit, and returns the diff.

**Development.** Start the local stack with `docker compose --profile drupal up -d`. The agent runs on port 3020 by default. Override the URL via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local`.

**API contract.** Input fields are all strings. Output `changes` is an array of `{field, before, after}` objects. The agent never publishes content unless `drupal_node_publish` is explicitly requested.

**Troubleshooting.** If edits do not appear on the live site, confirm `nodeStatus` is passed correctly — a `"published"` node is always edited via a draft revision and must be published separately. If the agent returns an empty `changes` array, no fields matched the instructions; rephrase to name the Drupal field explicitly.

## Works with

- Drupal

## Capabilities

- Edit a Drupal node from a plain-language description of the change
- Protect live pages by parking edits on a draft revision before touching published content
- Leave untouched any field you did not explicitly ask to change
- Return a field-by-field before-and-after diff for review
- Operate against any of your connected Drupal sites
