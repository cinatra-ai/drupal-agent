// cinatra-ai/cinatra#3745 — the write step is the flow's one publishing step.
//
// `load_node` writes the reviewed fields to the Drupal site and, on the
// person's explicit request, publishes the node through `drupal_node_publish`.
// On an agent run the application refuses every call of that tool (its
// registration declares `outward`) unless the run's top-level publishing step,
// `metadata.cinatra.publishes: true`, has a person's released publish
// decision. So `load_node` declares it, with the rows the publish card shows.
// The application opens that card only after an approved artifact review
// earlier in the same run; `page_review_gate` is that review. Between the
// review and the write, `read_reviewed_page` reads back the revision the
// person approved, and the write step writes only the values of that text. The card names the node by its site, its id and its
// title: two nodes of one site can share a title, never an id. Before any
// site write, the write step reads the node again and writes nothing when it
// changed during the review.
//
// These cases restate the readers' rules over this flow: the application's
// compiler (cinatra-ai/cinatra, packages/agents/src/oas-compiler.ts,
// `collectPublishingSteps` and `collectPublishRows`) and the pack check
// (cinatra-ai/ci, scripts/agent-publish-gate.mjs). They run neither reader.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra", "oas.json"), "utf8"));
const parts = oas.$referenced_components;

const WRITE_STEP = "load_node";
const REVIEW_STEP = "page_review_gate";
const REVIEWED_READ = "read_reviewed_page";
const SITE_WRITE_TOOLS = ["drupal_node_publish", "drupal_node_update", "drupal_node_create_draft_revision"];
const ACTION_KINDS = ["ApiNode", "AgentNode", "FlowNode", "ParallelFlowNode"];
const NO_CONNECTOR_KINDS = ["StartNode", "EndNode", "InputMessageNode", "OutputMessageNode", "BranchingNode"];
const REQUEST_LABEL = "Requested change (a request to publish makes the node live)";
const ROWS = [
  { label: "Drupal site", input: "instanceId" },
  { label: "Node ID", input: "nodeId" },
  { label: "Current title", input: "title" },
  { label: REQUEST_LABEL, input: "instructions" },
];

const cinatraOf = (component) => component?.metadata?.cinatra ?? {};
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const topLevelIds = () => oas.nodes.map((entry) => entry.$component_ref);

/** Every object in the flow that carries `key` under `metadata.cinatra`. */
function carriersOf(key) {
  const found = [];
  const stack = [["(root)", oas]];
  while (stack.length > 0) {
    const [name, value] = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push([name, item]);
      continue;
    }
    if (has(cinatraOf(value), key)) found.push(value.id ?? name);
    for (const [childKey, child] of Object.entries(value)) stack.push([childKey, child]);
  }
  return found.sort();
}

test("the write step is the one step declared publishes: true, a top-level action node", () => {
  const publishing = topLevelIds().filter((id) => cinatraOf(parts[id]).publishes === true);
  assert.deepEqual(publishing, [WRITE_STEP]);
  assert.ok(ACTION_KINDS.includes(parts[WRITE_STEP].component_type));
  assert.equal(cinatraOf(oas).publishes, undefined, "the flow root declares no publishes");
  assert.notEqual(cinatraOf(parts[WRITE_STEP]).requiresApproval, true, "the publish card is the one approval in front of it");
});

test("the write step is the one step that names a site write tool", () => {
  for (const tool of SITE_WRITE_TOOLS) {
    const callers = topLevelIds().filter((id) => JSON.stringify(parts[id]).includes(tool));
    assert.deepEqual(callers, [WRITE_STEP], `${tool} is named by the write step only`);
  }
});

test("the publish card shows the site, the node id, the current title and the requested change", () => {
  const rows = cinatraOf(parts[WRITE_STEP]).publishRows;
  assert.deepEqual(rows, ROWS);
  const inputs = Object.fromEntries(parts[WRITE_STEP].inputs.map((input) => [input.title, input]));
  for (const row of ROWS) {
    assert.ok(has(inputs, row.input), `${row.input} is an input of the write step`);
    assert.ok(row.label.length >= 1 && row.label.length <= 60 && row.label === row.label.trim());
  }
  assert.ok(rows.length <= 4, "the card holds at most four rows");
  assert.deepEqual(carriersOf("publishRows"), [WRITE_STEP], "no other component carries publishRows");
});

// Two nodes of one site can share a title, so the title alone does not name
// the node the write reaches: the card shows the node id, the same value the
// write step addresses.
test("the card names the node by the id the write step writes to, next to its title", () => {
  const rows = cinatraOf(parts[WRITE_STEP]).publishRows;
  const at = (input) => rows.findIndex((row) => row.input === input);
  assert.ok(at("nodeId") >= 0, "a row shows the node id");
  assert.equal(at("title"), at("nodeId") + 1, "the title row follows the node id row");
  const into = oas.data_flow_connections
    .filter((edge) => edge.destination_node.$component_ref === WRITE_STEP && edge.destination_input === "nodeId")
    .map((edge) => [edge.source_node.$component_ref, edge.source_output]);
  assert.deepEqual(into, [["start", "nodeId"]], "the node id shown is the run's node id");
  assert.ok(parts[WRITE_STEP].data.user.includes("- nodeId: {{ nodeId }}"), "the write step gets that node id");
  assert.ok(
    /drupal_node_create_draft_revision with instanceId \+ nodeId/.test(parts[WRITE_STEP].data.system),
    "the write addresses the node by that id",
  );
});

test("before any site write, the write step reads the node again and writes nothing when it changed during the review", () => {
  const into = (input) =>
    oas.data_flow_connections
      .filter((edge) => edge.destination_node.$component_ref === WRITE_STEP && edge.destination_input === input)
      .map((edge) => [edge.source_node.$component_ref, edge.source_output]);
  assert.deepEqual(into("nodeChanged"), [["read_node", "nodeChanged"]], "the change time the review was based on comes from the read step");
  assert.deepEqual(into("nodeStatus"), [["read_node", "nodeStatus"]]);
  assert.ok(parts[WRITE_STEP].data.user.includes("- nodeChanged: {{ nodeChanged }}"));
  const system = parts[WRITE_STEP].data.system;
  const rule = system.split("\n").find((line) => line.startsWith("11. ")) ?? "";
  assert.ok(rule.includes("Before any site write (drupal_node_create_draft_revision, drupal_node_update or drupal_node_publish), read the node again with drupal_node_get"));
  assert.ok(rule.includes("its status, read as the read step reads it, equals nodeStatus, nodeChanged is not empty, and this read's `changed` value (else its `revision_timestamp` value) as text EXACTLY equals nodeChanged"));
  assert.ok(rule.includes("make NO site write and return the CHANGED-DURING-REVIEW REFUSAL RESULT"));
  assert.ok(system.includes('CHANGED-DURING-REVIEW REFUSAL RESULT: {"nodeId":"7","changes":[],"reason":"The node changed on the site while the change was in review, so nothing was written; start a new run on the current node.","outcome":"refused"}'));
  const step2 = system.split("STEP 2")[1]?.split("STEP 3")[0] ?? "";
  assert.ok(step2.includes("first check that the node did not change during the review (Rule 11)"), "Step 2 checks before the write");
});

// A row shows one plain input of the step; the card has no literal or computed
// value. So the rule the write step applies sits in the label, over the value
// it decides on: the requested change is the only input that can lead to
// drupal_node_publish, and a field write goes to a draft revision of a
// published node, or to the unpublished node itself.
test("the requested change row shows the value the write step decides a publish on, under a label that states it", () => {
  const sourcesOf = (input) =>
    oas.data_flow_connections
      .filter((edge) => edge.destination_node.$component_ref === WRITE_STEP && edge.destination_input === input)
      .map((edge) => [edge.source_node.$component_ref, edge.source_output]);
  assert.deepEqual(sourcesOf("instructions"), [["start", "instructions"]], "the request comes only from the start input");
  assert.deepEqual(sourcesOf("nodeStatus"), [["read_node", "nodeStatus"]], "the status comes only from the read step");
  const { system, user } = parts[WRITE_STEP].data;
  assert.ok(user.includes("- instructions: {{ instructions }}"), "the write step gets the request");
  assert.ok(
    system.includes("An explicit user publish request remains allowed through drupal_node_publish"),
    "the write step publishes on an explicit request",
  );
  assert.ok(
    system.includes("Publishing is never automatic: call drupal_node_publish only on an explicit user publish request"),
    "the write step publishes on nothing else",
  );
  assert.ok(REQUEST_LABEL.includes("publish") && REQUEST_LABEL.includes("live"));
  assert.ok(
    system.includes("A published node is edited through ONE atomic call to drupal_node_create_draft_revision"),
    "a field write to a published node goes to a draft revision",
  );
  assert.ok(
    system.includes("Only a node actually read as draft can use drupal_node_update"),
    "a direct field write reaches only a draft node",
  );
});

test("every other step that can reach a connector declares publishes false or is read only", () => {
  for (const id of topLevelIds()) {
    if (id === WRITE_STEP) continue;
    const step = parts[id];
    if (NO_CONNECTOR_KINDS.includes(step.component_type)) continue;
    const cinatra = cinatraOf(step);
    if (cinatra.riskClass === "read_only" && !has(cinatra, "publishes")) continue;
    assert.equal(cinatra.publishes, false, `${id} declares publishes false`);
  }
  assert.equal(cinatraOf(parts.file_page).publishes, false);
  assert.equal(cinatraOf(parts.gather_page_review).publishes, false);
  assert.deepEqual(carriersOf("publishes").filter((id) => cinatraOf(parts[id]).publishes === true), [WRITE_STEP]);
});

test("an approved artifact review comes before the write, with only the read of the reviewed revision between", () => {
  const road = topLevelIds();
  assert.deepEqual(road.slice(road.indexOf(REVIEW_STEP), road.indexOf(WRITE_STEP) + 1), [REVIEW_STEP, REVIEWED_READ, WRITE_STEP]);
  const into = (id) => oas.control_flow_connections.filter((edge) => edge.to_node.$component_ref === id).map((edge) => edge.from_node.$component_ref);
  assert.deepEqual(into(WRITE_STEP), [REVIEWED_READ]);
  assert.deepEqual(into(REVIEWED_READ), [REVIEW_STEP]);
  assert.equal(cinatraOf(parts[REVIEWED_READ]).riskClass, "read_only", "the step between reaches no connector");
  const review = parts[REVIEW_STEP];
  assert.equal(review.component_type, "InputMessageNode");
  const cinatra = cinatraOf(review);
  assert.equal(cinatra.requiresApproval, true, "the review asks a person for the approval");
  assert.equal(cinatra.artifactReview?.targetsInput, "reviewTargets");
  assert.ok(review.inputs.some((input) => input.title === "reviewTargets"));
  for (const key of ["renderer", "inputRenderers", "gateRenderer"]) assert.ok(!has(cinatra, key), `the review declares no ${key}`);
  assert.ok(!JSON.stringify(review).includes('"x-renderer"'), "the review selects no field renderer of the pack");
  assert.ok(!has(cinatraOf(oas), "hitlScreens"), "the pack keeps no screen of its own");
});
