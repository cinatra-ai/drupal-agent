// cinatra-ai/cinatra#3745 — a change of nothing is told to the person, never a silent success.
//
// The code cannot know whether a request truly needed no change: the compose
// step's answer `{fields: [], publish: false}` is the same for a request that
// is already satisfied and for a request the composing model dropped. So the
// run still ends completed, but the no-change step answers a reason built by
// code (never by the model): a fixed sentence that says that no change was
// proposed for this request on this node, that nothing was reviewed or
// written, and that repeats the request, flattened to one line and bounded.
// The request reaches the step by a data edge from the flow's start, and the
// reason reaches the flow's output message and its end.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));
const parts = oas.$referenced_components;
const STEP = "no_change_outcome";

const load = () => import("../cinatra/tools/reviewed-change.mjs");

const READ = {
  nodeId: "7",
  title: "Opening hours",
  body: "<p>We open at nine.</p>",
  fieldValues: [],
  error: { code: "", message: "" },
  nodeStatus: "draft",
};
const NOTHING = { fields: [], publish: false };
const call = (instructions, read = READ, writeFields = NOTHING) => ({
  op: "unchanged",
  writeFields: JSON.stringify(writeFields),
  instructions: JSON.stringify(instructions),
  nodeId: JSON.stringify(read.nodeId),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
  error: JSON.stringify(read.error),
  nodeStatus: JSON.stringify(read.nodeStatus),
});

const sourcesOf = (node, input) =>
  oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => [e.source_node.$component_ref, e.source_output]);

const LEAD = 'No change was proposed for this request on node 7 ("Opening hours"), so nothing was reviewed or written: ';

test("N1 the no-change outcome has a reason built by code that names the node and repeats the request", async () => {
  const { extensionTool } = await load();
  const request = "Change the closing time in the body to six";
  const outcome = await extensionTool({ input: call(request), ports: {} });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.nodeId, "7");
  assert.deepEqual(outcome.changes, []);
  assert.equal(outcome.reason, `${LEAD}${request}`);
  // The same request answers the same sentence: nothing in it comes from the model.
  assert.equal((await extensionTool({ input: call(request), ports: {} })).reason, outcome.reason);
  const equal = { fields: [{ field: "body", value: READ.body }], publish: false };
  assert.equal((await extensionTool({ input: call(request, READ, equal), ports: {} })).reason, outcome.reason, "values equal to the read");
});

test("N2 a long or multi-line request is flattened to one line and cut; an empty request is named as empty", async () => {
  const { extensionTool, REQUEST_MAX } = await load();
  assert.equal(typeof REQUEST_MAX, "number");
  const lines = "Change the title\n\tto  Summer hours\r\nand the body too";
  const flat = (await extensionTool({ input: call(lines), ports: {} })).reason;
  assert.equal(flat, `${LEAD}Change the title to Summer hours and the body too`);
  const long = "word ".repeat(400);
  const cut = (await extensionTool({ input: call(long), ports: {} })).reason;
  assert.ok(cut.startsWith(LEAD));
  assert.ok(cut.endsWith("…"), "a cut request ends with an ellipsis");
  assert.ok(cut.length - LEAD.length <= REQUEST_MAX, "the request part is bounded");
  assert.doesNotMatch(cut, /[\r\n\t]/);
  const longTitle = (await extensionTool({ input: call("x", { ...READ, title: `A\n${"t".repeat(600)}` }), ports: {} })).reason;
  assert.doesNotMatch(longTitle, /[\r\n]/);
  assert.ok(longTitle.length < 1000, "the title is bounded too");
  for (const empty of ["", "  \n "]) {
    const reason = (await extensionTool({ input: call(empty), ports: {} })).reason;
    assert.equal(reason, `${LEAD.slice(0, -2)}; the request was empty.`);
  }
});

test("N3 the reason never claims that something was written, saved or published", async () => {
  const { extensionTool } = await load();
  const reason = (await extensionTool({ input: call("Fix the typo"), ports: {} })).reason;
  const fixed = reason.slice(0, reason.length - "Fix the typo".length);
  assert.match(fixed, /nothing was reviewed or written/);
  assert.doesNotMatch(fixed.replace("nothing was reviewed or written", ""), /\b(written|saved|published|updated|changed)\b/i);
});

test("N4 the step takes the request by a data edge from the start and hands its reason to the output message and the end", () => {
  const node = parts[STEP];
  assert.ok(node.inputs.some((i) => i.title === "instructions" && i.type === "string"), "the step declares the request");
  assert.deepEqual(sourcesOf(STEP, "instructions"), [["start", "instructions"]]);
  assert.match(node.data.input.input.instructions, /\{\{ instructions \| tojson \}\}/);
  assert.deepEqual(sourcesOf(STEP, "title"), [["check_read", "title"]]);
  assert.deepEqual(sourcesOf(STEP, "nodeId"), [["start", "nodeId"]]);
  assert.ok(sourcesOf("emit_output", "reason").some(([from, out]) => from === STEP && out === "reason"));
  assert.ok(sourcesOf("end", "reason").some(([from, out]) => from === STEP && out === "reason"));
  assert.match(parts.emit_output.message, /"reason":\{\{ reason \| tojson \}\}/, "the closing message carries the reason");
});

test("N5 the read check and the publish refusal still come first: no reason is answered for a failed read or a publish", async () => {
  const { extensionTool } = await load();
  await assert.rejects(extensionTool({ input: call("x", { ...READ, error: { code: "read-failed", message: "no" } }), ports: {} }), /reviewed_change_unavailable/);
  await assert.rejects(extensionTool({ input: call("Publish it", READ, { fields: [], publish: true }), ports: {} }), /reviewed_change_unavailable/);
});

test("N6 the README says that a change of nothing ends completed with a reason that repeats the request", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.doesNotMatch(readme, /empty on success\/no-change/);
  assert.match(readme, /no change was proposed/i);
});
