// cinatra-ai/cinatra#3745 — the write step writes only what a person reviewed.
//
// The compose step files the values to write in the page snapshot itself
// (`writeFields`: the fields and the publish flag). After the review,
// `read_reviewed_page` reads back the revision the person approved — the
// revision the review's answer names, which after a Regenerate is a successor
// of the one this run filed — through the pack's `reviewed_change` tool. The
// write step and the settle step take the values only from that read. No value
// reaches the write step from the compose step around the review.
//
// A change that changes nothing never reaches the review: `form_page` answers
// `next: "no_change"`, the branch `route_change` takes the run past the filing
// and the review to `no_change_outcome`, and the run ends completed with empty
// `changes` and a reason built by code that repeats the request and says that
// nothing was reviewed or written, without a site call.
//
// When the reviewed change is not usable, the tool refuses: the step fails,
// so the run ends with `reviewed_change_unavailable` and a message, and the
// write step, the only step that names a site tool, never runs. The cases:
// the answer names no approved revision of the filed artifact (another
// artifact, no target, no approval), the read fails, is cut short or answers
// another revision, or the text carries no values to write.
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const parts = oas.$referenced_components;

const REVIEW = "page_review_gate";
const READ_REVIEWED = "read_reviewed_page";
const WRITES = ["write_draft", "write_unpublished"];
const ROUTE = "route_status";
const OUTCOME = "write_outcome";
const COMPOSE = "compose_change";
const TOOL_NAME = "reviewed_change";
const MODULE = "./cinatra/tools/reviewed-change.mjs";
const PAGE_TYPE = "@cinatra-ai/website-artifacts:page-snapshot";
const CODE = "reviewed_change_unavailable";
const SITE_TOOLS = ["drupal_node_read_for_edit", "drupal_node_update", "drupal_node_create_draft_revision", "drupal_node_publish"];

const FILED = { artifactId: "artifact-7", representationRevisionId: "revision-1" };
const SUCCESSOR = "revision-2";

const sourcesOf = (node, input) =>
  oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => [e.source_node.$component_ref, e.source_output]);
const controlInto = (node) =>
  oas.control_flow_connections.filter((e) => e.to_node.$component_ref === node).map((e) => e.from_node.$component_ref);
const titles = (list) => (list ?? []).map((entry) => entry.title);

/** The review's answer as the application sends it into the paused run on an approval. */
function answer(targets, extra = {}) {
  return JSON.stringify({
    approved: true,
    review: { envelopeVersion: 1, decision: "approved", reviewTaskId: "wayflow-task-1", comment: null, targets },
    ...extra,
  });
}

/** The block the review shows for the title change, and none without it. */
const TITLE_EXCERPT = { region: "title", position: 0, kind: "heading", level: 1, published: "Opening hours", proposed: "Opening hours and holidays" };

/** A page snapshot text as the form step files it. */
function snapshot(writeFields, over = {}) {
  const changesTitle = Array.isArray(writeFields?.fields) && writeFields.fields.some((f) => f?.field === "title");
  return JSON.stringify({
    cinatraCmsPage: 1,
    system: "drupal",
    page: { nodeId: "7", status: "draft", title: "Opening hours", address: null, cmsAddress: null },
    writeFields,
    excerpts: changesTitle ? [TITLE_EXCERPT] : [],
    ...over,
  });
}

const WRITE_FIELDS = { fields: [{ field: "title", value: "Opening hours and holidays" }], publish: false };

/** Fake ports that answer one read, and record every read asked for. */
function portsAnswering(result) {
  const reads = [];
  return {
    reads,
    ports: {
      artifacts: {
        async contentRead(request) {
          reads.push(request);
          if (result instanceof Error) throw result;
          return typeof result === "function" ? result(request) : result;
        },
      },
    },
  };
}

const readOf = (text, over = {}) => (request) => ({
  artifactId: request.artifactId,
  representationRevisionId: request.representationRevisionId,
  mime: "application/json",
  text,
  truncated: false,
  ...over,
});

/** The call as the flow renders it: each value the flow sends as JSON text, with the read the review was based on. */
const call = (reviewAnswer, artifactId = FILED.artifactId) => ({
  op: "read",
  artifactId,
  reviewAnswer: JSON.stringify(reviewAnswer),
  title: JSON.stringify("Opening hours"),
  body: JSON.stringify(""),
  fieldValues: JSON.stringify([]),
  address: JSON.stringify(""),
  error: JSON.stringify({ code: "", message: "" }),
  nodeId: JSON.stringify("7"),
  nodeStatus: JSON.stringify("draft"),
});

async function load() {
  return import("../cinatra/tools/reviewed-change.mjs");
}

const refusedWithCode = (err) =>
  err instanceof Error && err.name === "ExtensionToolCallRefusal" && err.message.startsWith(`${CODE}: `) && !err.message.includes("\n");

// ---------------------------------------------------------------------------

test("V1 the read of the reviewed revision stands between the review and the write, and reaches no site", () => {
  const road = oas.nodes.map((n) => n.$component_ref);
  assert.deepEqual(road.slice(road.indexOf(REVIEW), road.indexOf(ROUTE) + 1), [REVIEW, READ_REVIEWED, ROUTE]);
  assert.deepEqual(controlInto(READ_REVIEWED), [REVIEW]);
  assert.deepEqual(controlInto(ROUTE), [READ_REVIEWED], "the branch to the writes is reached only through the read");
  for (const write of WRITES) assert.deepEqual(controlInto(write), [ROUTE], `${write} is reached only through the branch`);
  const node = parts[READ_REVIEWED];
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.endsWith("/api/agents/passthrough"));
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, TOOL_NAME);
  assert.equal(node.data.input.input.op, "read");
  assert.equal(node.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  assert.equal("publishes" in node.metadata.cinatra, false);
  assert.equal("completed_error_codes" in node.data, false, "a refusal of the read fails the step, and so the run");
  for (const tool of SITE_TOOLS) assert.equal(JSON.stringify(node).includes(tool), false, `the read names no ${tool}`);
  assert.ok(pkg.cinatra.tools.some((t) => t.name === TOOL_NAME && t.module === MODULE), "the pack declares the module");
});

test("V2 the read takes the filed artifact and the review's answer, and nothing from the compose step", () => {
  assert.deepEqual(sourcesOf(READ_REVIEWED, "artifactId"), [["file_page", "artifactId"]]);
  assert.deepEqual(sourcesOf(READ_REVIEWED, "reviewAnswer"), [[REVIEW, "pageReviewNote"]], "the approved revision comes from the review's answer");
  assert.deepEqual(sourcesOf(READ_REVIEWED, "cinatra_run_id"), [["start", "cinatra_run_id"]]);
  const sources = oas.data_flow_connections.filter((e) => e.destination_node.$component_ref === READ_REVIEWED);
  assert.deepEqual(sources.filter((e) => e.source_node.$component_ref === COMPOSE), []);
  assert.deepEqual(sourcesOf(READ_REVIEWED, "representationRevisionId"), [], "the revision this run filed is not what the read reads");
  assert.deepEqual(titles(parts[READ_REVIEWED].outputs), ["reviewedFields", "reviewedRevisionId", "reviewedSnapshot", "ok"]);
});

test("V3 every value the write steps and the outcome step get of the change traces to the reviewed revision, not to the compose step", () => {
  for (const step of [...WRITES, OUTCOME]) {
    const into = oas.data_flow_connections.filter((e) => e.destination_node.$component_ref === step);
    assert.deepEqual(into.filter((e) => e.source_node.$component_ref === COMPOSE), [], `no edge from the compose step into ${step}`);
    assert.deepEqual(sourcesOf(step, "reviewedFields"), [[READ_REVIEWED, "reviewedFields"]]);
  }
  for (const write of WRITES) assert.deepEqual(sourcesOf(write, "reviewedSnapshot"), [[READ_REVIEWED, "reviewedSnapshot"]]);
  assert.deepEqual(sourcesOf(OUTCOME, "reviewedRevisionId"), [[READ_REVIEWED, "reviewedRevisionId"]]);
  assert.equal(titles(parts[COMPOSE].outputs).includes("proposedFields"), false, "the compose step answers the values only inside the page form");
});

test("V4 the compose step answers the values to write, and the filed page form carries them", () => {
  const schemas = [
    ["compose_change.writeFields", parts[COMPOSE].outputs.find((x) => x.title === "writeFields").json_schema],
    ["form_page.pageForm", parts.form_page.outputs.find((x) => x.title === "pageForm").json_schema.properties.writeFields],
    ["file_page.pageForm", parts.file_page.inputs.find((x) => x.title === "pageForm").json_schema.properties.writeFields],
  ];
  for (const [name, writeFields] of schemas) {
    assert.ok(writeFields, `${name} declares writeFields`);
    assert.deepEqual(Object.keys(writeFields.properties).sort(), ["fields", "publish"]);
    assert.equal(writeFields.properties.publish.type, "boolean");
    assert.deepEqual(Object.keys(writeFields.properties.fields.items.properties).sort(), ["field", "value"]);
  }
  const system = parts[COMPOSE].data.system;
  assert.ok(system.includes("`writeFields`"));
  assert.ok(system.includes("reviewer finding is never a publish request"));
  const example = system.split("--- example form begin ---")[1].split("--- example form end ---")[0];
  const writeFields = JSON.parse(example.trim());
  assert.ok(Array.isArray(writeFields.fields) && writeFields.fields.length > 0);
  assert.equal(writeFields.publish, false);
});

test("V5 the tool reads the APPROVED revision the review's answer names, and answers its values", async () => {
  const { extensionTool } = await load();
  const { reads, ports } = portsAnswering(readOf(snapshot(WRITE_FIELDS)));
  const result = await extensionTool({
    input: call(answer([{ artifactId: FILED.artifactId, representationRevisionId: SUCCESSOR }])),
    ports,
  });
  assert.deepEqual(reads, [{ artifactId: FILED.artifactId, representationRevisionId: SUCCESSOR, objectType: PAGE_TYPE }]);
  assert.deepEqual(result, {
    ok: true,
    reviewedFields: { title: "Opening hours and holidays" },
    reviewedRevisionId: SUCCESSOR,
    reviewedSnapshot: [{ artifactId: FILED.artifactId, representationRevisionId: SUCCESSOR }],
  });
});

test("V6 a reviewed revision that asks to publish is refused: this agent never publishes", async () => {
  const { extensionTool } = await load();
  const { ports } = portsAnswering(readOf(snapshot({ ...WRITE_FIELDS, publish: true })));
  await assert.rejects(extensionTool({ input: call(answer([FILED])), ports }), refusedWithCode, "a publish with a change");
  const { ports: publishOnly } = portsAnswering(readOf(snapshot({ fields: [], publish: true })));
  await assert.rejects(extensionTool({ input: call(answer([FILED])), ports: publishOnly }), refusedWithCode, "a publish alone");
  for (const publish of ["true", 1, null, undefined]) {
    const { ports: bad } = portsAnswering(readOf(snapshot({ fields: WRITE_FIELDS.fields, publish })));
    await assert.rejects(extensionTool({ input: call(answer([FILED])), ports: bad }), refusedWithCode, `publish ${JSON.stringify(publish)}`);
  }
  assert.equal(JSON.stringify(oas).includes("drupal_node_publish"), false, "no step of the flow can publish");
});

test("V7 an answer that names no approved revision of the filed artifact is refused before any read", async () => {
  const { extensionTool } = await load();
  const cases = {
    "another artifact": answer([{ artifactId: "artifact-8", representationRevisionId: SUCCESSOR }]),
    "two targets": answer([FILED, { artifactId: "artifact-8", representationRevisionId: "r" }]),
    "no target": answer([]),
    "no revision id": answer([{ artifactId: FILED.artifactId, representationRevisionId: "" }]),
    "no approval": JSON.stringify({ review: { decision: "rejected", targets: [FILED] } }),
    "approved, but the decision is rejected": answer([FILED]).replace('"decision":"approved"', '"decision":"rejected"'),
    "approved, but changes are requested": answer([FILED]).replace('"decision":"approved"', '"decision":"changes_requested"'),
    "approved, but no decision": JSON.stringify({ approved: true, review: { envelopeVersion: 1, reviewTaskId: "t", comment: null, targets: [FILED] } }),
    "a decision approved, but not approved": JSON.stringify({ approved: false, review: { envelopeVersion: 1, decision: "approved", targets: [FILED] } }),
    "a decision approved, but no approval marker": JSON.stringify({ review: { envelopeVersion: 1, decision: "approved", targets: [FILED] } }),
    "an approval marker that is text": answer([FILED]).replace('"approved":true', '"approved":"true"'),
    "another envelope version": answer([FILED]).replace('"envelopeVersion":1', '"envelopeVersion":2'),
    "no envelope version": JSON.stringify({ approved: true, review: { decision: "approved", targets: [FILED] } }),
    "no targets": JSON.stringify({ approved: true, review: { envelopeVersion: 1, decision: "approved" } }),
    "a target without its artifact": answer([{ representationRevisionId: SUCCESSOR }]),
    "a target that is not an object": answer(["artifact-7"]),
    "not JSON": "approved",
    empty: "",
  };
  for (const [name, text] of Object.entries(cases)) {
    const { reads, ports } = portsAnswering(readOf(snapshot(WRITE_FIELDS)));
    await assert.rejects(extensionTool({ input: call(text), ports }), refusedWithCode, name);
    assert.deepEqual(reads, [], `${name}: nothing is read`);
  }
  const { ports } = portsAnswering(readOf(snapshot(WRITE_FIELDS)));
  await assert.rejects(extensionTool({ input: call(answer([FILED]), ""), ports }), refusedWithCode, "no filed artifact");
});

test("V8 a read that fails, is cut short or answers another revision or artifact is refused", async () => {
  const { extensionTool } = await load();
  const text = snapshot(WRITE_FIELDS);
  const cases = {
    "read fails": new Error("artifact_content_read: representation revision-1 does not resolve"),
    "cut short": readOf(text, { truncated: true }),
    "no truncated flag": readOf(text, { truncated: undefined }),
    "another revision": readOf(text, { representationRevisionId: "revision-9" }),
    "another artifact": readOf(text, { artifactId: "artifact-8" }),
    "no text": readOf(undefined),
    "not an object": () => "text",
  };
  for (const [name, result] of Object.entries(cases)) {
    const { ports } = portsAnswering(result);
    await assert.rejects(extensionTool({ input: call(answer([FILED])), ports }), refusedWithCode, name);
  }
});

test("V9 a reviewed text that carries no values to write is refused (the flow files no such text: it ends a change of nothing before the filing, V11)", async () => {
  const { extensionTool } = await load();
  const cases = {
    "no writeFields": snapshot(undefined),
    "no fields, no publish": snapshot({ fields: [], publish: false }),
    "fields not a list": snapshot({ fields: { title: "x" }, publish: false }),
    "a field without a name": snapshot({ fields: [{ field: "", value: "x" }], publish: false }),
    "a value that is not text": snapshot({ fields: [{ field: "title", value: 3 }], publish: false }),
    "a field named twice": snapshot({ fields: [{ field: "title", value: "a" }, { field: "title", value: "b" }], publish: false }),
    "another system": snapshot(WRITE_FIELDS, { system: "wordpress" }),
    "another form version": snapshot(WRITE_FIELDS, { cinatraCmsPage: 2 }),
    "not JSON": "{",
  };
  for (const [name, text] of Object.entries(cases)) {
    const { ports } = portsAnswering(readOf(text));
    await assert.rejects(extensionTool({ input: call(answer([FILED])), ports }), refusedWithCode, name);
  }
});

test("V10 a refusal makes no site call: the write steps never run after a failed read", async () => {
  // The refusal fails the read step. Each write step is the only step that
  // names its site tool, and its one way in is the branch after the read.
  for (const [tool, step] of [["drupal_node_update", "write_unpublished"], ["drupal_node_create_draft_revision", "write_draft"]]) {
    const callers = oas.nodes.map((n) => n.$component_ref).filter((id) => JSON.stringify(parts[id]).includes(tool));
    assert.deepEqual(callers, [step], `${tool} is named by ${step} only`);
    assert.deepEqual(controlInto(step), [ROUTE]);
  }
  assert.deepEqual(controlInto(ROUTE), [READ_REVIEWED]);
  for (const id of oas.nodes.map((n) => n.$component_ref)) {
    assert.equal("completed_error_codes" in (parts[id].data ?? {}), false, `${id} lists no completed code`);
  }
  const { extensionTool } = await load();
  await assert.rejects(extensionTool({ input: { op: "write" }, ports: {} }), /`op` must be page, form, unchanged, read or outcome/);
});

test("V11 a change of nothing ends the run completed, past the filing and the review, and makes no site call", async () => {
  const BRANCH = "route_change";
  const NO_CHANGE = "no_change_outcome";
  const branch = parts[BRANCH];
  assert.equal(branch.component_type, "BranchingNode");
  assert.deepEqual(branch.branches, ["default", "no_change"]);
  assert.deepEqual(branch.mapping, { no_change: "no_change" });
  assert.deepEqual(sourcesOf(BRANCH, "next"), [["form_page", "next"]]);
  const edges = oas.control_flow_connections.map((e) => [e.from_node.$component_ref, e.from_branch ?? null, e.to_node.$component_ref]);
  assert.deepEqual(edges.filter(([from]) => from === "form_page"), [["form_page", null, BRANCH]]);
  assert.deepEqual(edges.filter(([from]) => from === BRANCH), [[BRANCH, "default", "file_page"], [BRANCH, "no_change", NO_CHANGE]], "any other answer goes to the review");
  assert.deepEqual(edges.filter(([from]) => from === NO_CHANGE), [[NO_CHANGE, null, "emit_output"]]);
  assert.deepEqual(controlInto("file_page"), [BRANCH]);

  // The no-change road: the branch, the no-change step, the output, the end. No filing, no review, no write.
  const node = parts[NO_CHANGE];
  assert.equal(node.component_type, "ApiNode");
  assert.equal(node.data.input.name, TOOL_NAME);
  assert.equal(node.data.input.input.op, "unchanged");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  for (const tool of SITE_TOOLS) assert.equal(JSON.stringify(node).includes(tool), false, `the no-change step names no ${tool}`);
  assert.deepEqual(sourcesOf(NO_CHANGE, "writeFields"), [[COMPOSE, "writeFields"]]);
  assert.deepEqual(sourcesOf(NO_CHANGE, "nodeId"), [["start", "nodeId"]]);
  for (const input of ["nodeId", "changes", "reason", "error"]) {
    assert.deepEqual(sourcesOf("emit_output", input), [[OUTCOME, input], [NO_CHANGE, input]], `the output's ${input} comes from the one step that ran`);
    assert.deepEqual(sourcesOf("end", input), [[OUTCOME, input], [NO_CHANGE, input]], `the end's ${input} comes from the one step that ran`);
  }

  // What the steps answer for the compose step's answer to a request that changes nothing.
  const { extensionTool } = await load();
  const read = {
    title: JSON.stringify("Opening hours"),
    body: JSON.stringify("<p>Open</p>"),
    fieldValues: JSON.stringify([]),
    error: JSON.stringify({ code: "", message: "" }),
    nodeStatus: JSON.stringify("draft"),
  };
  const nothing = JSON.stringify({ fields: [], publish: false });
  const formed = await extensionTool({ input: { op: "form", nodeId: JSON.stringify("7"), writeFields: nothing, address: JSON.stringify(""), ...read }, ports: {} });
  assert.equal(formed.next, "no_change");
  const instructions = JSON.stringify("Say that we open at nine");
  const outcome = await extensionTool({ input: { op: "unchanged", nodeId: JSON.stringify("7"), writeFields: nothing, instructions, ...read }, ports: {} });
  assert.deepEqual(outcome, {
    ok: true,
    nodeId: "7",
    changes: [],
    reason: 'No change was proposed for this request on node 7 ("Opening hours"), so nothing was reviewed or written: Say that we open at nine',
  });
  const equal = JSON.stringify({ fields: [{ field: "body", value: "<p>Open</p>" }], publish: false });
  assert.deepEqual(await extensionTool({ input: { op: "unchanged", nodeId: JSON.stringify("7"), writeFields: equal, instructions, ...read }, ports: {} }), outcome);

  // The no-change step refuses whatever would need the review: a change, a publish, a failed read.
  const refused = {
    "a change": JSON.stringify({ fields: [{ field: "body", value: "<p>Closed</p>" }], publish: false }),
    "a publish": JSON.stringify({ fields: [], publish: true }),
    "no values": JSON.stringify("x"),
  };
  for (const [name, writeFields] of Object.entries(refused)) {
    await assert.rejects(extensionTool({ input: { op: "unchanged", nodeId: JSON.stringify("7"), writeFields, ...read }, ports: {} }), refusedWithCode, name);
  }
  await assert.rejects(
    extensionTool({ input: { op: "unchanged", nodeId: JSON.stringify("7"), writeFields: nothing, ...read, error: JSON.stringify({ code: "read-failed", message: "no" }) }, ports: {} }),
    refusedWithCode,
    "a failed read",
  );
});
