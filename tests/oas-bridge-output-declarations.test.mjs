// ---------------------------------------------------------------------------
// Bridge-output member declarations (drupal-agent#40).
//
// The runtime asks the model for exactly the shape this flow declares: an
// object level with no declared members is sent CLOSED and EMPTY, so a bridge
// output that declares a list or object without member fields can carry
// nothing. These tests pin the members of the one bridge output that was
// measured free-form, so a future edit cannot silently drop it back to a bare
// `{"type": "object"}`.
//
// The declared members are the ones this repository's own consumers read:
//   - `load_node / changes` — the per-entry shape the node's own system prompt
//     spells out (Rule 4 and the Step 4 result object), which the downstream
//     `emit_output` message serializes and the flow's own outputs re-export.
//
// The same array flows through three further declarations of the same value
// (the flow-level outputs, the `emit_output` inputs and the `end` outputs), so
// each one is pinned too: a declaration that holds at the node but not at the
// flow boundary leaves the graph internally inconsistent.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));

const LLM_BRIDGE_PATH = "/api/llm-bridge";

/** The members `changes[]` entries carry, per the node's own system prompt. */
const CHANGE_MEMBERS = ["field", "before", "after"];

/** Every ApiNode in the flow that targets the LLM bridge, by node id. */
function bridgeNodes(node, out = new Map()) {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) bridgeNodes(v, out);
    return out;
  }
  if (
    node.component_type === "ApiNode" &&
    typeof node.url === "string" &&
    node.url.includes(LLM_BRIDGE_PATH)
  ) {
    out.set(String(node.id ?? node.name), node);
  }
  for (const v of Object.values(node)) bridgeNodes(v, out);
  return out;
}

const nodes = bridgeNodes(oas);

function bridgeOutput(nodeId, title) {
  const node = nodes.get(nodeId);
  assert.ok(node, `bridge ApiNode '${nodeId}' is missing from the flow`);
  const output = (node.outputs ?? []).find((o) => o && o.title === title);
  assert.ok(output, `bridge node '${nodeId}' declares no output '${title}'`);
  return output;
}

/** An object level counts as declared when it names at least one member. */
function assertDeclaredMembers(where, schema, expectedKeys) {
  assert.ok(
    schema && typeof schema === "object",
    `${where}: no schema object to carry member declarations`,
  );
  const properties = schema.properties;
  assert.ok(
    properties && typeof properties === "object" && Object.keys(properties).length > 0,
    `${where}: declares no members — the runtime sends this level CLOSED and EMPTY`,
  );
  for (const key of expectedKeys) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(properties, key),
      `${where}: member '${key}' is read by a consumer but not declared`,
    );
    assert.equal(
      properties[key].type,
      "string",
      `${where}: member '${key}' should be declared as a string`,
    );
  }
}

/** Find a `changes` entry in a named list of the named component. */
function componentProperty(componentId, listKey, title) {
  const component = oas["$referenced_components"]?.[componentId];
  assert.ok(component, `component '${componentId}' is missing from the flow`);
  const entry = (component[listKey] ?? []).find((o) => o && o.title === title);
  assert.ok(entry, `component '${componentId}' declares no ${listKey} '${title}'`);
  return entry;
}

test("load_node / changes declares its item members", () => {
  const output = bridgeOutput("load_node", "changes");
  assert.equal(output.type, "array");
  assertDeclaredMembers(
    "load_node / changes items",
    output.json_schema?.items,
    CHANGE_MEMBERS,
  );
});

test("the flow's own `changes` output carries the same declaration", () => {
  const output = (oas.outputs ?? []).find((o) => o && o.title === "changes");
  assert.ok(output, "the flow declares no output 'changes'");
  assert.equal(output.type, "array");
  assertDeclaredMembers(
    "flow outputs / changes items",
    output.json_schema?.items,
    CHANGE_MEMBERS,
  );
});

test("emit_output's `changes` input carries the same declaration", () => {
  const input = componentProperty("emit_output", "inputs", "changes");
  assert.equal(input.type, "array");
  assertDeclaredMembers(
    "emit_output inputs / changes items",
    input.json_schema?.items,
    CHANGE_MEMBERS,
  );
});

test("the end node's `changes` output carries the same declaration", () => {
  const output = componentProperty("end", "outputs", "changes");
  assert.equal(output.type, "array");
  assertDeclaredMembers(
    "end outputs / changes items",
    output.json_schema?.items,
    CHANGE_MEMBERS,
  );
});
