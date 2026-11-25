# drupal-agent — AGENTS.md

Agent-specific guidance for `@cinatra/drupal-agent`. Read alongside the repo-root `AGENTS.md` and `cinatra/oas.json` (the flow) and `cinatra/tools/reviewed-change.mjs` (the code steps).

## Repair capability (cinatra-ai/cinatra#2046, #2286) — declared, inert until cinatra's pin advances

`package.json`'s `cinatra.lifecycle.repairCapable: true` means this template's own runs can be re-driven for a repair round-trip: when a reviewer requests changes on a node this agent already edited, cinatra core can dispatch a NEW run of this SAME template instead of escalating straight to a human. That dispatched run uses no new input shape — it is the ordinary `instanceId`/`nodeId`/`nodeBundle`/`nodeStatus`/`instructions` contract documented below, with `instructions` describing the reviewer's findings instead of a person's free-form request. `cinatra/oas.json`'s `compose_change.data.system` has a "Repair-shaped tasks (reviewer findings)" section that tells the prompt how to recognize and act on that.

There is no producer-side code in this repo for repair, and none is needed: under cinatra's Path 2 design a repairing producer's own normal run execution IS the handler. Core supplies the CMS-generic glue either side of it — the task text it hands the run, and the completion adapter that reads the run's re-staged capture back into the repair record (`packages/agents/src/lifecycle-repair-cms-production-bridge.ts` in the cinatra monorepo, which keys on core's own outbox/snapshot-target rows and never on a package name).

**This declaration has no effect by itself.** It only starts doing anything once cinatra's pin for this package advances to a version carrying it — until then `repairCapable` is a harmless, unused label on the manifest. The `changes_requested` route resolves it from `agent_templates.lifecycle_config`, which is compiled from this block at install time.

**Repair rounds never widen what this agent writes.** A repair round is subject to the same rules as any other edit: one reviewed same-node draft revision for a published node, only the fields the findings name, and never a publish. It also carries a no-content-write guard: when nothing named in the findings is actionable, or every requested value already matches the node, the agent makes NO Drupal content write at all and returns the no-change result (empty `changes`). A reviewer finding is never a publish request.

## Agent role

A WayFlow `node`-type leaf agent. Receives natural language editing instructions and a Drupal node context, proposes the change for a person's review, writes the reviewed change in code through the connector's passthrough tools, and returns a structured diff. Invoked via A2A blocking dispatch from `/api/drupal-widget/chat/route.ts`.

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
  "error": { "code": "", "message": "" },
  "changes": [
    { "field": "title", "before": "Old headline", "after": "New headline" },
    { "field": "body",  "before": "Old paragraph...", "after": "Fixed paragraph..." }
  ]
}
```

The caller (`chat/route.ts`) reads this from `task.history` (not `task.artifacts`) — WayFlow returns the conversation history in the `task` object; `task.artifacts` is not implemented. The caller JSON-parses the final assistant message text to extract `nodeId`, `changes`, `reason` and `error`. A refusal carries no diff, names why no safe write occurred and carries the refusal code in `error.code`; ordinary success has an empty reason; a change of nothing that never reached the review carries the fixed no-change reason below.

## The model-free read and write (cinatra-ai/cinatra#3745)

No model takes part in the read or the write. The flow, as nodes and edges:

```
start -> read_page -> check_read -> compose_change -> form_page -> route_change
route_change: default -> file_page, no_change -> no_change_outcome
file_page -> gather_page_review -> page_review_gate -> read_reviewed_page -> route_status
route_status: published -> write_draft, draft -> write_unpublished, default -> write_outcome
write_draft -> write_outcome;  write_unpublished -> write_outcome
write_outcome -> route_write
route_write: node_changed -> read_page (with reviewNotice); written, every refusal code, default -> emit_output
no_change_outcome -> emit_output -> end
```

- `read_page` is a passthrough call of the connector's `drupal_node_read_for_edit`
  (`instanceId`, `nid`). It answers the node, its fields and the edit binding.
  A failed read is thrown by the connector, so the step and the run fail.
- `check_read` (`reviewed_change`, `op: page`) checks the read in code: the
  node id and site are the run's, `published` is a boolean, the title is not
  empty, and the binding is a non-empty object. It reads no member of the
  binding. It answers `status` (`published`/`draft`), `title`, `body`,
  `fieldValues`, `address` (always empty: the read carries no page address) and
  an empty `error`.
- `compose_change` is the one model step. It is served no tool (`tools: []`)
  and answers only `writeFields`.
- `form_page`, `file_page`, `gather_page_review`, `page_review_gate` and
  `read_reviewed_page` file the page snapshot, ask a person to review it and
  read back the approved revision, as described below. `read_reviewed_page`
  answers `reviewedFields` (an object `{field: value}`, only the fields that
  change), `reviewedRevisionId` and `reviewedSnapshot`.
- `write_draft` (`drupal_node_create_draft_revision`) and `write_unpublished`
  (`drupal_node_update`) are the two publishing steps (`publishes: true`). The
  host needs a literal tool per publishing step, and the connector refuses an
  update on a published binding and a draft revision on an unpublished one, so
  the status as read picks one step. Each sends exactly four arguments, all
  templates: `instanceId` and `nodeId` from `read_page`, `fieldsJson` =
  `{{ reviewedFields | tojson }}` from the read-back, and `expectedBindingJson` =
  `{{ binding | tojson }}`, the whole binding by one edge from `read_page`. No
  value comes from the model step. The module compares the binding with the node
  under its lock and saves only if the page is unchanged since the read.
- Each publish card shows the site, the title as read, the node id (labelled
  with what the save does) and the reviewed revision (an `artifacts` row).
- `write_outcome` (`op: outcome`) reads the write's answer in code. A save
  answers `next: "written"` and the `changes` (before = the read, after = the
  stored value). `{ok: false, code: "node_changed"}` answers `next:
  "node_changed"` and a `reviewNotice`; the flow reads the page again and asks
  for a new review. Any other known code ends the run with `error.code` and a
  plain reason; `write_unverified` tells the person to check the page on the
  site, because a change may have been saved. An answer it cannot read fails
  the run (`write_answer_unreadable`).

This agent never publishes. A `publish: true` from the model step is refused
at `form_page` and at the read-back, with a reason that tells the person to
publish the page on the site. `drupal_node_publish` is named by no step.

### KNOWN GAP: what the host and the connector must still do

The flow is built against these contracts; until they land, a run stops at
the first step that needs them.

1. The host must serve `drupal_node_read_for_edit` (connector
   `passthroughStep: "read"`) to `read_page`, and `drupal_node_update` and
   `drupal_node_create_draft_revision` (`passthroughStep: "publishing"`) to the
   two publishing steps. Today the passthrough route serves neither (a 403).
2. The connector must answer a bound write's refusal as `{ok: false, code,
   message}` with a success status, instead of throwing `DrupalEditRefusal`.
   Today the host answers a thrown refusal with HTTP 500 and a fixed sentence,
   WayFlow retries the call, and a publishing-step retry is refused because the
   card decision is single use. So the step fails and the flow cannot branch on
   the code: the branches of `route_write` are inert until then.
3. A connector release that carries `drupal_node_read_for_edit` and the bound
   writes, and a raise of this pack's connector range from `^0.1.4`.

## The review: what is filed, read back and written

A change of nothing (no values, or values equal to the read) is not filed and
not reviewed: `form_page` answers `next: "no_change"`, the branch
`route_change` takes the run to `no_change_outcome` (the `reviewed_change`
tool, `op: unchanged`, which checks that again) -> `emit_output` -> `end`. The
run completes with empty `changes`, and no write is made. The reason is never
empty: the step builds it in code from the run's `instructions`, the node id
and the read title: "No change was proposed for this request on node 7
("Opening hours"), so nothing was reviewed or written: <request>", the
request flattened to one line and cut to 300 characters.

`form_page` calls `reviewed_change` (`op: form`), which builds the page
snapshot in code: the page, `writeFields` and the changed blocks the display
shows (`excerpts`), derived from `writeFields` and the read by one function,
`pageExcerpts`. A form whose `fieldsJson` would exceed the 256 KiB argument
limit is refused before it is filed.

After the review, `read_reviewed_page` takes the revision the review's answer
approves (`review.targets`), not the revision this run filed: after a
Regenerate the approved revision is a successor of the filed one. It reads that
revision through the host's artifact read port by its revision id. It refuses,
so the run fails with `reviewed_change_unavailable` before any write, when the
answer names no approved revision of the filed artifact, when the read fails,
is cut short or answers another revision or artifact, when the text is not a
Drupal page snapshot or carries no field to write, when the text shows other
blocks than the ones `pageExcerpts` derives from its values and the read, and
when the revision is not a snapshot of this run's node. One check,
`checkedSnapshot`, applies to what `form_page` files and to the approved
revision. The read-back accepts the review's answer only when `approved` is
true, `review.decision` is `approved`, `review.envelopeVersion` is 1, and
`review.targets` names exactly one revision of the filed artifact.

### What the reviewer sees of the values to write

The display (`@cinatra-ai/website-artifacts`) draws only `page` and the
`excerpts` (`published` against `proposed`), as plain text; it never draws
`writeFields`. So `pageExcerpts` splits each value into its top-level blocks
and shows each changed block as its SOURCE text on both sides: a changed link
target, attribute, tag, comment, image or script is drawn as text, and every
block not shown is byte for byte the read. It refuses, before anything is
filed, what the display cannot show: a block whose two sides differ only in
white space, more than 200 changed blocks, a changed block that holds an
invisible character (Unicode Cf, Cc except tab, line feed and carriage return,
Zs except U+0020, Zl, Zp, default ignorable characters and variation
selectors), and in the changed part of a block any white space other than a
single U+0020 between two visible characters.

## Connector tools used

| Tool | Step | Purpose |
|---|---|---|
| `drupal_node_read_for_edit` | `read_page` | Read the node, its fields and the edit binding |
| `drupal_node_create_draft_revision` | `write_draft` | Save the reviewed fields as a draft revision of a published node, if the binding still matches |
| `drupal_node_update` | `write_unpublished` | Save the reviewed fields on an unpublished node without publishing it, if the binding still matches |

These are registered by `@cinatra-ai/drupal-connector`. The agent reaches them
only through the host's passthrough road.

## Timeout

The A2A client in `chat/route.ts` uses `timeoutMs: 600_000` (10 minutes). This covers a full read, review and write cycle including any LLM latency. Do not reduce this timeout without verifying that all Drupal MCP operations complete well within the new limit.

## Local dev URL

Default WayFlow agent URL: `http://localhost:3020`. Start with:

```bash
docker compose --profile drupal up -d
```

Override via `DRUPAL_CONTENT_EDITOR_A2A_URL` in `.env.local` (e.g. `http://wayflow-drupal-content-editor:3020` when Cinatra itself runs inside Docker).
