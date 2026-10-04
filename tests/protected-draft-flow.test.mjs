import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const parts = oas.$referenced_components;
const edge = (node, input) => oas.data_flow_connections.find((e) => e.destination_node.$component_ref === node && e.destination_input === input);
const titles = (list) => list.map((x) => x.title);
test("published status and bundle come from the actual node read, never caller hints", () => {
  for (const name of ["nodeStatus", "nodeBundle", "error"]) {
    assert.ok(titles(parts.read_node.outputs).includes(name));
    assert.equal(edge("load_node", name).source_node.$component_ref, "read_node");
    assert.equal(edge("load_node", name).source_output, name);
  }
  assert.match(parts.read_node.data.system, /unknown/);
  assert.match(parts.load_node.data.system, /caller.*hint/i);
});
test("the settled atomic-edit contract removes the unsafe draft-then-generic-update sequence", () => {
  const text = parts.load_node.data.system;
  assert.match(text, /drupal_node_create_draft_revision.*instanceId.*nodeId.*fields/);
  assert.match(text, /ONE atomic/);
  assert.match(text, /Never.*drupal_node_update.*after.*draft/i);
  assert.doesNotMatch(text, /draft-revision-then-update|draft-revision → update|BEFORE drupal_node_update/);
  assert.match(text, /no moderation|moderation workflow/i);
  assert.match(text, /never.*new node/i);
  assert.match(text, /actual.*revision/i);
});
test("unsupported, held or failed writes have a declared visible reason through the real output road", () => {
  for (const [node, key] of [["load_node", "outputs"], ["emit_output", "inputs"], ["end", "outputs"]]) {
    assert.equal(parts[node][key].find((x) => x.title === "reason")?.type, "string");
  }
  assert.equal(oas.outputs.find((x) => x.title === "reason")?.type, "string");
  for (const node of ["emit_output", "end"]) {
    assert.equal(edge(node, "reason").source_node.$component_ref, "load_node");
    assert.equal(edge(node, "reason").source_output, "reason");
  }
  assert.match(parts.emit_output.message, /reason\s*\|\s*tojson/);
  assert.match(parts.load_node.data.system, /REFUSAL RESULT/);
  assert.match(parts.load_node.data.system, /pending_review/);
  assert.match(parts.load_node.data.system, /reason.*empty.*success/i);
});
test("human review, no-change guard, repair scope and explicit-only publish remain", () => {
  assert.deepEqual(oas.control_flow_connections.filter((e) => e.to_node.$component_ref === "load_node").map((e) => e.from_node.$component_ref), ["page_review_gate"]);
  const text = parts.load_node.data.system;
  assert.match(text, /NO-CHANGE RESULT/);
  assert.match(text, /reviewer finding.*never.*publish request/i);
  assert.match(text, /only.*fields.*explicitly/i);
  assert.match(text, /Never.*proposalId.*earlier/i);
});
