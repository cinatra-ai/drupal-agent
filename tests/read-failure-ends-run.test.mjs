// A read that answers a failure ends the run at the read and files no page.
//
// The read step (read_node) is a model step on the application's model
// bridge. On a failed read it answers a non-empty `error.code`: `not-found`
// or `read-failed`. The application ends a model step, and so the run, as
// failed when the step answers a non-empty top-level `error.code`, unless the
// step's data lists that code in `completed_error_codes`. This pack lists no
// such code on any model step, and the read step runs before the filing step
// on the one road of the flow, so a failed read files no page snapshot.
//
// Three arms: R1 the read step declares the error output, its instructions
// hold the failure contract (the empty code on a success, `not-found` for a
// node that does not exist, `read-failed` for any other failed read) and
// NOTHING ELSE: the instructions and the input template are pinned byte for
// byte (see below), so no added, changed, moved or removed character can
// forbid or redirect a code, empty the code after a failure, invert a
// condition or tell the step to go on; the rest of the step (name, inputs,
// outputs and their schemas, metadata) is pinned too, the step's data holds
// no other key, and no other step names those codes; R2 no model step lists a
// completed code; R3 every step after the read, the settle, output and end
// steps among them, is reached only through the read step (the walk names no
// step but the read step, so a renamed step passes), and every control edge
// names both of its ends.
//
// R1 is an allow-list over ALL of the text, never a deny-list over classes of
// characters: the only change it forgives is the length of a run of white
// space (space, tab, carriage return, line feed), which collapses to one
// space before the comparison. Case, punctuation, symbols, quotes, backticks,
// list, heading and bold marks, sentence boundaries, letters of every script,
// every other character (any non-ASCII one, zero-width and other-width white
// space included) and any text before, after or between the pinned words
// count: a reformat or a rewording fails on purpose, also when it is
// harmless. Changing the flow's instructions means changing the pinned text
// and its named sha256 below, in the same reviewed diff.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));
const parts = oas.$referenced_components ?? {};

const LLM_BRIDGE_PATH = "/api/llm-bridge";
const READ = "read_node";
// The read step's failure codes, and any spelling of them (a space, hyphen or underscore between the words).
const FAILURE_CODES = ["not-found", "read-failed"];
const NAMES_A_FAILURE_CODE = /not[\s_-]*found|read[\s_-]*failed/i;

// What R1 compares: runs of space, tab, CR and LF become one space; nothing else is normalised.
const collapse = (text) => text.replace(/[ \t\r\n]+/g, " ");
const sha256Of = (text) => createHash("sha256").update(text, "utf8").digest("hex");
// Where two collapsed texts first differ, for the failure message.
const firstDifference = (got, pinned) => {
  let at = 0;
  while (at < got.length && at < pinned.length && got[at] === pinned[at]) at += 1;
  const cut = (text) => JSON.stringify(text.slice(Math.max(0, at - 30), at + 50));
  return `at character ${at}: the flow has ${cut(got)}, the pin has ${cut(pinned)}`;
};
// Every character outside printable ASCII (white space of the four kinds aside), as code points.
const nonAsciiOf = (text) =>
  [...new Set(text.match(/[^\x20-\x7e\t\r\n]/gu) ?? [])]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
    .sort();
// The only non-ASCII character of the read step's texts: the em dash of the `error` line.
const NON_ASCII_ALLOWED = ["U+2014"];

// The failure contract: the `error` line of the read step's instructions.
const SUCCESS = "`code` and `message` are both the empty string on a successful read.";
const ASSIGN =
  "When the read says the node does not exist, `code` is `not-found`; " +
  "when the read fails in any other way, `code` is `read-failed`.";
const ON_FAILURE =
  "`message` then states the failure in one sentence, `title` and `body` are empty strings and `fieldValues` is the empty list.";
const CONTRACT = "- `error` \u2014 " + [SUCCESS, ASSIGN, ON_FAILURE].join(" ");

// The pin: the read step's instructions and its input template, one line of the flow's text per item, as the flow
// holds them (the em dash is written as a u-escape, so this file stays ASCII). R1 compares the flow's text with it byte
// for byte once runs of white space are collapsed; the sha256 of the collapsed pinned text is named next to it, so a
// changed pin shows in the diff as a changed text AND a changed digest.
const READ_SYSTEM = [
  "You are the Drupal content reader. Read the specified node and hand its current values to the next step. You change nothing on the site.",
  "",
  "## Rules",
  "",
  "1. Call `drupal_node_get` first to read current content before any changes.",
  "",
  "## Steps",
  "",
  "**STEP 1 \u2014 Load node:** Call `drupal_node_get` with `instanceId` + `nodeId`. Capture the current value of every field the user might be editing.",
  "",
  "**STEP 2 \u2014 Compose the public address:** Call `drupal_instances_list` and take the item whose `id` equals `instanceId`. Take its `siteUrl`, remove every trailing slash, then append `/node/` and the node id. When no item matches, or the site address does not start with `https://`, the address is the empty string.",
  "",
  "## What each output field holds",
  "",
  "- `title` \u2014 the node's title as the read answers it.",
  "- `body` \u2014 the raw source markup of `body` exactly as the read answers it; the empty string when the read carries no `body`.",
  "- `fieldValues` \u2014 one item per field of the read whose name starts with `field_` and whose value is text: `field` is the field name and `value` its value as text.",
  "- `address` \u2014 the node's public address from STEP 2.",
  "- `nodeStatus` \u2014 from this actual read only: `published` for status true, 1, \"1\" or \"published\"; `draft` for false, 0, \"0\", \"unpublished\" or \"draft\"; `unknown` otherwise (including any failed read). Never copy a caller hint.",
  "- `nodeBundle` \u2014 the actual read's `bundle` string, or the empty string when absent or the read failed.",
  "- `nodeLanguage` \u2014 the actual read's `langcode` only, when it is a non-empty language code of letters, digits, underscores or hyphens; otherwise the empty string. Never copy a caller hint or guess the site default. A failed read always returns the empty string.",
  "- `error` \u2014 `code` and `message` are both the empty string on a successful read. When the read says the node does not exist, `code` is `not-found`; when the read fails in any other way, `code` is `read-failed`. `message` then states the failure in one sentence, `title` and `body` are empty strings and `fieldValues` is the empty list.",
  "",
  "## How inputs arrive",
  "",
  "Inputs are injected via the flow conversation history. Read `instanceId` and `nodeId` from the most recent user message.",
  "",
  "## What to NEVER do",
  "",
  "- Never write to the site: this step only reads.",
  "- Never invent a field or a value: hand over only what the read answered.",
].join("\n");
const READ_SYSTEM_SHA256 = "2d970a0c0edbf505f54227b3e8a3d63b2e615cb760daf88d4e63a80a6371b10b";
const READ_USER = [
  "Inputs:",
  "- instanceId: {{ instanceId }}",
  "- nodeId: {{ nodeId }}",
  "",
  "Follow the steps in the system instructions: read the node with drupal_node_get, compose its public address from drupal_instances_list, and fill the declared output fields.",
].join("\n");
const READ_USER_SHA256 = "96f6f9943b53f42a9241d252ee140eb26cdf055c3d2e797b93151baaf778dbc1";

// The keys of the read step's data: a new key could carry an instruction R1 does not read.
const READ_DATA_KEYS = ["agent_id", "agent_run_id", "cinatra_llm", "system", "user"];
// The rest of the read step (its name, inputs, outputs and their schemas, metadata; the data without the two texts
// and the model choice): a description, default, const or enum there could steer the answer as a sentence could.
const READ_STEP_REST = {
  component_type: "ApiNode",
  id: "read_node",
  name: "Read the page",
  url: "{{CINATRA_BASE_URL}}/api/llm-bridge",
  http_method: "POST",
  data: { agent_id: "drupal-content-editor", agent_run_id: "{{ agent_run_id }}" },
  inputs: [
    { title: "instanceId", type: "string" },
    { title: "nodeId", type: "string" },
    { title: "agent_run_id", type: "string" },
  ],
  outputs: [
    { title: "title", type: "string" },
    { title: "body", type: "string" },
    { title: "fieldValues", type: "array", json_schema: { items: { type: "object", properties: { field: { type: "string" }, value: { type: "string" } } } } },
    { title: "address", type: "string" },
    { title: "error", type: "object", json_schema: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } },
    { title: "nodeStatus", type: "string" },
    { title: "nodeBundle", type: "string" },
    { title: "nodeLanguage", type: "string" },
  ],
  metadata: { cinatra: { riskClass: "read_only", requiresApproval: false, packageName: "@cinatra-ai/drupal-agent" } },
};

// Fails unless `text` is the pinned text byte for byte once runs of white space are collapsed.
const assertPinned = (text, pinned, sha256, what) => {
  const want = collapse(pinned);
  assert.equal(sha256Of(want), sha256, `${what}: the pinned text and its named sha256 belong together (change both, on purpose)`);
  const got = collapse(text);
  assert.ok(
    got === want,
    `${what} are the pinned text byte for byte once runs of white space are collapsed; ` +
      `the flow's text has sha256 ${sha256Of(got)}, the pin names ${sha256}; first difference ${firstDifference(got, want)}`,
  );
};

// Every string of a value, with its path.
const stringsOf = (value, at, out = []) => {
  if (typeof value === "string") out.push([at, value]);
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) stringsOf(inner, `${at}/${key}`, out);
  }
  return out;
};

const bridgeSteps = Object.entries(parts).filter(
  ([, node]) =>
    node.component_type === "ApiNode" &&
    typeof node.url === "string" &&
    node.url.endsWith(LLM_BRIDGE_PATH),
);

test("R1: the read step answers a failure in its error output, by its failure contract alone", () => {
  const node = parts[READ];
  assert.ok(node, "the read step keeps its id");
  assert.ok(
    bridgeSteps.some(([id]) => id === READ),
    "the read step is a model step on the bridge, where a failure code ends the step",
  );
  const error = (node.outputs ?? []).find((output) => output.title === "error");
  assert.ok(error, "the read step declares an error output");
  assert.equal(error.json_schema?.type, "object", "the error output is an object");
  assert.equal(
    error.json_schema?.properties?.code?.type,
    "string",
    "the error output carries a string code",
  );
  const data = node.data ?? {};
  assert.deepEqual(Object.keys(data).sort(), READ_DATA_KEYS, "the read step's data has no other key");
  assert.equal(typeof data.system, "string", "the read step has its instructions");
  assert.equal(typeof data.user, "string", "the read step has its input template");
  const { system, user, cinatra_llm: llm, ...dataRest } = data;
  assert.deepEqual({ ...node, data: dataRest }, READ_STEP_REST, "the read step's name, inputs, outputs, schemas and metadata are the pinned ones");
  assert.deepEqual(Object.keys(llm ?? {}).sort(), ["preferredModel", "preferredProvider"], "the model choice has its two keys");
  for (const value of Object.values(llm)) assert.match(value, /^[\w.:\/-]+$/, "the model choice holds names only");
  // Any non-ASCII character is named: the em dash of the `error` line is the only one the texts may hold.
  assert.deepEqual(nonAsciiOf(data.system), NON_ASCII_ALLOWED, "the instructions hold no non-ASCII character but the em dash");
  assert.deepEqual(nonAsciiOf(data.user), [], "the input template holds no non-ASCII character");
  assert.deepEqual(nonAsciiOf(READ_SYSTEM), NON_ASCII_ALLOWED, "the pinned instructions hold no non-ASCII character but the em dash");
  assert.deepEqual(nonAsciiOf(READ_USER), [], "the pinned input template holds no non-ASCII character");
  const text = collapse(data.system);
  // The contract, named: the success sentence, the assignment and the failure answer, in one `error` line.
  assert.ok(text.includes(SUCCESS), "a successful read answers the empty code, so a success is never stopped");
  assert.ok(
    text.includes(ASSIGN),
    "the instructions assign not-found to a node that does not exist and read-failed to any other failed read",
  );
  assert.equal(text.split(CONTRACT).length - 1, 1, "the three sentences are the one `error` line, in order");
  // The only-instruction half: the whole text is the pinned one, byte for byte once runs of white space are
  // collapsed, so the contract is the only sentence on the codes, the code and message fields, an empty code
  // after a failure or going on after one, and no character, mark or symbol can change what a sentence says.
  assertPinned(data.system, READ_SYSTEM, READ_SYSTEM_SHA256, "the read step's instructions");
  assertPinned(data.user, READ_USER, READ_USER_SHA256, "the read step's input template");
  for (const code of FAILURE_CODES) {
    assert.equal(text.split(code).length - 1, 1, `${code} occurs once in the read step's instructions, in the assignment`);
  }
  // No other step, and nothing outside the steps, names the read step's failure codes.
  const elsewhere = stringsOf({ ...oas, $referenced_components: { ...parts, [READ]: undefined } }, "")
    .filter(([, value]) => NAMES_A_FAILURE_CODE.test(value))
    .map(([at]) => at);
  assert.deepEqual(elsewhere, [], "no text outside the read step names not-found or read-failed");
});


test("R2: no model step lists a completed code", () => {
  assert.deepEqual(
    bridgeSteps.map(([id]) => id).sort(),
    ["compose_change", "load_node", "read_node"],
    "the flow has three model steps",
  );
  for (const [id, node] of bridgeSteps) {
    assert.equal(
      "completed_error_codes" in (node.data ?? {}),
      false,
      `${id} lists no completed code, so a failure code of ${id} ends the run failed`,
    );
  }
});

test("R3: every step after the read step is reached only through the read step", () => {
  const edges = oas.control_flow_connections ?? [];
  const startId = oas.start_node?.$component_ref;
  assert.ok(startId, "the flow names its start node");
  // Fail closed: an edge that names no target or no source is not skipped.
  for (const edge of edges) {
    assert.ok(
      edge.from_node?.$component_ref && edge.to_node?.$component_ref,
      `control edge ${edge.name} names both of its ends`,
    );
  }
  // Every node reachable from the start without passing the read step.
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const edge of edges) {
      if (edge.from_node.$component_ref !== from) continue;
      const to = edge.to_node.$component_ref;
      if (to === READ || seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  assert.ok(
    edges.some((edge) => edge.from_node.$component_ref === startId && edge.to_node.$component_ref === READ),
    "the start leads to the read step",
  );
  // No later step is named here: the walk reads edges only, so a renamed or a
  // new step passes while a bypass of the read does not.
  // The allow-list half: nothing but the start itself is reached without the
  // read step, so a new step or edge cannot bypass the read unnamed.
  assert.deepEqual(
    [...seen],
    [startId],
    "no step is reached from the start without passing the read step",
  );
});
