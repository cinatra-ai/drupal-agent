import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const flow = oas.$referenced_components.load_node.data.system;
test("the README names the published-edit call the flow makes", () => {
  assert.match(flow, /drupal_node_create_draft_revision/);
  assert.match(readme, /drupal_node_create_draft_revision/);
  assert.match(readme, /draft revision of the SAME node/);
});
test("the README does not describe every published edit as refused", () => {
  assert.doesNotMatch(readme, /This version refuses those edits|currently returns the protected-edit refusal/);
});
