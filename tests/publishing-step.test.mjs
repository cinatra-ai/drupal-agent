// cinatra-ai/cinatra#3745 — the two writes are the flow's publishing steps.
//
// `write_draft` saves the reviewed change of a page read as published as a
// draft revision of the same node (`drupal_node_create_draft_revision`), and
// `write_unpublished` saves the reviewed change of a page read as unpublished
// without publishing it (`drupal_node_update`). A branch on the status as read
// takes a run to exactly one of them. The host serves a connector tool
// declared `passthroughStep: "publishing"` only to a top-level publishing step
// of the run's flow, `metadata.cinatra.publishes: true`, whose card a person
// released, and requires the step to name its tool as a literal (the host's
// `publishingPassthroughTool`). A flow step cannot choose a tool at run time,
// so the two tools are two steps. Each declares the rows its publish card
// shows. The application opens that card only after an approved artifact
// review earlier in the same run; `page_review_gate` is that review. Between
// the review and the write, `read_reviewed_page` reads back the revision the
// person approved, and the write sends only the values of that text.
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

const WRITE_STEPS = ["write_draft", "write_unpublished"];
const TOOL_OF = { write_draft: "drupal_node_create_draft_revision", write_unpublished: "drupal_node_update" };
const REVIEW_STEP = "page_review_gate";
const REVIEWED_READ = "read_reviewed_page";
const ROUTE = "route_status";
const ACTION_KINDS = ["ApiNode", "AgentNode", "FlowNode", "ParallelFlowNode"];
const NO_CONNECTOR_KINDS = ["StartNode", "EndNode", "InputMessageNode", "OutputMessageNode", "BranchingNode"];

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

test("the two writes are the steps declared publishes: true, top-level action nodes", () => {
  const publishing = topLevelIds().filter((id) => cinatraOf(parts[id]).publishes === true);
  assert.deepEqual(publishing, WRITE_STEPS);
  for (const step of WRITE_STEPS) {
    assert.ok(ACTION_KINDS.includes(parts[step].component_type));
    assert.notEqual(cinatraOf(parts[step]).requiresApproval, true, "the publish card is the one approval in front of it");
  }
  assert.equal(cinatraOf(oas).publishes, undefined, "the flow root declares no publishes");
});

test("each write step is the one step that names its site write tool, and no step names drupal_node_publish", () => {
  for (const [step, tool] of Object.entries(TOOL_OF)) {
    const callers = topLevelIds().filter((id) => JSON.stringify(parts[id]).includes(tool));
    assert.deepEqual(callers, [step], `${tool} is named by ${step} only`);
  }
  assert.deepEqual(topLevelIds().filter((id) => JSON.stringify(parts[id]).includes("drupal_node_publish")), []);
});

test("each publish card shows four rows of the step's own inputs, the node id under a label that states the save", () => {
  for (const step of WRITE_STEPS) {
    const rows = cinatraOf(parts[step]).publishRows;
    const inputs = Object.fromEntries(parts[step].inputs.map((input) => [input.title, input]));
    assert.equal(rows.length, 4, "the card holds at most four rows");
    for (const row of rows) {
      assert.ok(has(inputs, row.input), `${step}: ${row.input} is an input of the step`);
      assert.ok(row.label.length >= 1 && row.label.length <= 60 && !row.label.includes("\n") && row.label === row.label.trim());
    }
    const nodeRow = rows.find((row) => row.input === "nodeId");
    assert.ok(nodeRow, `${step}: a row shows the node id the write addresses`);
    assert.match(nodeRow.label, step === "write_draft" ? /draft revision/ : /not published/);
    assert.ok(rows.some((row) => row.kind === "artifacts" && row.input === "reviewedSnapshot"), `${step}: the card shows the reviewed revision`);
  }
  assert.deepEqual(carriersOf("publishRows"), [...WRITE_STEPS].sort(), "no other component carries publishRows");
});

// Two nodes of one site can share a title, so the title alone does not name
// the node the write reaches: the card shows the node id, the same value the
// write sends.
test("the card names the node by the id the write sends, from the read", () => {
  for (const step of WRITE_STEPS) {
    const into = oas.data_flow_connections
      .filter((edge) => edge.destination_node.$component_ref === step && edge.destination_input === "nodeId")
      .map((edge) => [edge.source_node.$component_ref, edge.source_output]);
    assert.deepEqual(into, [["read_page", "nodeId"]], `${step}: the node id shown is the node id as read`);
    assert.equal(parts[step].data.input.nodeId, "{{ nodeId }}", `${step}: the write sends that node id`);
  }
});

test("every other step that can reach a connector declares publishes false or is read only", () => {
  for (const id of topLevelIds()) {
    if (WRITE_STEPS.includes(id)) continue;
    const step = parts[id];
    if (NO_CONNECTOR_KINDS.includes(step.component_type)) continue;
    const cinatra = cinatraOf(step);
    if (cinatra.riskClass === "read_only" && !has(cinatra, "publishes")) continue;
    assert.equal(cinatra.publishes, false, `${id} declares publishes false`);
  }
  assert.equal(cinatraOf(parts.file_page).publishes, false);
  assert.equal(cinatraOf(parts.gather_page_review).publishes, false);
  assert.deepEqual(carriersOf("publishes").filter((id) => cinatraOf(parts[id]).publishes === true), [...WRITE_STEPS].sort());
});

test("an approved artifact review comes before each write, with only the read-back and the branch between", () => {
  const into = (id) => oas.control_flow_connections.filter((edge) => edge.to_node.$component_ref === id).map((edge) => edge.from_node.$component_ref);
  for (const step of WRITE_STEPS) assert.deepEqual(into(step), [ROUTE]);
  assert.deepEqual(into(ROUTE), [REVIEWED_READ]);
  assert.deepEqual(into(REVIEWED_READ), [REVIEW_STEP]);
  assert.equal(cinatraOf(parts[REVIEWED_READ]).riskClass, "read_only", "the step between reaches no connector");
  assert.equal(parts[ROUTE].component_type, "BranchingNode");
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
