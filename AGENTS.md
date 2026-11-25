# drupal-agent — AGENTS.md

Agent-specific guidance for `@cinatra/drupal-agent`. Read alongside the repo-root `AGENTS.md` and the agent instructions in `cinatra/oas.json` (the `load_node` node's `data.system`).

## Repair capability (cinatra-ai/cinatra#2046, #2286) — declared, inert until cinatra's pin advances

`package.json`'s `cinatra.lifecycle.repairCapable: true` means this template's own runs can be re-driven for a repair round-trip: when a reviewer requests changes on a node this agent already edited, cinatra core can dispatch a NEW run of this SAME template instead of escalating straight to a human. That dispatched run uses no new input shape — it is the ordinary `instanceId`/`nodeId`/`nodeBundle`/`nodeStatus`/`instructions` contract documented below, with `instructions` describing the reviewer's findings instead of a person's free-form request. `cinatra/oas.json`'s `load_node.data.system` has a "Repair-shaped tasks (reviewer findings)" section that tells the prompt how to recognize and act on that.

There is no producer-side code in this repo for repair, and none is needed: under cinatra's Path 2 design a repairing producer's own normal run execution IS the handler. Core supplies the CMS-generic glue either side of it — the task text it hands the run, and the completion adapter that reads the run's re-staged capture back into the repair record (`packages/agents/src/lifecycle-repair-cms-production-bridge.ts` in the cinatra monorepo, which keys on core's own outbox/snapshot-target rows and never on a package name).

**This declaration has no effect by itself.** It only starts doing anything once cinatra's pin for this package advances to a version carrying it — until then `repairCapable` is a harmless, unused label on the manifest. The `changes_requested` route resolves it from `agent_templates.lifecycle_config`, which is compiled from this block at install time.

**Repair rounds never widen what this agent writes.** A repair round is subject to the same rules as any other edit: one atomic protected same-node draft edit for a published node, only the fields the findings name, and never `drupal_node_publish` unless a human explicitly asked. It also carries a no-content-write guard — when nothing named in the findings is actionable, or every requested value already matches the node, the agent makes NO Drupal content write at all (not even a draft revision) and returns the NO-CHANGE RESULT shape (empty `changes`, no `proposalId`). That guard is scoped to CONTENT writes: an explicit user request to publish is still honoured together with a reviewed change of text (a reviewer finding is never a publish request).

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

All fields are strings. Caller `nodeStatus` and `nodeBundle` are hints only: the actual node read supplies the authoritative status/bundle to the write step. The agent reads these from the most recent user message in the conversation history — they are not injected as named DFE inputs (per WayFlow's `A2AAgent.input_descriptors = []` convention).

## A2A output contract

The agent emits a single final assistant message containing a JSON object:

```json
{
  "nodeId": "42",
  "reason": "",
  "changes": [
    { "field": "title", "before": "Old headline", "after": "New headline" },
    { "field": "body",  "before": "Old paragraph...", "after": "Fixed paragraph..." }
  ]
}
```

The caller (`chat/route.ts`) reads this from `task.history` (not `task.artifacts`) — WayFlow returns the conversation history in the `task` object; `task.artifacts` is not implemented. The caller JSON-parses the final assistant message text to extract `nodeId`, `changes` and the declared `reason`. A refusal carries no diff and names why no safe write occurred; ordinary success has an empty reason; a change of nothing that never reached the review carries the fixed no-change reason below.

## The write takes only the reviewed change (cinatra-ai/cinatra#3745)

The flow is `start` → `read_node` → `compose_change` → `form_page` →
`route_change` → `file_page` → `gather_page_review` → `page_review_gate` →
`read_reviewed_page` → `load_node` → `settle_outcome` → `emit_output` → `end`.

A change of nothing (no values, or values equal to the read, and no publish)
is not filed and not reviewed: `form_page` answers `next: "no_change"`, the
branch `route_change` takes the run to `no_change_outcome` (the
`reviewed_change` tool, `op: unchanged`, which checks that again) →
`emit_output` → `end`. The run completes with empty `changes`, and no Drupal
call is made. The reason is never empty: the step builds it in code (never
the model) from the run's `instructions` (a data edge from `start`), the node
id and the read title: "No change was proposed for this request on node 7
("Opening hours"), so nothing was reviewed or written: <request>", the
request flattened to one line and cut to 300 characters. The compose step's
`{fields: [], publish: false}` is the same for a request already satisfied and
for a request the model dropped (whether a publish was asked is known only
through that answer), so no code can tell them apart; the reason lets the
person see it. Any other `next` goes to the review.

Only a successful read leads to either road. `reviewed_change` accepts the
read only when its `error` is an object whose `code` and `message` are both
empty, its `nodeStatus` is `published` or `draft`, its `nodeChanged` and its
title are not empty, its `fieldValues` is a list and the run's `nodeId` is not
empty. Any other read, of any shape (`{}`, `{message}`, `null`, a text, a
missing input or a flow default), fails the run with the read's own message,
or a fixed one, and never ends it as a change of nothing.

A publish with no change of text is refused at `form_page`, and nothing is
filed: the page display draws only changed text blocks (its parser refuses a
snapshot with no excerpts) and no node status, and the publish card opens only
after an approved review in the same run. The display would need a page-level
status change it draws, or an excerpt kind for one that its parser accepts
without a text excerpt, before such a request can be reviewed.

`compose_change` answers only the values to write, `writeFields`: `fields`
(one `{field, value}` per changed field, the complete new value) and `publish`
(true only on the user's explicit request to publish). `form_page` calls the
pack's `reviewed_change` tool (`op: form`), which builds the page snapshot in
code: the page, `writeFields` and the changed blocks the display shows
(`excerpts`), derived from `writeFields` and the read by one function,
`pageExcerpts`. Nothing reaches `load_node` from the compose step around the
review.

After the review, `read_reviewed_page` calls the pack's `reviewed_change` tool
(`cinatra/tools/reviewed-change.mjs`). The tool takes the revision the review's
answer approves (`review.targets` of the answer that resumes the run), not the
revision this run filed: after a Regenerate the approved revision is a
successor of the filed one. It reads that revision through the host's artifact
read port by its revision id, and answers `reviewedFields`, `reviewedPublish`
and `reviewedRevisionId`. `load_node` writes exactly `reviewedFields`, and
calls `drupal_node_publish` only when `reviewedPublish` is true and the request
asks for it; `settle_outcome` checks the outcome against `reviewedFields`.

The tool refuses, so the run fails with `reviewed_change_unavailable` and a
message and no Drupal call is made, when the answer names no approved revision
of the filed artifact (another artifact, no target, no approval), when the read
fails, is cut short or answers another revision or artifact, when the text
is not a Drupal page snapshot or carries no field to write, when the text
shows other blocks than the ones `pageExcerpts` derives from its values and the
read, and when the revision is not, as a whole, a snapshot of this run's node.
One check, `checkedSnapshot`, applies to what `form_page` files and to the
approved revision: the display's parser accepts it (`displayReading` restates
its rules), each excerpt has exactly the form `pageExcerpts` builds, and the
page record equals the one built from this run's read: `nodeId`, `status`,
`title`, `address` and `cmsAddress`. A difference names the part that differs.

### What the reviewer sees of the values to write

The display (`@cinatra-ai/website-artifacts`, `src/cms-page-view.tsx:89,177`)
draws only `page` and the `excerpts` (`published` against `proposed`), as plain
text; it never draws `writeFields`. So `pageExcerpts` splits each value into
its top-level blocks (headings, paragraphs, each list item, the first with the
list's opening tag and the last with its closing tag, any other element,
comments, runs of text with inline elements); white space between blocks
belongs to the block before it, and the blocks joined are the value byte for
byte. It compares the old and new blocks byte for byte and shows each changed
block as its SOURCE text on both sides: a changed link target, attribute, tag,
comment, image or script is drawn as text whether or not the words change, and
every block not shown is byte for byte the read.

It refuses, before anything is filed, what the display cannot show: a block
(or the title) whose two sides differ only in white space, because the
display's parser rejects a block whose two sides hold the same words
(`src/cms-page-model.ts:189`), and more than 200 changed blocks
(`CMS_PAGE_MAX_EXCERPTS`). One rule per changed block covers what plain text
hides (`checkedBlock`), byte for byte, with no exception and no normalisation.
A changed block that holds an invisible character (Unicode Cf, Cc except tab,
line feed and carriage return, Zs except U+0020, so U+00A0 too, Zl, Zp,
default ignorable characters and variation selectors) in its read or new text
is refused: the agent does not change such a block, a person does it on the
site; this freezes blocks with joined emoji, emoji variation selectors, soft
hyphens, direction marks or no-break spaces. In the changed part of a block
(between its byte-equal start and end, widened so no run of white space is
cut), white space may only be a single U+0020 between two visible characters:
a tab, a line break or two spaces there, in text or inside markup such as an
attribute, is refused. The excerpt shows the block's source, so markup and
attribute changes are seen; the agent can change words and markup and add a
block written without line breaks, but cannot change white space other than
single spaces.

The read-back accepts the review's answer only when all its signals agree:
`approved` is true, `review.decision` is `approved`, `review.envelopeVersion`
is 1, and `review.targets` names exactly one revision of the filed artifact.

## The node check before each write

No pack tool can read the site (a pack tool gets only the data, artifact,
review, clock and object ports), so the check is in `load_node`'s Rule 11:

1. The baseline is `nodeStatus` and `nodeChanged` from `read_node`.
2. Right before each site write, `drupal_node_get`; the status and the change
   time must equal the baseline.
3. When a second write follows (`drupal_node_publish` after
   `drupal_node_update`, e.g. "change the title and publish"), the first write
   changed the change time itself. The update answers no change time to rely
   on (it returns the `mcp_update_content` answer as it is), so the node is read
   once right after the update: still draft, the written fields read back as
   written. That read is the baseline for the check before the publish.
4. A failed check before the first write says nothing was written; after a
   saved field write the reason names the saved fields and says the node was
   not published.

The check is not atomic. `drupal_node_update` takes `instanceId`, `nodeId` and
`fields`, and `drupal_node_publish` `instanceId` and `nodeId`
(drupal-mcp-connector `src/mcp/handlers.ts:87-96`; an unknown key is stripped).
Neither carries an expected version to `mcp_update_content` or
`mcp_publish_content` (`:577`, `:724`). Two windows remain: a save between a
check and its write, and a save between the update and the read right after it
(it then becomes the baseline; the read-back of the written fields catches a
change to those fields only). Closing them needs, on both tools, an
`expectedChanged` or `expectedRevisionId` argument the site checks in the same
save (as the module writer does for `drupal_node_create_draft_revision` with
`expected_default_revision_id`, `:650`), and the update's answer to carry the
saved node's `changed` and revision id. `drupal_node_create_draft_revision`
keeps its `expectedFields` check (`:636`).

## Draft revision workflow (critical)

Published nodes must never be edited directly. The actual read determines the
status and bundle; caller hints cannot authorize a live-node update. The filed
page snapshot and existing human review still precede the write step.

For a real requested change to a published node, call
`drupal_node_create_draft_revision(instanceId,nodeId,fields,language,expectedFields)` once to request an
atomic edit of the same node. Never follow it with generic `drupal_node_update`,
which addresses the default node. The language comes from the actual read's
`langcode`, wired as `nodeLanguage`; an absent language cannot authorize a
published edit. The existing Cinatra module supplies the protected writer and
exact-revision reader through the site's maintained MCP profile. A successful
result carries independently stored `pendingDraft.fields` and the actual
`pendingDraft.revisionId`; before-values use the bound `pendingDraft.beforeFields`
and after-values use stored item values. `expectedFields` compares requested
fields to the earlier actual read and refuses a stale edit before writing. Before-write
refusals return a visible reason and no diff. A failure after writer dispatch
preserves the possible saved draft and inspection requirement; never claim zero
writes or retry automatically. No separate-node or live-edit fallback is allowed.

Unpublished nodes may use generic update after its actual-status guard. Repairs
keep the same field scope/no-change guard; publication still requires an explicit
user request. No direct REST or invented MCP revision-selector arguments.

## MCP primitives used

| Primitive | Purpose |
|---|---|
| `drupal_node_get` | Read current node content (uses search proxy — see connector AGENTS.md) |
| `drupal_node_create_draft_revision` | Request a protected SAME-node atomic edit in the exact read language, using existing module tools and independently stored draft readback |
| `drupal_node_update` | Apply unpublished-node field changes after actual-status validation |
| `drupal_node_publish` | Publish only if user explicitly requests it |

These are registered by `@cinatra-ai/drupal-connector` via `src/lib/mcp-server.ts`. The agent accesses them through Cinatra's MCP server (not directly).

## Timeout

The A2A client in `chat/route.ts` uses `timeoutMs: 600_000` (10 minutes). This covers a full read → protected atomic edit cycle including any LLM latency. Do not reduce this timeout without verifying that all Drupal MCP operations complete well within the new limit.

## Local dev URL

Default WayFlow agent URL: `http://localhost:3020`. Start with:

```bash
docker compose --profile drupal up -d
```

Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local` (e.g. `http://wayflow-drupal-content-editor:3020` when Cinatra itself runs inside Docker).
