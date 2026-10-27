// cinatra-ai/cinatra#3924 item 3 — an approved edit that saves nothing never
// completes silently.
//
// The write step (load_node) answers a required outcome: saved, no_change or
// refused. Its prompt gives no literal no-change answer as a default. The next
// step (settle_outcome) runs the pack's own declared module, which reads that
// outcome against the reviewed proposal and the actual read. A refused
// outcome, or a no_change or saved answer the proposal and the read do not
// support, is refused by the host's documented means (an error named
// ExtensionToolCallRefusal), so the step that called it fails the run.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const parts = oas.$referenced_components;
const OUTCOMES = ["saved", "no_change", "refused"];
const MODULE = "./cinatra/tools/settle-outcome.mjs";
const REFUSAL_NAME = "ExtensionToolCallRefusal";

const edge = (node, input) =>
  oas.data_flow_connections.find((e) => e.destination_node.$component_ref === node && e.destination_input === input);

/** The module, imported per test so a missing module fails each test on its own. */
const settleModule = () => import(new URL(`.${MODULE}`, import.meta.url));

/** The flow's own call input, rendered the way the runtime renders it (`| tojson`, comments dropped). */
function renderedCall(values) {
  const template = parts.settle_outcome.data.input.input;
  const out = {};
  for (const [key, text] of Object.entries(template)) {
    out[key] = text
      .replace(/\{#[\s\S]*?#\}/g, "")
      .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\|\s*tojson\s*\}\}/g, (_m, name) => JSON.stringify(values[name]))
      .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => String(values[name]));
  }
  return out;
}

/** A read of node 3 and a reviewed proposal that changes its title. */
const READ = {
  title: "Opening hours",
  body: "<p>We open at nine.</p>",
  fieldValues: [{ field: "field_note", value: "Closed on holidays" }],
  error: { code: "", message: "" },
};
const PROPOSAL = [{ field: "title", value: "Opening hours and holidays" }];

async function settle(answer, { proposedFields = PROPOSAL, read = READ } = {}) {
  const { extensionTool } = await settleModule();
  const input = renderedCall({ ...read, proposedFields, ...answer });
  return extensionTool({ input, ports: {} });
}

/** The host repeats a module's refusal only as a named error with one bounded sentence. */
function isNamedRefusal(includes) {
  return (err) => {
    assert.equal(err?.name, REFUSAL_NAME, "the host's one documented refusal name");
    const text = err.message;
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 0, "the sentence is never empty");
    assert.ok(text.length <= 400, "the sentence stays within the host's bound");
    assert.doesNotMatch(text, /[\r\n\u2028\u2029]/, "the sentence is one line");
    if (includes) assert.ok(text.includes(includes), `the sentence says "${includes}": ${text}`);
    return true;
  };
}

test("O1 the write step declares a required outcome: saved, no_change or refused", () => {
  const outcome = parts.load_node.outputs.find((o) => o.title === "outcome");
  assert.ok(outcome, "load_node declares an outcome output");
  assert.equal(outcome.type, "string");
  assert.deepEqual(outcome.json_schema?.enum, OUTCOMES);
  // The runtime asks the provider for every declared output (required) and
  // carries the output's description: the description names all three values.
  for (const value of OUTCOMES) assert.ok(outcome.description.includes(value), `the description names ${value}`);
  assert.match(parts.load_node.data.user, /Return nodeId, changes, reason and outcome as declared\./);
});

test("O2 the write step's prompt gives no literal no-change answer as its default", () => {
  const text = parts.load_node.data.system;
  assert.doesNotMatch(text, /"changes":\[\],"reason":""\}/, "no literal no-change result");
  const examples = text.match(/\{"nodeId":"7"[^\n]*\}/g) ?? [];
  assert.ok(examples.length >= 3, "the prompt keeps its saved and refusal examples");
  for (const example of examples) {
    const parsed = JSON.parse(example);
    assert.ok(OUTCOMES.includes(parsed.outcome), `each example names its outcome: ${example}`);
    if (parsed.outcome === "refused") assert.ok(parsed.reason.length > 0, "a refusal example carries its reason");
  }
  assert.match(text, /tool error or a tool denial is always refused, with a non-empty reason/);
  assert.match(text, /no_change: no content write was needed because the reviewed proposedFields is empty, or each proposed field already equals its value in the supplied read/);
  assert.match(text, /A reviewed proposal with a field that differs from the read is never no_change/);
  assert.match(text, /never a default answer/);
});

test("O3 the settle step follows the write step and reads its outcome, the reviewed proposal and the read", () => {
  const road = oas.nodes.map((n) => n.$component_ref);
  assert.equal(road.indexOf("settle_outcome"), road.indexOf("load_node") + 1, "the settle step is next on the road");
  const from = (id) => oas.control_flow_connections.filter((e) => e.from_node.$component_ref === id).map((e) => e.to_node.$component_ref);
  assert.deepEqual(from("load_node"), ["settle_outcome"], "the write step's one way on is the settle step");
  assert.deepEqual(from("settle_outcome"), ["emit_output"]);

  const node = parts.settle_outcome;
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.endsWith("/api/agents/passthrough"));
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, "settle_outcome");
  assert.equal(node.data.input.input.op, "settle");
  assert.equal(node.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  const sources = {
    outcome: ["load_node", "outcome"],
    reason: ["load_node", "reason"],
    changes: ["load_node", "changes"],
    proposedFields: ["compose_change", "proposedFields"],
    title: ["read_node", "title"],
    body: ["read_node", "body"],
    fieldValues: ["read_node", "fieldValues"],
    error: ["read_node", "error"],
    cinatra_run_id: ["start", "cinatra_run_id"],
  };
  for (const [input, [source, output]] of Object.entries(sources)) {
    assert.ok(node.inputs.some((i) => i.title === input), `the settle step declares ${input}`);
    assert.equal(edge("settle_outcome", input)?.source_node.$component_ref, source, `${input} comes from ${source}`);
    assert.equal(edge("settle_outcome", input)?.source_output, output);
  }
  assert.ok(pkg.cinatra.tools.some((t) => t.name === "settle_outcome" && t.module === MODULE), "the pack declares the module");
});

test("O4 an approved edit that saved nothing never passes as no_change (the #3924 run)", async () => {
  await assert.rejects(
    settle({ outcome: "no_change", changes: [], reason: "" }),
    isNamedRefusal("title"),
    "a reviewed proposal with a differing field that saved nothing stops the run",
  );
});

test("O5 refused always stops the run, with the write step's reason or a stated one", async () => {
  const reason = "The connector refused the write: the site denied the draft revision.";
  await assert.rejects(settle({ outcome: "refused", changes: [], reason }), isNamedRefusal(reason));
  await assert.rejects(settle({ outcome: "refused", changes: [], reason: "" }), isNamedRefusal("without a reason"));
  await assert.rejects(settle({ outcome: "refused", changes: [], reason: "first line\nsecond line" }), isNamedRefusal("first line second line"));
  await assert.rejects(settle({ outcome: "refused", changes: [], reason: "x".repeat(600) }), isNamedRefusal());
});

test("O6 no_change holds only for an empty proposal or one whose fields equal the read", async () => {
  assert.deepEqual(await settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: [] }), { ok: true });
  const same = [
    { field: "title", value: "Opening hours" },
    { field: "body", value: "<p>We open at nine.</p>" },
    { field: "field_note", value: "Closed on holidays" },
  ];
  assert.deepEqual(await settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: same }), { ok: true });
  await assert.rejects(
    settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: [{ field: "field_missing", value: "x" }] }),
    isNamedRefusal("field_missing"),
    "a field the read does not have cannot equal its value",
  );
  await assert.rejects(
    settle({ outcome: "no_change", changes: [{ field: "title", before: "a", after: "b" }], reason: "" }, { proposedFields: [] }),
    isNamedRefusal("reported changes"),
  );
});

test("O7 saved holds with its diff, and never as an empty diff for a differing proposal", async () => {
  const diff = [{ field: "title", before: "Opening hours", after: "Opening hours and holidays" }];
  assert.deepEqual(await settle({ outcome: "saved", changes: diff, reason: "" }), { ok: true });
  assert.deepEqual(await settle({ outcome: "saved", changes: [], reason: "" }, { proposedFields: [] }), { ok: true }, "an explicit publish-only request");
  await assert.rejects(settle({ outcome: "saved", changes: [], reason: "" }), isNamedRefusal("title"));
});

test("O8 a failed read or an undeclared outcome stops the run", async () => {
  const failedRead = { ...READ, error: { code: "read-failed", message: "The read failed." } };
  await assert.rejects(
    settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: [], read: failedRead }),
    isNamedRefusal("read-failed"),
  );
  for (const outcome of ["", "completed", "SAVED"]) {
    await assert.rejects(settle({ outcome, changes: [], reason: "" }, { proposedFields: [] }), isNamedRefusal("no declared outcome"));
  }
  const { extensionTool } = await settleModule();
  await assert.rejects(
    async () => extensionTool({ input: { op: "review" }, ports: {} }),
    (err) => err instanceof Error && err.name !== REFUSAL_NAME && err.message.includes("settle"),
    "an unknown op is a failure naming the one op the module knows",
  );
});

test("O9 the README says a refused edit, or a reviewed change that saved nothing, ends the run as failed", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /A refused edit ends the run as failed with the reason/);
  assert.match(readme, /a reviewed change that saved nothing ends the run as failed, never as an empty diff/);
  assert.doesNotMatch(readme, /Empty `changes` and empty `reason` mean no field diff/);
});

/** The flow's call for a true no_change (an empty proposal), with one input replaced as given (undefined: left out). */
async function settleWith(key, raw) {
  const { extensionTool } = await settleModule();
  const input = renderedCall({ ...READ, proposedFields: [], outcome: "no_change", changes: [], reason: "" });
  if (raw === undefined) delete input[key];
  else input[key] = raw;
  return extensionTool({ input, ports: {} });
}

/** Unreadable forms of a list input: each must stop the run, never read as an empty list. */
const UNREADABLE_LIST = {
  "left out": undefined,
  "empty text": "",
  "not JSON": "not json",
  "JSON null": "null",
  "a JSON object": '{"fields":[]}',
  "a JSON string": '"[]"',
  "double-encoded": JSON.stringify(JSON.stringify([])),
};

for (const [id, key, sentence] of [
  ["O10", "proposedFields", "reviewed proposal could not be read"],
  ["O11", "fieldValues", "field values could not be read"],
  ["O12", "changes", "changes could not be read"],
]) {
  test(`${id} an unreadable ${key} stops the run instead of reading as an empty list`, async () => {
    const { extensionTool } = await settleModule();
    const baseline = renderedCall({ ...READ, proposedFields: [], outcome: "no_change", changes: [], reason: "" });
    assert.deepEqual(await extensionTool({ input: baseline, ports: {} }), { ok: true }, "the readable call passes");
    for (const [form, raw] of Object.entries(UNREADABLE_LIST)) {
      await assert.rejects(settleWith(key, raw), isNamedRefusal(sentence), `${key} ${form}`);
    }
  });
}

test("O13 an unreadable read error stops the run instead of reading as a successful read", async () => {
  const forms = {
    "left out": undefined,
    "empty text": "",
    "not JSON": "timeout",
    "a JSON string": '"read failed"',
    "a JSON list": "[]",
    "JSON null": "null",
    "an object without a code": '{"message":"The read failed."}',
    "a code that is not text": '{"code":0,"message":""}',
    "double-encoded": JSON.stringify(JSON.stringify({ code: "", message: "" })),
  };
  for (const [form, raw] of Object.entries(forms)) {
    await assert.rejects(settleWith("error", raw), isNamedRefusal("error could not be read"), `error ${form}`);
  }
});

test("O14 a proposal that differs from the read only in white space is refused, not passed as no_change", async () => {
  await assert.rejects(
    settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: [{ field: "body", value: "<p>We open at nine.</p>\n" }] }),
    isNamedRefusal("body"),
  );
  await assert.rejects(
    settle({ outcome: "no_change", changes: [], reason: "" }, { proposedFields: [{ field: "title", value: "Opening hours " }] }),
    isNamedRefusal("title"),
  );
});
