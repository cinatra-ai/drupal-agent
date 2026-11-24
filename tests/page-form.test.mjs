// cinatra-ai/cinatra#3745 — the words the review shows are derived from the
// values the write step writes, by one function in code.
//
// The compose step answers only the values to write (`writeFields`). The step
// `form_page` calls the pack's `reviewed_change` tool (`op: form`), which
// builds the page snapshot: the page, the values to write and the changed
// blocks the display draws (`excerpts`), each derived by `pageExcerpts` from
// the read and the values to write. After the review, the read-back
// (`op: read`) derives the blocks again from the reviewed values and the same
// read and refuses when the reviewed text shows other blocks.
//
// The display draws only the blocks' plain words, never `writeFields`. So a
// change that alters only markup (a link target, an attribute, a list type, a
// comment, an image) has no words to show: the derivation refuses it, and the
// value is never filed for review and never written.
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

const CODE = "reviewed_change_unavailable";
const FORM = "form_page";
const COMPOSE = "compose_change";
const FILE = "file_page";
const READ_REVIEWED = "read_reviewed_page";

const sourcesOf = (node, input) =>
  oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => [e.source_node.$component_ref, e.source_output]);
const titles = (list) => (list ?? []).map((entry) => entry.title);
const refusedWithCode = (err) =>
  err instanceof Error && err.name === "ExtensionToolCallRefusal" && err.message.startsWith(`${CODE}: `) && !err.message.includes("\n");

async function load() {
  return import("../cinatra/tools/reviewed-change.mjs");
}

const READ = {
  title: "Opening hours",
  body: "<h2>When we open</h2><p>We open at <a href=\"/hours\">nine</a> on weekdays.</p><ul><li>Sunday: closed</li><li>Saturday: closed</li></ul>",
  fieldValues: [{ field: "field_note", value: "Plain note" }],
  address: "https://www.example.org/node/7",
};

/** The form call as the flow renders it: each value as JSON text. */
const formCall = (writeFields, read = READ, error = { code: "", message: "" }) => ({
  op: "form",
  writeFields: JSON.stringify(writeFields),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
  address: JSON.stringify(read.address),
  error: JSON.stringify(error),
});

const withBody = (body, publish = false) => ({ fields: [{ field: "body", value: body }], publish });

// ---------------------------------------------------------------------------

test("F1 the form step stands between the compose step and the filing step, and builds the filed form in code", () => {
  const road = oas.nodes.map((n) => n.$component_ref);
  assert.deepEqual(road.slice(road.indexOf(COMPOSE), road.indexOf(FILE) + 1), [COMPOSE, FORM, FILE]);
  const node = parts[FORM];
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.endsWith("/api/agents/passthrough"));
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, "reviewed_change");
  assert.equal(node.data.input.input.op, "form");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  assert.deepEqual(sourcesOf(FORM, "writeFields"), [[COMPOSE, "writeFields"]]);
  for (const input of ["title", "body", "fieldValues", "address", "error"]) {
    assert.deepEqual(sourcesOf(FORM, input), [["read_node", input]], `${input} comes from the read step`);
  }
  assert.deepEqual(titles(node.outputs), ["pageForm", "ok"]);
  assert.deepEqual(sourcesOf(FILE, "pageForm"), [[FORM, "pageForm"]], "the filed form is the form the code built");
  assert.deepEqual(titles(parts[COMPOSE].outputs), ["pageTitle", "writeFields"], "the compose step answers only the values to write");
  assert.equal(parts[COMPOSE].data.system.includes("`excerpts`"), false, "the compose step no longer writes the shown blocks");
  for (const input of ["title", "body", "fieldValues"]) {
    assert.deepEqual(sourcesOf(READ_REVIEWED, input), [["read_node", input]], `the read-back gets ${input} from the read step`);
  }
});

test("F2 the shown blocks are derived from the values to write: a changed heading, paragraph and list item", async () => {
  const { extensionTool } = await load();
  const body = READ.body.replace("nine</a>", "eight</a>").replace("Saturday: closed", "Saturday: ten to two");
  const result = await extensionTool({
    input: formCall({ fields: [{ field: "title", value: "Opening hours and holidays" }, { field: "body", value: body }], publish: true }),
    ports: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pageForm, {
    cinatraCmsPage: 1,
    system: "drupal",
    page: { title: "Opening hours", address: READ.address, cmsAddress: `${READ.address}/edit` },
    writeFields: { fields: [{ field: "title", value: "Opening hours and holidays" }, { field: "body", value: body }], publish: true },
    excerpts: [
      { region: "title", position: 0, kind: "heading", level: 1, published: "Opening hours", proposed: "Opening hours and holidays" },
      { region: "body", position: 1, kind: "paragraph", level: null, published: "We open at nine on weekdays.", proposed: "We open at eight on weekdays." },
      { region: "body", position: 3, kind: "list-item", level: null, published: "Saturday: closed", proposed: "Saturday: ten to two" },
    ],
  });
});

test("F3 added and removed blocks, a value without markup, inline markup and entities", async () => {
  const { pageExcerpts } = await load();
  const read = { title: "T", body: "<p>One</p><p>Two</p>", fieldValues: [{ field: "field_note", value: "Plain note" }] };
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p><p>Two</p><p>Three &amp; four</p>" }] }), [
    { region: "body", position: 2, kind: "paragraph", level: null, published: "", proposed: "Three & four" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p>" }] }), [
    { region: "body", position: 1, kind: "paragraph", level: null, published: "Two", proposed: "" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "field_note", value: "A <em>new</em> note" }] }), [
    { region: "field_note", position: 0, kind: "paragraph", level: null, published: "Plain note", proposed: "A new note" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p>\n\n<p>Two</p>" }] }), [], "white space between blocks is no change");
  const once = pageExcerpts(read, { fields: [{ field: "body", value: "<h3>New</h3><p>Two</p>" }] });
  assert.deepEqual(once, pageExcerpts(read, { fields: [{ field: "body", value: "<h3>New</h3><p>Two</p>" }] }), "the same values give the same blocks");
  assert.deepEqual(once, [{ region: "body", position: 0, kind: "heading", level: 3, published: "One", proposed: "New" }]);
});

test("F4 a change the display cannot show is refused before it is filed: markup alone, no words", async () => {
  const { extensionTool } = await load();
  const cases = {
    "a link target": READ.body.replace('href="/hours"', 'href="https://elsewhere.example/"'),
    "an attribute": READ.body.replace("<p>", '<p class="x">'),
    "a list type": READ.body.replace("<ul>", "<ol>").replace("</ul>", "</ol>"),
    "an added comment": `${READ.body}<!-- hidden -->`,
    "an added image": `${READ.body}<img src="https://elsewhere.example/a.png">`,
    "a paragraph made a heading": READ.body.replace("<p>We open", "<h3>We open").replace("weekdays.</p>", "weekdays.</h3>"),
    "an added script": READ.body.replace("<h2>", "<script></script><h2>"),
    "an image next to a changed paragraph": READ.body.replace("nine</a> on weekdays.</p>", 'ten</a> on weekdays.</p><img src="https://elsewhere.example/a.png">'),
  };
  for (const [name, body] of Object.entries(cases)) {
    await assert.rejects(extensionTool({ input: formCall(withBody(body)), ports: {} }), refusedWithCode, name);
  }
});

test("F5 the form refuses a field the read did not return, values after a failed read, and too many blocks", async () => {
  const { extensionTool } = await load();
  await assert.rejects(extensionTool({ input: formCall({ fields: [{ field: "field_other", value: "x" }], publish: false }), ports: {} }), refusedWithCode);
  await assert.rejects(
    extensionTool({ input: formCall(withBody("<p>x</p>"), READ, { code: "read-failed", message: "no" }), ports: {} }),
    refusedWithCode,
  );
  const many = Array.from({ length: 201 }, (_, i) => `<p>n${i}</p>`).join("");
  await assert.rejects(extensionTool({ input: formCall(withBody(many)), ports: {} }), refusedWithCode);
  for (const bad of [{ fields: "x", publish: false }, { fields: [], publish: "true" }, { fields: [{ field: "title", value: 1 }], publish: false }]) {
    await assert.rejects(extensionTool({ input: formCall(bad), ports: {} }), refusedWithCode, JSON.stringify(bad));
  }
  const nothing = await extensionTool({ input: formCall({ fields: [], publish: false }, READ, { code: "read-failed", message: "no" }), ports: {} });
  assert.deepEqual(nothing.pageForm.excerpts, [], "a failed read files an empty change, which the read-back refuses");
});

// --- the read-back compares what was shown with what is written ------------

const FILED = { artifactId: "artifact-7", representationRevisionId: "revision-1" };
const answer = JSON.stringify({ approved: true, review: { decision: "approved", targets: [FILED] } });
const readCall = (read = READ) => ({
  op: "read",
  artifactId: FILED.artifactId,
  reviewAnswer: JSON.stringify(answer),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
});
const portsWith = (form) => ({
  artifacts: {
    async contentRead(request) {
      return { ...request, text: JSON.stringify(form), truncated: false };
    },
  },
});

test("F6 the read-back answers the values only when the reviewed text shows the blocks derived from them", async () => {
  const { extensionTool } = await load();
  const body = READ.body.replace("Saturday: closed", "Saturday: ten to two");
  const { pageForm } = await extensionTool({ input: formCall(withBody(body)), ports: {} });
  const result = await extensionTool({ input: readCall(), ports: portsWith(pageForm) });
  assert.deepEqual(result.reviewedFields, [{ field: "body", value: body }]);

  const tampered = {
    "another proposed word": { ...pageForm, excerpts: [{ ...pageForm.excerpts[0], proposed: "Saturday: open" }] },
    "a block left out": { ...pageForm, excerpts: [] },
    "a block added": { ...pageForm, excerpts: [...pageForm.excerpts, { region: "body", position: 9, kind: "paragraph", level: null, published: "", proposed: "x" }] },
    "no blocks at all": { ...pageForm, excerpts: undefined },
    "another value than shown": { ...pageForm, writeFields: withBody(body.replace("ten to two", "ten to three")) },
    "a markup-only value": { ...pageForm, writeFields: withBody(body.replace('href="/hours"', 'href="https://elsewhere.example/"')) },
  };
  for (const [name, form] of Object.entries(tampered)) {
    await assert.rejects(extensionTool({ input: readCall(), ports: portsWith(form) }), refusedWithCode, name);
  }
  await assert.rejects(
    extensionTool({ input: { ...readCall(), fieldValues: JSON.stringify("x") }, ports: portsWith(pageForm) }),
    refusedWithCode,
    "a read without its field list",
  );
});
