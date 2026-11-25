// A read that fails ends the run at the read and files no page.
//
// The read step (read_page) is model-free: one call of the connector's
// drupal_node_read_for_edit on the host's passthrough road. A failed read is
// thrown by the connector, so the host answers the call with a failure status
// and the step, and the run, fail there. A read the connector answers is then
// checked in code by check_read (reviewed_change, op `page`), which refuses
// anything but a read of the run's node with a title and a binding. Both run
// before the model step and the filing step on the one road of the flow, so a
// failed read proposes, files and writes nothing.
//
// Three arms: R1 the read step has no model and no error output of its own,
// and the check refuses a read without a binding; R2 no model step lists a
// completed code; R3 every step after the read is reached only through the
// read step and its check (the walk names no later step, so a renamed step
// passes), and every control edge names both of its ends.
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
const READ = "read_page";
const CHECK = "check_read";

const bridgeSteps = Object.entries(parts).filter(
  ([, node]) => node?.component_type === "ApiNode" && typeof node.url === "string" && node.url.includes(LLM_BRIDGE_PATH),
);

test("R1: the read step is model-free and its failure is the step's own; the check refuses a read without a binding", async () => {
  const read = parts[READ];
  assert.equal(read.url.includes(LLM_BRIDGE_PATH), false, "the read step is not a model step");
  assert.equal("system" in read.data, false);
  assert.equal("completed_error_codes" in read.data, false);
  assert.equal(read.outputs.some((o) => o.title === "error"), false, "the read answers no error output: a failed read fails the step");
  const { extensionTool } = await import("../cinatra/tools/reviewed-change.mjs");
  const call = {
    op: "page",
    readNodeId: JSON.stringify("7"),
    readInstanceId: JSON.stringify("site-1"),
    nid: JSON.stringify(7),
    language: JSON.stringify("en"),
    published: JSON.stringify(true),
    fields: JSON.stringify({ title: "Opening hours" }),
    binding: JSON.stringify({}),
    nodeId: JSON.stringify("7"),
    instanceId: JSON.stringify("site-1"),
  };
  await assert.rejects(
    extensionTool({ input: call, ports: {} }),
    (err) => err.name === "ExtensionToolCallRefusal" && err.message.startsWith("node_read_unavailable: nothing was proposed or written"),
  );
  // The flow defaults a read output stands at when the read answered nothing are refused too.
  const defaults = Object.fromEntries(read.outputs.map((o) => [o.title, o.default]));
  const atDefaults = {
    op: "page",
    readNodeId: JSON.stringify(defaults.nodeId),
    readInstanceId: JSON.stringify(defaults.instanceId),
    nid: JSON.stringify(defaults.nid),
    language: JSON.stringify(defaults.language),
    published: JSON.stringify(defaults.published),
    fields: JSON.stringify(defaults.fields),
    binding: JSON.stringify(defaults.binding),
    nodeId: JSON.stringify("7"),
    instanceId: JSON.stringify("site-1"),
  };
  await assert.rejects(extensionTool({ input: atDefaults, ports: {} }), (err) => err.message.startsWith("node_read_unavailable: "));
});

test("R2: no model step lists a completed code", () => {
  assert.deepEqual(bridgeSteps.map(([id]) => id).sort(), ["compose_change"], "the flow has one model step");
  for (const [id, node] of bridgeSteps) {
    assert.equal(
      "completed_error_codes" in (node.data ?? {}),
      false,
      `${id} lists no completed code, so a failure code of ${id} ends the run failed`,
    );
  }
});

test("R3: every step after the read step is reached only through the read step and its check", () => {
  const edges = oas.control_flow_connections ?? [];
  const startId = oas.start_node?.$component_ref;
  assert.ok(startId, "the flow names its start node");
  for (const edge of edges) {
    assert.ok(edge.from_node?.$component_ref && edge.to_node?.$component_ref, `control edge ${edge.name} names both of its ends`);
  }
  const reachedAvoiding = (avoid) => {
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const from = queue.shift();
      for (const edge of edges) {
        if (edge.from_node.$component_ref !== from) continue;
        const to = edge.to_node.$component_ref;
        if (to === avoid || seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return [...seen];
  };
  assert.ok(
    edges.some((edge) => edge.from_node.$component_ref === startId && edge.to_node.$component_ref === READ),
    "the start leads to the read step",
  );
  assert.deepEqual(reachedAvoiding(READ), [startId], "no step is reached from the start without passing the read step");
  assert.deepEqual(reachedAvoiding(CHECK).sort(), [READ, startId].sort(), "no step but the read is reached without passing its check");
});
