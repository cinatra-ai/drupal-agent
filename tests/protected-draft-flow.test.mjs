import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const parts = oas.$referenced_components;
const edges = (node, input) => oas.data_flow_connections.filter((e) => e.destination_node.$component_ref === node && e.destination_input === input);
const edge = (node, input) => edges(node, input)[0];
const into = (node) => oas.control_flow_connections.filter((e) => e.to_node.$component_ref === node).map((e) => e.from_node.$component_ref);
const titles = (list) => list.map((x) => x.title);

test("the published state comes from the actual read, never caller hints", () => {
  assert.ok(titles(parts.read_page.outputs).includes("published"));
  assert.deepEqual(edges("check_read", "published").map((e) => [e.source_node.$component_ref, e.source_output]), [["read_page", "published"]]);
  assert.deepEqual(edges("route_status", "next").map((e) => [e.source_node.$component_ref, e.source_output]), [["check_read", "status"]]);
  for (const hint of ["nodeStatus", "nodeBundle"]) {
    assert.equal(oas.data_flow_connections.some((e) => e.source_node.$component_ref === "start" && e.source_output === hint), false, `${hint} feeds no step`);
  }
});

test("a published page gets one draft revision of the same node; the language and the revision come from the read's binding", () => {
  const write = parts.write_draft;
  assert.equal(write.data.tool, "drupal_node_create_draft_revision");
  assert.deepEqual(Object.keys(write.data.input).sort(), ["expectedBindingJson", "fieldsJson", "instanceId", "nodeId"], "no language, expectedFields or revision argument of its own: the binding carries them");
  assert.equal(edge("write_draft", "binding").source_node.$component_ref, "read_page");
  assert.match(write.metadata.cinatra.description, /draft revision of the same node/);
  assert.match(write.metadata.cinatra.description, /live page stays as it is/);
});

test("the settled atomic-edit contract: one write per run turn, never a generic update after a draft, never a publish", () => {
  assert.deepEqual(oas.control_flow_connections.filter((e) => e.from_node.$component_ref === "write_draft").map((e) => e.to_node.$component_ref), ["write_outcome"]);
  assert.deepEqual(oas.control_flow_connections.filter((e) => e.from_node.$component_ref === "write_unpublished").map((e) => e.to_node.$component_ref), ["write_outcome"]);
  assert.deepEqual(into("write_unpublished"), ["route_status"], "the update is reached only from the branch, never after the draft");
  assert.equal(parts.route_status.mapping.draft, "draft");
  assert.equal(oas.control_flow_connections.find((e) => e.from_node.$component_ref === "route_status" && e.from_branch === "draft").to_node.$component_ref, "write_unpublished");
  assert.equal(JSON.stringify(oas).includes("drupal_node_publish"), false, "the flow never publishes");
  assert.equal(JSON.stringify(oas).includes("separate page"), false);
});

test("refused, held or failed writes have a declared visible reason through the real output road", () => {
  for (const [node, key] of [["write_outcome", "outputs"], ["emit_output", "inputs"], ["end", "outputs"]]) {
    assert.equal(parts[node][key].find((x) => x.title === "reason")?.type, "string");
    assert.equal(parts[node][key].find((x) => x.title === "error")?.type, "object");
  }
  assert.equal(oas.outputs.find((x) => x.title === "reason")?.type, "string");
  for (const node of ["emit_output", "end"]) {
    assert.deepEqual(
      edges(node, "reason").map((e) => e.source_node.$component_ref).sort(),
      ["no_change_outcome", "write_outcome"],
    );
  }
  assert.match(parts.emit_output.message, /reason\s*\|\s*tojson/);
  assert.match(parts.emit_output.message, /error\s*\|\s*tojson/);
});

test("human review, no-change guard and repair scope remain; a request to publish is refused before the review", () => {
  assert.deepEqual(into("read_reviewed_page"), ["page_review_gate"]);
  assert.deepEqual(into("route_status"), ["read_reviewed_page"]);
  const text = parts.compose_change.data.system;
  assert.match(text, /reviewer finding is never a publish request/);
  assert.match(text, /Apply only changes explicitly requested/);
  assert.match(text, /Repair-shaped tasks/);
  assert.match(text, /never publishes/);
});
