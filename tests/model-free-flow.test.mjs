// cinatra-ai/cinatra#3745 — the read and the write run without a model.
//
// The flow reads the page with the connector's read tool,
// `drupal_node_read_for_edit`, in a step that calls the tool directly on the
// host's passthrough road (no model). A check step in code takes only a read
// of the run's node with a binding. One model step, `compose_change`,
// proposes the new values from that read; it declares no tool. After the
// review and the read-back of the approved revision, a branch on the status as
// read takes the run to one of two publishing steps: `write_draft` (a
// published page: `drupal_node_create_draft_revision`, a draft revision of the
// same node; the live page stays as it is) or `write_unpublished` (an
// unpublished page: `drupal_node_update`, saved, not published). Each makes
// one call; its arguments are templates over the step's inputs, the two JSON
// text arguments rendered with `tojson`, and each input comes by exactly one
// data edge, from the read or from the read-back of the reviewed revision.
// The read's binding travels whole, by one edge, into `expectedBindingJson`;
// the Cinatra module writes only if the page is unchanged since that read.
// `write_outcome` reads the answer in code: `node_changed` takes the run back
// to the read; every other refusal ends the run with a plain message.
//
// What this file executes: the shape of cinatra/oas.json, the pack's
// `reviewed_change` tool (ops `page`, `read` and `outcome`) with fake inputs,
// and the write steps' templates, rendered by a small renderer below for the
// constructs the templates use (comments, and `tojson` through the tool's own
// `tojsonText`). What it does not execute: the host's passthrough
// road, the connector, the site and the flow runtime.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const parts = oas.$referenced_components;

const PASSTHROUGH = "{{CINATRA_BASE_URL}}/api/agents/passthrough";
const BRIDGE = "/api/llm-bridge";
const READ_STEP = "read_page";
const CHECK_STEP = "check_read";
const MODEL_STEP = "compose_change";
const REVIEWED_READ = "read_reviewed_page";
const STATUS_ROUTE = "route_status";
const DRAFT_STEP = "write_draft";
const UPDATE_STEP = "write_unpublished";
const WRITE_STEPS = [DRAFT_STEP, UPDATE_STEP];
const OUTCOME_STEP = "write_outcome";
const ROUTE_STEP = "route_write";
const REVIEW_STEP = "page_review_gate";
const READ_TOOL = "drupal_node_read_for_edit";
const DRAFT_TOOL = "drupal_node_create_draft_revision";
const UPDATE_TOOL = "drupal_node_update";
const TOOL_OF = { [DRAFT_STEP]: DRAFT_TOOL, [UPDATE_STEP]: UPDATE_TOOL };
const REFUSAL_CODES = [
  "pending_revision",
  "permission_denied",
  "invalid_input",
  "refused",
  "write_unverified",
  "invalid_binding",
  "wrong_page_state",
  "module_capability_missing",
  "read_unavailable",
];

const cinatraOf = (component) => component?.metadata?.cinatra ?? {};
const sourcesOf = (node, input) =>
  oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => [e.source_node.$component_ref, e.source_output]);
const controlFrom = (node) => oas.control_flow_connections.filter((e) => e.from_node.$component_ref === node);
const controlInto = (node) =>
  oas.control_flow_connections.filter((e) => e.to_node.$component_ref === node).map((e) => e.from_node.$component_ref);
const titles = (list) => (list ?? []).map((entry) => entry.title);
const load = () => import("../cinatra/tools/reviewed-change.mjs");

/** Every node the control flow reaches from `from` without passing through `avoid`. */
function reachable(from, avoid) {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    for (const edge of controlFrom(node)) {
      const next = edge.to_node.$component_ref;
      if (next === avoid || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

// --- a renderer for the constructs the write templates use --------------------

// `tojson` renders with the tool's own `tojsonText`, the one function the
// tool's size checks measure with, so the renderer and the checks cannot drift.
// tests/send-size.test.mjs pins that function to texts the flow runtime
// rendered.
const { tojsonText: tojson } = await load();
function evalExpr(expr, vars) {
  const pieces = expr.trim().split("|").map((s) => s.trim());
  const name = pieces.shift();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsupported expression ${expr}`);
  if (!Object.prototype.hasOwnProperty.call(vars, name)) throw new Error(`undeclared variable ${name}`);
  let rendered = null;
  for (const filter of pieces) {
    if (filter === "tojson") rendered = tojson(vars[name]);
    else throw new Error(`unsupported filter ${filter}`);
  }
  return rendered ?? String(vars[name] ?? "");
}
function render(template, vars) {
  const text = template.replace(/\{#[\s\S]*?#\}/g, "");
  if (text.includes("{%")) throw new Error("unsupported statement");
  return text.replace(/\{\{([^}]+)\}\}/g, (_, expr) => evalExpr(expr, vars));
}
/** The template references of a text: each `{{ name ... }}`, comments included. */
const referencedNames = (template) => new Set([...template.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
/** Every template text of a step's request. */
const templatesOf = (step) => Object.values(parts[step].data.input).filter((v) => typeof v === "string");

// --- the read is model-free and comes first -------------------------------------

test("M1 the read step calls drupal_node_read_for_edit on the passthrough road, without a model", () => {
  const read = parts[READ_STEP];
  assert.equal(read.component_type, "ApiNode");
  assert.equal(read.url, PASSTHROUGH, "the read step calls the host's passthrough road, not the model bridge");
  assert.equal(read.data.tool, READ_TOOL, "the tool name is a literal");
  assert.deepEqual(read.data.input, { instanceId: "{{ instanceId }}", nid: "{{ nodeId }}" }, "the read takes the instance and the node id, and no language: the original translation");
  assert.equal(Object.prototype.hasOwnProperty.call(read.data, "system"), false, "no model instructions");
  assert.equal(cinatraOf(read).riskClass, "read_only");
  for (const name of ["instanceId", "nodeId", "nid", "language", "published", "fields", "binding"]) {
    assert.ok(titles(read.outputs).includes(name), `the read step outputs the connector's ${name}`);
  }
  assert.equal(read.outputs.find((o) => o.title === "binding").type, "object");
  assert.deepEqual(sourcesOf(READ_STEP, "instanceId"), [["start", "instanceId"]]);
  assert.deepEqual(sourcesOf(READ_STEP, "nodeId"), [["start", "nodeId"]]);
});

test("M2 the read and its check precede the model step, which the run reaches only through them", () => {
  assert.deepEqual(controlFrom("start").map((e) => e.to_node.$component_ref), [READ_STEP]);
  assert.deepEqual(controlInto(CHECK_STEP), [READ_STEP]);
  assert.deepEqual(controlInto(MODEL_STEP), [CHECK_STEP]);
  assert.equal(reachable("start", READ_STEP).has(MODEL_STEP), false, "no road to the model step bypasses the read");
  assert.equal(reachable("start", CHECK_STEP).has(MODEL_STEP), false, "no road to the model step bypasses the check of the read");
  for (const input of ["title", "body", "fieldValues", "address", "error"]) {
    assert.deepEqual(sourcesOf(MODEL_STEP, input), [[CHECK_STEP, input]], `the model sees the ${input} as checked`);
  }
  for (const [input, output] of [["readNodeId", "nodeId"], ["readInstanceId", "instanceId"], ["nid", "nid"], ["language", "language"], ["published", "published"], ["fields", "fields"], ["binding", "binding"]]) {
    assert.deepEqual(sourcesOf(CHECK_STEP, input), [[READ_STEP, output]], `the check takes the read's ${output}`);
  }
});

test("M3 the flow has one model step; it declares no tool and names no site tool", () => {
  const bridge = Object.values(parts).filter((n) => n.component_type === "ApiNode" && typeof n.url === "string" && n.url.endsWith(BRIDGE));
  assert.deepEqual(bridge.map((n) => n.id), [MODEL_STEP], "compose_change is the one step on the model bridge");
  const model = parts[MODEL_STEP];
  assert.deepEqual(cinatraOf(model).tools, [], "the model step declares the empty tool list: the host serves it no tool");
  assert.deepEqual(model.data.toolbox_ids, [], "and no toolbox");
  const text = JSON.stringify(model.data);
  for (const word of [READ_TOOL, DRAFT_TOOL, UPDATE_TOOL, "drupal_node_publish", "drupal_node_get"]) {
    assert.equal(text.includes(word), false, `the model step's data does not name ${word}`);
  }
  assert.equal(cinatraOf(model).riskClass, "read_only");
  assert.equal(JSON.stringify(oas).includes("drupal_node_publish"), false, "no step of the flow publishes");
  assert.equal(JSON.stringify(oas).includes("drupal_node_get"), false, "no step reads through the recent-list proxy");
});

// --- the check of the read --------------------------------------------------------

const BINDING = {
  instanceId: "site-1",
  target: "https://example.org/base",
  targetUpdatedAt: null,
  nid: 7,
  language: "en",
  published: true,
  expected_default_revision_id: 41,
  expected_latest_revision_id: 41,
  expected_changed: 1763600000,
  workflow_fingerprint: "a".repeat(64),
  preimage_fingerprint: "b".repeat(64),
};
const readAnswer = (over = {}) => ({
  instanceId: "site-1",
  nodeId: "7",
  nid: 7,
  language: "en",
  published: true,
  fields: { body: "<p>We open at nine.</p>", field_tagline: "Open daily", field_rank: 3, title: "Opening hours" },
  binding: BINDING,
  ...over,
});
/** The check step's call as the flow renders it: each read value as JSON text, and the run's node and instance. */
const pageCall = (answer, run = {}) => ({
  op: "page",
  readNodeId: JSON.stringify(answer.nodeId),
  readInstanceId: JSON.stringify(answer.instanceId),
  nid: JSON.stringify(answer.nid),
  language: JSON.stringify(answer.language),
  published: JSON.stringify(answer.published),
  fields: JSON.stringify(answer.fields),
  binding: JSON.stringify(answer.binding),
  nodeId: JSON.stringify(run.nodeId ?? "7"),
  instanceId: JSON.stringify(run.instanceId ?? "site-1"),
});
const refusedWith = (code) => (err) =>
  err instanceof Error && err.name === "ExtensionToolCallRefusal" && err.message.startsWith(`${code}: `) && !err.message.includes("\n");

test("M4 the check of the read accepts a read of the run's node with a binding, and hands the plain text values on", async () => {
  const { extensionTool } = await load();
  const out = await extensionTool({ input: pageCall(readAnswer()), ports: {} });
  assert.equal(out.ok, true);
  assert.equal(out.nodeId, "7");
  assert.equal(out.instanceId, "site-1");
  assert.equal(out.status, "published");
  assert.equal(out.title, "Opening hours");
  assert.equal(out.body, "<p>We open at nine.</p>");
  assert.deepEqual(out.fieldValues, [{ field: "field_tagline", value: "Open daily" }], "only the field_ text values; a number is not offered");
  assert.equal(out.address, "");
  assert.deepEqual(out.error, { code: "", message: "" });
  const draft = await extensionTool({ input: pageCall(readAnswer({ published: false })), ports: {} });
  assert.equal(draft.status, "draft");
  const odd = await extensionTool({ input: pageCall(readAnswer({ binding: { anything: ["the check reads no member"] } })), ports: {} });
  assert.equal(odd.ok, true, "the binding is checked only as a non-empty object, never by its members");
});

test("M5 the check of the read refuses another node or instance, a missing binding or title, and a malformed read", async () => {
  const { extensionTool } = await load();
  const cases = [
    [readAnswer({ nodeId: "8" }), {}],
    [readAnswer({ nid: 8 }), {}],
    [readAnswer(), { nodeId: "7.0" }],
    [readAnswer({ instanceId: "site-2" }), {}],
    [readAnswer(), { instanceId: "" }],
    [readAnswer({ published: "true" }), {}],
    [readAnswer({ language: "" }), {}],
    [readAnswer({ fields: { body: "x" } }), {}],
    [readAnswer({ fields: { title: "" } }), {}],
    [readAnswer({ fields: [] }), {}],
    [readAnswer({ binding: {} }), {}],
    [readAnswer({ binding: null }), {}],
    [readAnswer({ binding: [] }), {}],
    [readAnswer({ binding: "text" }), {}],
  ];
  for (const [answer, run] of cases) {
    await assert.rejects(extensionTool({ input: pageCall(answer, run), ports: {} }), refusedWith("node_read_unavailable"), JSON.stringify([answer, run]).slice(0, 120));
  }
});

// --- the branch on the status and the two publishing steps ---------------------------

test("M6 after the read-back, a branch on the status as read takes the run to exactly one of the two publishing steps", () => {
  assert.deepEqual(controlFrom(REVIEWED_READ).map((e) => e.to_node.$component_ref), [STATUS_ROUTE]);
  assert.deepEqual(sourcesOf(STATUS_ROUTE, "next"), [[CHECK_STEP, "status"]]);
  const route = parts[STATUS_ROUTE];
  assert.equal(route.component_type, "BranchingNode");
  assert.deepEqual(route.mapping, { published: "published", draft: "draft" });
  const target = (branch) => controlFrom(STATUS_ROUTE).filter((e) => e.from_branch === branch).map((e) => e.to_node.$component_ref);
  assert.deepEqual(target("published"), [DRAFT_STEP], "a published page gets a draft revision");
  assert.deepEqual(target("draft"), [UPDATE_STEP], "an unpublished page is updated, not published");
  assert.deepEqual(target("default"), [OUTCOME_STEP], "any other status writes nothing: the outcome step refuses an absent answer");
  for (const step of WRITE_STEPS) {
    assert.deepEqual(controlInto(step), [STATUS_ROUTE], `${step} is reached only through the branch`);
    assert.equal(reachable("start", REVIEWED_READ).has(step), false, `no road to ${step} bypasses the read-back of the approved revision`);
    assert.equal(reachable("start", REVIEW_STEP).has(step), false, `no road to ${step} bypasses the review`);
  }
});

test("M7 the two writes are the flow's publishing steps: top-level, model-free, one call each of a literal tool", () => {
  const publishing = Object.entries(parts).filter(([, n]) => cinatraOf(n).publishes === true).map(([k]) => k).sort();
  assert.deepEqual(publishing, [...WRITE_STEPS].sort());
  for (const step of WRITE_STEPS) {
    const write = parts[step];
    assert.ok(oas.nodes.some((n) => n.$component_ref === step), `${step} is a top-level node`);
    assert.equal(write.component_type, "ApiNode");
    assert.equal(write.id, step);
    assert.equal(write.url, PASSTHROUGH, "it calls the passthrough road, not the model bridge");
    assert.equal(write.data.tool, TOOL_OF[step], "the tool name is a literal, lower-case and without a template");
    assert.match(write.data.tool, /^[a-z_]+$/);
    assert.deepEqual(Object.keys(write.data.input).sort(), ["expectedBindingJson", "fieldsJson", "instanceId", "nodeId"]);
    assert.equal(write.data.input.instanceId, "{{ instanceId }}");
    assert.equal(write.data.input.nodeId, "{{ nodeId }}");
    assert.equal(Object.prototype.hasOwnProperty.call(write.data, "system"), false);
    assert.deepEqual(cinatraOf(write).confirmations, [{ tool: TOOL_OF[step], decision: "publish" }]);
    assert.equal(cinatraOf(write).requiresApproval, false, "the publish card is the one approval in front of it");
    assert.deepEqual(controlFrom(step).map((e) => e.to_node.$component_ref), [OUTCOME_STEP]);
  }
  for (const [key, node] of Object.entries(parts)) {
    for (const [step, tool] of Object.entries(TOOL_OF)) {
      if (key === step) continue;
      assert.equal(JSON.stringify(node.data ?? {}).includes(tool), false, `${key} does not call ${tool}`);
    }
  }
});

const READ_INPUTS = { instanceId: "instanceId", nodeId: "nodeId", binding: "binding" };
const REVIEWED_INPUTS = ["reviewedFields", "reviewedSnapshot"];

test("M8 each write input is fed by exactly one edge, from the read or the reviewed revision; none from the model step", () => {
  for (const step of WRITE_STEPS) {
    const write = parts[step];
    const declared = new Set(titles(write.inputs));
    const named = new Set(templatesOf(step).flatMap((t) => [...referencedNames(t)]));
    for (const name of named) assert.ok(declared.has(name), `${step}: the template names the declared input ${name}`);
    for (const name of declared) {
      if (name === "agent_run_id") continue;
      assert.ok(named.has(name), `${step}: ${name} appears in a template, so the runtime's input scanner finds it`);
    }
    for (const name of declared) assert.equal(sourcesOf(step, name).length, 1, `${step}: ${name} has exactly one incoming edge`);
    for (const [input, output] of Object.entries(READ_INPUTS)) {
      assert.deepEqual(sourcesOf(step, input), [[READ_STEP, output]], `${step}: ${input} comes from the read's ${output}`);
    }
    for (const input of REVIEWED_INPUTS) {
      assert.deepEqual(sourcesOf(step, input), [[REVIEWED_READ, input]], `${step}: ${input} comes from the read-back of the reviewed revision`);
    }
    assert.deepEqual(sourcesOf(step, "title"), [[CHECK_STEP, "title"]], `${step}: the card's title is the title as read`);
    assert.equal(
      oas.data_flow_connections.some((e) => e.destination_node.$component_ref === step && e.source_node.$component_ref === MODEL_STEP),
      false,
      `${step}: no value of the model step reaches the write`,
    );
    const shown = (t) => t.replace(/\{#[\s\S]*?#\}/g, "");
    assert.equal(shown(write.data.input.fieldsJson), "{{ reviewedFields | tojson }}");
    assert.equal(shown(write.data.input.expectedBindingJson), "{{ binding | tojson }}", "the binding is rendered whole");
  }
});

const writeVars = (over = {}) => ({
  instanceId: "site-1",
  nodeId: "7",
  binding: BINDING,
  title: "Opening hours",
  reviewedFields: { body: "<p>We open at ten \u{1F600} é.</p>\n<p>Tom & Jerry's</p></script>", title: 'Opening "hours"' },
  reviewedSnapshot: [{ artifactId: "artifact-7", representationRevisionId: "revision-2" }],
  agent_run_id: "run-1",
  ...over,
});

test("M9 the rendered expectedBindingJson parses back to exactly the read's binding, whatever its members, characters and key order", () => {
  for (const step of WRITE_STEPS) {
    const template = parts[step].data.input.expectedBindingJson;
    assert.deepEqual(JSON.parse(render(template, writeVars())), BINDING);
    const odd = {
      zeta: "ä   </script> & 'quote' \"double\" \\ \u{1F600}",
      alpha: { nested: [1, null, true, "x"], "key with space": "v" },
      seal: "c".repeat(64),
      numbers: [0, -1, 1.5, 1e21],
    };
    const reordered = Object.fromEntries(Object.entries(odd).reverse());
    const text = render(template, writeVars({ binding: reordered }));
    assert.deepEqual(JSON.parse(text), odd, "a binding with any member parses back to itself; key order does not matter");
    assert.equal(/[\u007f-￿<>&']/.test(text), false, "the rendered text is ASCII with < > & ' escaped, as Jinja writes it");
  }
});

test("M10 the rendered fieldsJson carries exactly the reviewed values, byte for byte, and nothing else", () => {
  for (const step of WRITE_STEPS) {
    const vars = writeVars();
    const fields = JSON.parse(render(parts[step].data.input.fieldsJson, vars));
    assert.deepEqual(fields, vars.reviewedFields);
    const titleOnly = JSON.parse(render(parts[step].data.input.fieldsJson, writeVars({ reviewedFields: { title: "New <b>title</b>" } })));
    assert.deepEqual(titleOnly, { title: "New <b>title</b>" }, "a field the review does not change is not sent");
  }
});

test("M11 the publish cards show the site, the title as read, the node id under a label that states the save, and the reviewed revision", () => {
  const rows = (step) => cinatraOf(parts[step]).publishRows;
  assert.deepEqual(rows(DRAFT_STEP), [
    { label: "Drupal site", input: "instanceId" },
    { label: "Page title as read", input: "title" },
    { label: "Node id (saved as a draft revision; live page unchanged)", input: "nodeId" },
    { kind: "artifacts", label: "Reviewed change", input: "reviewedSnapshot" },
  ]);
  assert.deepEqual(rows(UPDATE_STEP), [
    { label: "Drupal site", input: "instanceId" },
    { label: "Page title as read", input: "title" },
    { label: "Node id (unpublished: saved, not published)", input: "nodeId" },
    { kind: "artifacts", label: "Reviewed change", input: "reviewedSnapshot" },
  ]);
  for (const step of WRITE_STEPS) {
    const snapshot = parts[step].inputs.find((i) => i.title === "reviewedSnapshot");
    assert.equal(snapshot.type, "array", "the artifacts row reads a list of revisions");
  }
});

// --- the answer and its branches ------------------------------------------------------

test("M12 the answer is read by a model-free step, and every refusal code has its own branch", () => {
  assert.equal(parts[OUTCOME_STEP].url, PASSTHROUGH);
  assert.equal(parts[OUTCOME_STEP].data.tool, "extension_tool");
  assert.equal(parts[OUTCOME_STEP].data.input.name, "reviewed_change");
  assert.equal(parts[OUTCOME_STEP].data.input.input.op, "outcome");
  assert.deepEqual(controlInto(OUTCOME_STEP).sort(), [STATUS_ROUTE, ...WRITE_STEPS].sort());
  for (const [input, output] of [["ok", "ok"], ["code", "code"], ["applied", "applied"], ["answerNodeId", "nodeId"], ["revisionId", "revision_id"], ["storedFields", "fields"]]) {
    assert.deepEqual(sourcesOf(OUTCOME_STEP, input).sort(), WRITE_STEPS.map((s) => [s, output]).sort(), `${input} comes from the answer of the write that ran`);
  }
  assert.deepEqual(controlFrom(OUTCOME_STEP).map((e) => e.to_node.$component_ref), [ROUTE_STEP]);
  assert.deepEqual(sourcesOf(ROUTE_STEP, "next"), [[OUTCOME_STEP, "next"]]);
  const route = parts[ROUTE_STEP];
  assert.equal(route.component_type, "BranchingNode");
  for (const code of ["written", "node_changed", ...REFUSAL_CODES]) {
    assert.equal(route.mapping[code], code, `${code} maps to its own branch`);
    assert.ok(route.branches.includes(code));
    assert.equal(controlFrom(ROUTE_STEP).filter((e) => e.from_branch === code).length, 1, `the branch ${code} has one edge`);
  }
  const target = (branch) => controlFrom(ROUTE_STEP).find((e) => e.from_branch === branch).to_node.$component_ref;
  assert.equal(target("node_changed"), READ_STEP, "node_changed returns to the read");
  assert.equal(target("written"), "emit_output");
  for (const code of REFUSAL_CODES) assert.equal(target(code), "emit_output", `${code} ends the run with its message`);
  assert.equal(target("default"), "emit_output");
});

test("M13 after node_changed the review shows a notice that the page changed and the change was proposed again", () => {
  assert.deepEqual(sourcesOf(REVIEW_STEP, "reviewNotice"), [[OUTCOME_STEP, "reviewNotice"]]);
  const input = parts[REVIEW_STEP].inputs.find((i) => i.title === "reviewNotice");
  assert.equal(input.default, "", "the first review shows no notice");
  assert.equal(cinatraOf(parts[REVIEW_STEP]).surfaceGateInputs, true, "the review shows its inputs");
});

const outcomeCall = (answer, over = {}) => ({
  op: "outcome",
  ok: JSON.stringify(answer.ok ?? true),
  code: JSON.stringify(answer.code ?? ""),
  applied: JSON.stringify(answer.applied ?? false),
  answerNodeId: JSON.stringify(answer.nodeId ?? ""),
  revisionId: JSON.stringify(answer.revision_id ?? 0),
  storedFields: JSON.stringify(answer.fields ?? {}),
  nodeId: JSON.stringify("7"),
  instanceId: JSON.stringify("site-1"),
  title: JSON.stringify("Opening hours"),
  body: JSON.stringify("<p>Old</p>"),
  fieldValues: JSON.stringify([{ field: "field_tagline", value: "Open daily" }]),
  status: JSON.stringify("published"),
  reviewedFields: JSON.stringify({ body: "<p>New</p>" }),
  reviewedRevisionId: JSON.stringify("revision-2"),
  ...over,
});
const saved = (over = {}) => ({
  nodeId: "7",
  revision_id: 42,
  applied: true,
  status: "draft",
  fields: { body: [{ value: "<p>New</p>", format: "basic_html", summary: "" }] },
  ...over,
});

test("M14 a save answers the stored values as the changes, with an empty reason", async () => {
  const { extensionTool } = await load();
  const out = await extensionTool({ input: outcomeCall(saved()), ports: {} });
  assert.equal(out.next, "written");
  assert.deepEqual(out.changes, [{ field: "body", before: "<p>Old</p>", after: "<p>New</p>" }]);
  assert.equal(out.reason, "");
  assert.deepEqual(out.error, {});
  assert.equal(out.reviewNotice, "");
  const two = await extensionTool({
    input: outcomeCall(
      saved({ fields: { title: [{ value: "New" }], field_tagline: [{ value: "Open on Sundays too" }] } }),
      { reviewedFields: JSON.stringify({ title: "New", field_tagline: "Open on Sundays too" }), status: JSON.stringify("draft") },
    ),
    ports: {},
  });
  assert.deepEqual(two.changes, [
    { field: "title", before: "Opening hours", after: "New" },
    { field: "field_tagline", before: "Open daily", after: "Open on Sundays too" },
  ]);
});

test("M15 node_changed answers the way back to the read and a notice, and no error", async () => {
  const { extensionTool } = await load();
  const out = await extensionTool({ input: outcomeCall({ ok: false, code: "node_changed" }), ports: {} });
  assert.equal(out.next, "node_changed");
  assert.match(out.reviewNotice, /changed on the site/);
  assert.match(out.reviewNotice, /^Nothing was written/);
  assert.deepEqual(out.changes, []);
  assert.deepEqual(out.error, {});
});

test("M16 every other refusal ends the run with its code and a plain message of its own; write_unverified says to check the page", async () => {
  const { extensionTool } = await load();
  const messages = new Set();
  for (const code of REFUSAL_CODES) {
    const out = await extensionTool({ input: outcomeCall({ ok: false, code, message: `${code}: site text <b>` }), ports: {} });
    assert.equal(out.next, code);
    assert.equal(out.error.code, code);
    assert.equal(out.error.message, out.reason);
    assert.equal(out.reason.includes("site text"), false, "the connector's own text is not repeated");
    assert.deepEqual(out.changes, []);
    if (code === "write_unverified") {
      assert.match(out.reason, /may have been saved/);
      assert.match(out.reason, /[Cc]heck the page on the site before trying again/);
    } else {
      assert.match(out.reason, /^Nothing was written/, `${code}: the message says nothing was written`);
    }
    messages.add(out.reason);
  }
  assert.equal(messages.size, REFUSAL_CODES.length, "each code has its own message");
});

test("M17 an answer that is neither a save nor a known refusal fails the run and says the outcome is not known", async () => {
  const { extensionTool } = await load();
  for (const answer of [
    {},
    { ok: false, code: "other" },
    { ok: false, code: "" },
    saved({ nodeId: "8" }),
    saved({ revision_id: 0 }),
    saved({ fields: {} }),
    saved({ fields: { title: [{ value: "x" }] } }),
    { ok: false, code: "node_changed", applied: true },
  ]) {
    await assert.rejects(extensionTool({ input: outcomeCall(answer), ports: {} }), refusedWith("write_answer_unreadable"), JSON.stringify(answer).slice(0, 80));
  }
});

test("M18 the read-back answers the reviewed values as one object of the changed fields and the reviewed revision as the card's list", async () => {
  const outputs = parts[REVIEWED_READ].outputs;
  assert.equal(outputs.find((o) => o.title === "reviewedFields").type, "object");
  assert.ok(titles(outputs).includes("reviewedSnapshot"));
  assert.equal(titles(outputs).includes("reviewedPublish"), false, "the flow never publishes");
});

test("M19 the package consumes the read tool and the two write tools, and declares the pack tool", () => {
  const consumed = pkg.cinatra.consumes.filter((c) => c.requirement === "required").map((c) => c.primitive).sort();
  assert.deepEqual(consumed, [DRAFT_TOOL, READ_TOOL, UPDATE_TOOL].sort());
  assert.ok(pkg.cinatra.tools.some((t) => t.name === "reviewed_change"));
  assert.equal(pkg.cinatra.tools.some((t) => t.name === "settle_outcome"), false, "the outcome is settled by the reviewed_change tool");
});
