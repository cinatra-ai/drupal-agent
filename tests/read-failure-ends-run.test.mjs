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
// Three arms: R1 the read step declares the error output and its
// instructions ASSIGN each failure code to its failure condition (a code
// that only occurs somewhere in the text, in a sentence that forbids it for
// example, is no assignment), and answer the empty code on a success; R2 no
// model step lists a completed code; R3 every step after the read, the
// settle, output and end steps among them, is reached only through the read
// step, and every control edge names both of its ends.
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
const FAILURE_CODES = ["not-found", "read-failed"];
const SUCCESS_SENTENCE = "`code` and `message` are both the empty string on a successful read.";
const ASSIGN_SENTENCE =
  "When the read says the node does not exist, `code` is `not-found`; " +
  "when the read fails in any other way, `code` is `read-failed`.";

const bridgeSteps = Object.entries(parts).filter(
  ([, node]) =>
    node.component_type === "ApiNode" &&
    typeof node.url === "string" &&
    node.url.endsWith(LLM_BRIDGE_PATH),
);

test("R1: the read step answers a failure in its error output", () => {
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
  const system = (node.data?.system ?? "").replace(/[ \t]+/g, " ");
  const errorLine = system.split("\n").find((line) => line.startsWith("- `error`"));
  assert.ok(errorLine, "the read step's instructions have an `error` line");
  // The sentences of that line; the code assignment is one whole sentence of it.
  const sentences = errorLine.trim().split(/(?<=\.)\s+/);
  assert.ok(
    sentences[0].endsWith(SUCCESS_SENTENCE),
    "a successful read answers the empty code, so a success is never stopped",
  );
  assert.ok(
    sentences.includes(ASSIGN_SENTENCE),
    "the instructions assign not-found to a node that does not exist and read-failed to any other failed read",
  );
  // The allow-list half: each failure code is named once in the whole text,
  // in that assignment, so no other sentence can forbid or redirect it.
  for (const code of FAILURE_CODES) {
    assert.equal(
      system.split(`\`${code}\``).length - 1,
      1,
      `${code} occurs once in the read step's instructions, in the assignment`,
    );
  }
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
  for (const step of [
    "compose_change",
    "file_page",
    "gather_page_review",
    "page_review_gate",
    "load_node",
    "settle_outcome",
    "emit_output",
    "end",
  ]) {
    assert.ok(parts[step], `${step} keeps its id`);
  }
  // The allow-list half: nothing but the start itself is reached without the
  // read step, so a new step or edge cannot bypass the read unnamed.
  assert.deepEqual(
    [...seen],
    [startId],
    "no step is reached from the start without passing the read step",
  );
});
