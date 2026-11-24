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
const WRITE = "load_node";
const SETTLE = "settle_outcome";
const COMPOSE = "compose_change";
const TOOL_NAME = "reviewed_change";
const MODULE = "./cinatra/tools/reviewed-change.mjs";
const PAGE_TYPE = "@cinatra-ai/website-artifacts:page-snapshot";
const CODE = "reviewed_change_unavailable";
const SITE_TOOLS = ["drupal_node_get", "drupal_node_update", "drupal_node_create_draft_revision", "drupal_node_publish"];

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
    page: { title: "Opening hours", address: null, cmsAddress: null },
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
});

async function load() {
  return import("../cinatra/tools/reviewed-change.mjs");
}

const refusedWithCode = (err) =>
  err instanceof Error && err.name === "ExtensionToolCallRefusal" && err.message.startsWith(`${CODE}: `) && !err.message.includes("\n");

// ---------------------------------------------------------------------------

test("V1 the read of the reviewed revision stands between the review and the write, and reaches no site", () => {
  const road = oas.nodes.map((n) => n.$component_ref);
  assert.deepEqual(road.slice(road.indexOf(REVIEW), road.indexOf(WRITE) + 1), [REVIEW, READ_REVIEWED, WRITE]);
  assert.deepEqual(controlInto(READ_REVIEWED), [REVIEW]);
  assert.deepEqual(controlInto(WRITE), [READ_REVIEWED], "the write step is reached only through the read");
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
  assert.deepEqual(titles(parts[READ_REVIEWED].outputs), ["reviewedFields", "reviewedPublish", "reviewedRevisionId", "ok"]);
});

test("V3 every value the write step and the settle step get of the change traces to the read, not to the compose step", () => {
  const intoWrite = oas.data_flow_connections.filter((e) => e.destination_node.$component_ref === WRITE);
  assert.deepEqual(intoWrite.filter((e) => e.source_node.$component_ref === COMPOSE), [], "no edge from the compose step into the write step");
  const intoSettle = oas.data_flow_connections.filter((e) => e.destination_node.$component_ref === SETTLE);
  assert.deepEqual(intoSettle.filter((e) => e.source_node.$component_ref === COMPOSE), [], "no edge from the compose step into the settle step");
  assert.deepEqual(sourcesOf(WRITE, "reviewedFields"), [[READ_REVIEWED, "reviewedFields"]]);
  assert.deepEqual(sourcesOf(WRITE, "reviewedPublish"), [[READ_REVIEWED, "reviewedPublish"]]);
  assert.deepEqual(sourcesOf(WRITE, "representationRevisionId"), [[READ_REVIEWED, "reviewedRevisionId"]]);
  assert.deepEqual(sourcesOf(SETTLE, "proposedFields"), [[READ_REVIEWED, "reviewedFields"]]);
  assert.equal(titles(parts[WRITE].inputs).includes("proposedFields"), false);
  assert.equal(titles(parts[COMPOSE].outputs).includes("proposedFields"), false, "the compose step answers the values only inside the page form");

  const { system, user } = parts[WRITE].data;
  assert.ok(user.includes("- reviewedFields: {{ reviewedFields }}"));
  assert.ok(user.includes("- reviewedPublish: {{ reviewedPublish }}"));
  assert.equal(user.includes("proposedFields"), false);
  assert.equal(system.includes("proposedFields"), false, "the write step names no compose-step value");
  assert.ok(system.includes("build fields only from reviewedFields"));
  assert.ok(system.includes("The values you write come only from the reviewed revision"));
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
    reviewedFields: WRITE_FIELDS.fields,
    reviewedPublish: false,
    reviewedRevisionId: SUCCESSOR,
  });
});

test("V6 the publish branch also reads the reviewed revision: the publish flag comes from its text", async () => {
  const { extensionTool } = await load();
  const publishOnly = { fields: [], publish: true };
  const { ports } = portsAnswering(readOf(snapshot(publishOnly)));
  const result = await extensionTool({ input: call(answer([FILED])), ports });
  assert.equal(result.reviewedPublish, true);
  assert.deepEqual(result.reviewedFields, []);
  for (const publish of ["true", 1, null, undefined]) {
    const { ports: bad } = portsAnswering(readOf(snapshot({ fields: WRITE_FIELDS.fields, publish })));
    await assert.rejects(extensionTool({ input: call(answer([FILED])), ports: bad }), refusedWithCode, `publish ${JSON.stringify(publish)}`);
  }
  const system = parts[WRITE].data.system;
  assert.ok(system.includes("call drupal_node_publish only when reviewedPublish is true"));
});

test("V7 an answer that names no approved revision of the filed artifact is refused before any read", async () => {
  const { extensionTool } = await load();
  const cases = {
    "another artifact": answer([{ artifactId: "artifact-8", representationRevisionId: SUCCESSOR }]),
    "two targets": answer([FILED, { artifactId: "artifact-8", representationRevisionId: "r" }]),
    "no target": answer([]),
    "no revision id": answer([{ artifactId: FILED.artifactId, representationRevisionId: "" }]),
    "no approval": JSON.stringify({ review: { decision: "rejected", targets: [FILED] } }),
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

test("V9 a reviewed text that carries no values to write is refused", async () => {
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

test("V10 a refusal makes no site call: the write step never runs after a failed read", async () => {
  // The refusal fails the read step. The write step is the only step that
  // names a site tool, and its one way in is the read step.
  for (const tool of SITE_TOOLS.slice(1)) {
    const callers = oas.nodes.map((n) => n.$component_ref).filter((id) => JSON.stringify(parts[id]).includes(tool));
    assert.deepEqual(callers, [WRITE], `${tool} is named by the write step only`);
  }
  assert.deepEqual(controlInto(WRITE), [READ_REVIEWED]);
  for (const id of oas.nodes.map((n) => n.$component_ref)) {
    assert.equal("completed_error_codes" in (parts[id].data ?? {}), false, `${id} lists no completed code`);
  }
  const { extensionTool } = await load();
  await assert.rejects(extensionTool({ input: { op: "write" }, ports: {} }), /`op` must be form or read/);
});
