import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flow = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const startRef = flow.start_node.$component_ref;
const start = flow.$referenced_components[startRef];
const hasDefault = (input) => Object.hasOwn(input, "default");

// The install rule reads Flow defaults and the StartNode's required/hidden lists.
// Keep this package's declarations ready for that rule without importing the host.
function unresolvedVisibleInputs(candidate) {
  const node = candidate.$referenced_components[candidate.start_node.$component_ref];
  const { required = [], hidden = [] } = node.metadata?.cinatra ?? {};
  return candidate.inputs
    .filter((input) => !hidden.includes(input.title)
      && !required.includes(input.title) && !hasDefault(input))
    .map((input) => input.title);
}

test("every visible start input has a default or a required declaration", () => {
  assert.deepEqual(unresolvedVisibleInputs(flow), []);
  for (const input of flow.inputs) {
    const entry = start.inputs.find((item) => item.title === input.title);
    assert.ok(entry, `${input.title} reaches the start node`);
    assert.equal(entry.type, input.type);
    if (!start.metadata.cinatra.hidden.includes(input.title)) {
      assert.ok(input.description, `${input.title} carries a setup explanation`);
    }
    assert.equal(hasDefault(entry), hasDefault(input), `${input.title} default presence agrees`);
    assert.deepEqual(entry.default, input.default, `${input.title} default value agrees`);
    assert.equal(entry.description, input.description, `${input.title} setup explanation agrees`);
  }
});

const required = ["instanceId", "nodeId", "instructions"];
const defaults = { nodeBundle: "", nodeStatus: "" };

for (const title of required) {
  test(`${title} is required and is never replaced by an empty default`, () => {
    assert.ok(start.metadata.cinatra.required?.includes(title));
    const input = flow.inputs.find((item) => item.title === title);
    assert.equal(hasDefault(input), false);
    assert.match(input.description, title === "instructions" ? /Describe.*change/i : /Enter.*ID/i);
    const missing = structuredClone(flow);
    missing.$referenced_components[startRef].metadata.cinatra.required = required.filter((item) => item !== title);
    assert.ok(unresolvedVisibleInputs(missing).includes(title));
  });
}
for (const [title, value] of Object.entries(defaults)) {
  test(`${title} has the flow's safe fallback and remains optional`, () => {
    assert.ok(!start.metadata.cinatra.required?.includes(title));
    assert.equal(flow.inputs.find((item) => item.title === title).default, value);
    const missing = structuredClone(flow);
    delete missing.inputs.find((item) => item.title === title).default;
    assert.ok(unresolvedVisibleInputs(missing).includes(title));
  });
}

test("the bundle and status hints feed no step; the edit step takes both from the actual read", () => {
  const hints = Object.keys(defaults);
  const fromStart = flow.data_flow_connections.filter((edge) =>
    edge.source_node.$component_ref === startRef && hints.includes(edge.source_output));
  assert.deepEqual(fromStart, []);
  for (const title of hints) {
    const edge = flow.data_flow_connections.find((item) =>
      item.destination_node.$component_ref === "load_node" && item.destination_input === title);
    assert.equal(edge.source_node.$component_ref, "read_node");
    assert.equal(edge.source_output, title);
  }
  const { read_node, load_node } = flow.$referenced_components;
  assert.match(read_node.data.system, /Never copy a caller hint/);
  assert.match(load_node.data.system, /Caller status and bundle hints are not authority/);
});
