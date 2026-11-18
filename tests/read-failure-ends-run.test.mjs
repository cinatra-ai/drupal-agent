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
// NOTHING ELSE: the whole instruction text is pinned word for word, so no
// added, changed or removed sentence can forbid or redirect a code, empty the
// code after a failure or tell the step to go on; the rest of the step (name,
// inputs, outputs and their schemas, metadata) is pinned too; and no other
// step names those codes; R2 no model step lists a completed code; R3 every
// step after the read, the settle, output and end steps among them, is
// reached only through the read step (the walk names no step but the read
// step, so a renamed step passes), and every control edge names both of its
// ends.
//
// R1 compares WORDS, not characters: case, white space, line breaks,
// backticks, quotes, bold, heading and list marks and punctuation are
// formatting and may change freely; letters (of any script), digits and the
// operator marks = ! < > ~ are words. A changed word of the read step's
// instructions fails R1 on purpose, also when it is harmless: a reworded
// instruction is a new contract, so the pinned text below changes with it,
// in the same reviewed diff.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
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

// The words of a text, in order: what R1 compares.
const wordsOf = (text) =>
  (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+(?:[-_][\p{L}\p{N}\p{M}]+)*|[=!<>~]+/gu) ?? []).join(" ");
// The sentences of a text, as words: only to name what differs.
const sentencesOf = (text) => text.split(/\n|(?<=[.!?])\s+/).map(wordsOf).filter((s) => s !== "");

// The failure contract: the `error` line of the read step's instructions, as words.
const SUCCESS = "code and message are both the empty string on a successful read";
const ASSIGN =
  "when the read says the node does not exist code is not-found " +
  "when the read fails in any other way code is read-failed";
const ON_FAILURE =
  "message then states the failure in one sentence title and body are empty strings and fieldvalues is the empty list";
const CONTRACT = `error ${SUCCESS} ${ASSIGN} ${ON_FAILURE}`;

// The read step's whole instructions, as words, one sentence per item.
const READ_SYSTEM = [
  "you are the drupal content reader",
  "read the specified node and hand its current values to the next step",
  "you change nothing on the site",
  "rules",
  "1",
  "call drupal_node_get first to read current content before any changes",
  "steps",
  "step 1 load node call drupal_node_get with instanceid nodeid",
  "capture the current value of every field the user might be editing",
  "step 2 compose the public address call drupal_instances_list and take the item whose id equals instanceid",
  "take its siteurl remove every trailing slash then append node and the node id",
  "when no item matches or the site address does not start with https the address is the empty string",
  "what each output field holds",
  "title the node s title as the read answers it",
  "body the raw source markup of body exactly as the read answers it the empty string when the read carries no body",
  "fieldvalues one item per field of the read whose name starts with field and whose value is text field is the field name and value its value as text",
  "address the node s public address from step 2",
  "nodestatus from this actual read only published for status true 1 1 or published draft for false 0 0 unpublished or draft unknown otherwise including any failed read",
  "never copy a caller hint",
  "nodebundle the actual read s bundle string or the empty string when absent or the read failed",
  "nodelanguage the actual read s langcode only when it is a non-empty language code of letters digits underscores or hyphens otherwise the empty string",
  "never copy a caller hint or guess the site default",
  "a failed read always returns the empty string",
  `error ${SUCCESS}`,
  ASSIGN,
  ON_FAILURE,
  "how inputs arrive",
  "inputs are injected via the flow conversation history",
  "read instanceid and nodeid from the most recent user message",
  "what to never do",
  "never write to the site this step only reads",
  "never invent a field or a value hand over only what the read answered",
];
const READ_USER = [
  "inputs",
  "instanceid instanceid",
  "nodeid nodeid",
  "follow the steps in the system instructions read the node with drupal_node_get compose its public address from drupal_instances_list and fill the declared output fields",
];
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

// Fails unless the words of `text` are exactly the pinned sentences; names the sentences that differ.
const assertWords = (text, pinned, what) => {
  const got = sentencesOf(text);
  assert.ok(
    wordsOf(text) === pinned.join(" "),
    `${what} are exactly the pinned instructions; ` +
      `added or changed: ${JSON.stringify(got.filter((s) => !pinned.includes(s)))}; ` +
      `missing or changed: ${JSON.stringify(pinned.filter((s) => !got.includes(s)))}`,
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
  const words = wordsOf(data.system);
  // The contract, named: the success sentence, the assignment and the failure answer, in one `error` line.
  assert.ok(
    words.includes(`error ${SUCCESS}`),
    "a successful read answers the empty code, so a success is never stopped",
  );
  assert.ok(
    words.includes(ASSIGN),
    "the instructions assign not-found to a node that does not exist and read-failed to any other failed read",
  );
  assert.equal(words.split(CONTRACT).length - 1, 1, "the three sentences are the one `error` line, in order");
  // The only-instruction half: the whole text is the pinned one, so the contract is the only sentence on
  // the codes, the code and message fields, an empty code after a failure or going on after one.
  assertWords(data.system, READ_SYSTEM, "the read step's instructions");
  assertWords(data.user, READ_USER, "the read step's input template");
  for (const code of FAILURE_CODES) {
    assert.equal(words.split(code).length - 1, 1, `${code} occurs once in the read step's instructions, in the assignment`);
  }
  // No other step, and nothing outside the steps, names the read step's failure codes.
  const elsewhere = stringsOf({ ...oas, $referenced_components: { ...parts, [READ]: undefined } }, "")
    .filter(([, text]) => NAMES_A_FAILURE_CODE.test(text))
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
