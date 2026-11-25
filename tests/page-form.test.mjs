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
// The display draws the excerpts' text as plain text, never `writeFields`. So
// each changed block is shown as its SOURCE text, on both sides: a changed link
// target, attribute, tag, comment or image is drawn as text whether or not the
// words change, and every block that is not shown is byte for byte the read.
// What the display still cannot show is refused before anything is filed: a
// block that changes only in its white space (the display's parser rejects a
// block whose two sides hold the same words), a changed block that holds a
// character that draws nothing or changes the text's direction, a changed
// block whose white space the display cannot draw, and more than 200 blocks.
//
// A change that changes nothing (no values, or values equal to the read, and
// no publish) files nothing: `form_page` answers `next: "no_change"` and the
// flow ends the run completed, past the filing and the review.
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
  nodeId: "7",
  nodeStatus: "published",
};

/** The page record the form files for READ. */
const PAGE = { nodeId: "7", status: "published", title: READ.title, address: READ.address, cmsAddress: `${READ.address}/edit` };

/** The form call as the flow renders it: each value as JSON text. */
const formCall = (writeFields, read = READ, error = { code: "", message: "" }) => ({
  op: "form",
  writeFields: JSON.stringify(writeFields),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
  address: JSON.stringify(read.address),
  error: JSON.stringify(error),
  nodeId: JSON.stringify(read.nodeId),
  nodeStatus: JSON.stringify(read.nodeStatus),
});

const withBody = (body, publish = false) => ({ fields: [{ field: "body", value: body }], publish });

// ---------------------------------------------------------------------------

test("F1 the form step stands between the compose step and the filing step, and builds the filed form in code", () => {
  const road = oas.nodes.map((n) => n.$component_ref);
  assert.deepEqual(road.slice(road.indexOf(COMPOSE), road.indexOf(FILE) + 1), [COMPOSE, FORM, "route_change", FILE]);
  const node = parts[FORM];
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.endsWith("/api/agents/passthrough"));
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, "reviewed_change");
  assert.equal(node.data.input.input.op, "form");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  assert.deepEqual(sourcesOf(FORM, "writeFields"), [[COMPOSE, "writeFields"]]);
  for (const input of ["title", "body", "fieldValues", "address", "error"]) {
    assert.deepEqual(sourcesOf(FORM, input), [["check_read", input]], `${input} comes from the check of the read`);
  }
  assert.deepEqual(titles(node.outputs), ["pageForm", "next", "ok"]);
  assert.deepEqual(sourcesOf(FILE, "pageForm"), [[FORM, "pageForm"]], "the filed form is the form the code built");
  assert.deepEqual(titles(parts[COMPOSE].outputs), ["pageTitle", "writeFields"], "the compose step answers only the values to write");
  assert.equal(parts[COMPOSE].data.system.includes("`excerpts`"), false, "the compose step no longer writes the shown blocks");
  for (const input of ["title", "body", "fieldValues"]) {
    assert.deepEqual(sourcesOf(READ_REVIEWED, input), [["check_read", input]], `the read-back gets ${input} from the check of the read`);
  }
});

test("F2 the shown blocks are derived from the values to write: a changed heading, paragraph and list item", async () => {
  const { extensionTool } = await load();
  const body = READ.body.replace("nine</a>", "eight</a>").replace("Saturday: closed", "Saturday: ten to two");
  const result = await extensionTool({
    input: formCall({ fields: [{ field: "title", value: "Opening hours and holidays" }, { field: "body", value: body }], publish: false }),
    ports: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pageForm, {
    cinatraCmsPage: 1,
    system: "drupal",
    page: PAGE,
    writeFields: { fields: [{ field: "title", value: "Opening hours and holidays" }, { field: "body", value: body }], publish: false },
    excerpts: [
      { region: "title", position: 0, kind: "heading", level: 1, published: "Opening hours", proposed: "Opening hours and holidays" },
      {
        region: "body",
        position: 1,
        kind: "paragraph",
        level: null,
        published: '<p>We open at <a href="/hours">nine</a> on weekdays.</p>',
        proposed: '<p>We open at <a href="/hours">eight</a> on weekdays.</p>',
      },
      { region: "body", position: 3, kind: "list-item", level: null, published: "<li>Saturday: closed</li></ul>", proposed: "<li>Saturday: ten to two</li></ul>" },
    ],
  });
  assert.equal(result.next, "review");
});

test("F3 added and removed blocks, a value without markup, inline markup and entities, each shown as its source", async () => {
  const { pageExcerpts } = await load();
  const read = { title: "T", body: "<p>One</p><p>Two</p>", fieldValues: [{ field: "field_note", value: "Plain note" }] };
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p><p>Two</p><p>Three &amp; four</p>" }] }), [
    { region: "body", position: 2, kind: "paragraph", level: null, published: "", proposed: "<p>Three &amp; four</p>" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p>" }] }), [
    { region: "body", position: 1, kind: "paragraph", level: null, published: "<p>Two</p>", proposed: "" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "field_note", value: "A <em>new</em> note" }] }), [
    { region: "field_note", position: 0, kind: "paragraph", level: null, published: "Plain note", proposed: "A <em>new</em> note" },
  ]);
  assert.deepEqual(pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p><p>Two</p>" }] }), [], "the same value is no change");
  const once = pageExcerpts(read, { fields: [{ field: "body", value: "<h3>New</h3><p>Two</p>" }] });
  assert.deepEqual(once, pageExcerpts(read, { fields: [{ field: "body", value: "<h3>New</h3><p>Two</p>" }] }), "the same values give the same blocks");
  assert.deepEqual(once, [{ region: "body", position: 0, kind: "heading", level: 3, published: "<p>One</p>", proposed: "<h3>New</h3>" }]);
});

test("F4 a change of markup is shown as its source, byte for byte: a link target with its text, a target alone, an attribute alone, and more", async () => {
  const { extensionTool } = await load();
  const cases = {
    "a link's text and target": READ.body.replace('href="/hours">nine', 'href="https://elsewhere.example/">ten'),
    "a link target alone": READ.body.replace('href="/hours"', 'href="https://elsewhere.example/"'),
    "an attribute alone": READ.body.replace("<p>", '<p class="x">'),
    "a list type": READ.body.replace("<ul>", "<ol>").replace("</ul>", "</ol>"),
    "an added comment": `${READ.body}<!-- hidden -->`,
    "an added image": `${READ.body}<img src="https://elsewhere.example/a.png">`,
    "a paragraph made a heading": READ.body.replace("<p>We open", "<h3>We open").replace("weekdays.</p>", "weekdays.</h3>"),
    "an added script": READ.body.replace("<h2>", "<script></script><h2>"),
    "an image next to a changed paragraph": READ.body.replace("nine</a> on weekdays.</p>", 'ten</a> on weekdays.</p><img src="https://elsewhere.example/a.png">'),
  };
  for (const [name, body] of Object.entries(cases)) {
    const { pageForm, next } = await extensionTool({ input: formCall(withBody(body)), ports: {} });
    assert.equal(next, "review", name);
    const shown = pageForm.excerpts;
    assert.ok(shown.length > 0, `${name}: the change is shown`);
    const published = shown.map((e) => e.published).join("");
    const proposed = shown.map((e) => e.proposed).join("");
    // The read, with the shown published text put back as the shown proposed
    // text, is the value to write byte for byte: every written byte that
    // differs from the read is in the shown text.
    let rebuilt = false;
    for (let at = 0; at <= READ.body.length && !rebuilt; at += 1) {
      rebuilt = READ.body.startsWith(published, at) && READ.body.slice(0, at) + proposed + READ.body.slice(at + published.length) === body;
    }
    assert.ok(rebuilt, `${name}: the read with the shown published text put back as the shown proposed text is the value to write`);
  }
  const shownFor = async (name) => (await extensionTool({ input: formCall(withBody(cases[name])), ports: {} })).pageForm.excerpts;
  const paragraph = (published, proposed) => [{ region: "body", position: 1, kind: "paragraph", level: null, published, proposed }];
  const PUBLISHED = '<p>We open at <a href="/hours">nine</a> on weekdays.</p>';
  assert.deepEqual(await shownFor("a link's text and target"), paragraph(PUBLISHED, '<p>We open at <a href="https://elsewhere.example/">ten</a> on weekdays.</p>'));
  assert.deepEqual(await shownFor("a link target alone"), paragraph(PUBLISHED, '<p>We open at <a href="https://elsewhere.example/">nine</a> on weekdays.</p>'));
  assert.deepEqual(await shownFor("an attribute alone"), paragraph(PUBLISHED, '<p class="x">We open at <a href="/hours">nine</a> on weekdays.</p>'));
});

test("F4b what the display cannot show is refused before it is filed: white space alone", async () => {
  const { extensionTool } = await load();
  const cases = {
    "white space inside a block": withBody(READ.body.replace("We open at", "We  open at")),
    "white space between blocks": withBody(READ.body.replace("</h2>", "</h2>\n")),
    "a line break in a list": withBody(READ.body.replace("</li><li>", "</li>\n<li>")),
    "white space in a field_ value": { fields: [{ field: "field_note", value: "Plain  note" }], publish: false },
    "white space in the title": { fields: [{ field: "title", value: "Opening  hours" }], publish: false },
    "a value of white space only": { fields: [{ field: "field_note", value: "   " }], publish: false, read: { ...READ, fieldValues: [{ field: "field_note", value: "" }] } },
  };
  for (const [name, { read = READ, ...writeFields }] of Object.entries(cases)) {
    await assert.rejects(extensionTool({ input: formCall(writeFields, read), ports: {} }), refusedWithCode, name);
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
  await assert.rejects(
    extensionTool({ input: formCall({ fields: [], publish: false }, READ, { code: "read-failed", message: "no" }), ports: {} }),
    refusedWithCode,
    "a failed read files nothing, and is never read as nothing to change",
  );
});

test("F7 a change that changes nothing is routed past the filing: next is no_change, and only then", async () => {
  const { extensionTool } = await load();
  const route = async (writeFields) => (await extensionTool({ input: formCall(writeFields), ports: {} })).next;
  assert.equal(await route({ fields: [], publish: false }), "no_change", "no values, no publish");
  assert.equal(await route({ fields: [{ field: "title", value: READ.title }, { field: "body", value: READ.body }], publish: false }), "no_change", "values equal to the read");
  // Any request to publish is refused: this agent never publishes.
  await assert.rejects(route({ fields: [], publish: true }), refusedWithCode, "a publish alone");
  await assert.rejects(route({ fields: [{ field: "title", value: READ.title }], publish: true }), refusedWithCode, "a publish with an equal value");
  await assert.rejects(route({ ...withBody(READ.body.replace("nine", "ten")), publish: true }), refusedWithCode, "a publish with a change");
  assert.equal(await route(withBody(READ.body.replace("nine", "ten"))), "review", "a change is reviewed");
});

// --- the read-back compares what was shown with what is written ------------

const FILED = { artifactId: "artifact-7", representationRevisionId: "revision-1" };
const answer = JSON.stringify({ approved: true, review: { envelopeVersion: 1, decision: "approved", targets: [FILED] } });
const readCall = (read = READ) => ({
  op: "read",
  artifactId: FILED.artifactId,
  reviewAnswer: JSON.stringify(answer),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
  address: JSON.stringify(read.address),
  error: JSON.stringify({ code: "", message: "" }),
  nodeId: JSON.stringify(read.nodeId),
  nodeStatus: JSON.stringify(read.nodeStatus),
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
  assert.deepEqual(result.reviewedFields, { body });

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

// --- only a field that changes is written -----------------------------------

const readBack = async (pageForm) => (await load()).extensionTool({ input: readCall(), ports: portsWith(pageForm) });

test("F8 a change of the title alone files and writes the title alone, though the compose step repeats the other values", async () => {
  const { extensionTool } = await load();
  const composed = {
    fields: [{ field: "title", value: "Opening hours and holidays" }, { field: "body", value: READ.body }, { field: "field_note", value: "Plain note" }],
    publish: false,
  };
  const { pageForm } = await extensionTool({ input: formCall(composed), ports: {} });
  assert.deepEqual(pageForm.writeFields, { fields: [{ field: "title", value: "Opening hours and holidays" }], publish: false }, "an unchanged value is not filed");
  assert.deepEqual(pageForm.excerpts.map((e) => e.region), ["title"]);
  const result = await readBack(pageForm);
  assert.deepEqual(result.reviewedFields, { title: "Opening hours and holidays" }, "the write step is handed the title alone");
});

test("F9 a change of the body alone files and writes the body alone", async () => {
  const { extensionTool } = await load();
  const body = READ.body.replace("nine", "ten");
  const { pageForm } = await extensionTool({ input: formCall({ fields: [{ field: "title", value: READ.title }, { field: "body", value: body }], publish: false }), ports: {} });
  assert.deepEqual(pageForm.writeFields, { fields: [{ field: "body", value: body }], publish: false });
  assert.deepEqual(pageForm.excerpts.map((e) => e.region), ["body"]);
  assert.deepEqual((await readBack(pageForm)).reviewedFields, { body });
});

test("F10 the read-back refuses a revision that would write a field its shown blocks do not show, also when that value equals the read", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall({ fields: [{ field: "title", value: "Opening hours and holidays" }], publish: false }), ports: {} });
  for (const [field, value] of [["body", READ.body], ["field_note", "Plain note"]]) {
    const extra = { ...pageForm, writeFields: { ...pageForm.writeFields, fields: [...pageForm.writeFields.fields, { field, value }] } };
    await assert.rejects(
      readBack(extra),
      (err) => refusedWithCode(err) && err.message.includes(`would write the field ${field}`),
      `an unchanged ${field}`,
    );
  }
  for (const write of ["write_draft", "write_unpublished"]) {
    assert.equal(
      parts[write].data.input.fieldsJson.replace(/\{#[\s\S]*?#\}/g, ""),
      "{{ reviewedFields | tojson }}",
      `${write} sends exactly the fields the read-back answers, and no other`,
    );
  }
});

// --- the work of the comparison is bounded -----------------------------------

const manyBlocks = (count, change = () => null) => Array.from({ length: count }, (_, i) => change(i) ?? `<p>Block ${i}.</p>\n`).join("");
const bodyRead = (body) => ({ ...READ, body });

test("F11 a page of 5,000 blocks with one changed block compares only the changed block", async () => {
  const { alignedBlocks, blocksOf, extensionTool } = await load();
  const before = manyBlocks(5000);
  const after = manyBlocks(5000, (i) => (i === 2500 ? "<p>Block 2500, changed.</p>\n" : null));
  const meter = { cells: 0 };
  const steps = alignedBlocks("body", blocksOf(before), blocksOf(after), meter);
  assert.ok(meter.cells > 0 && meter.cells <= 16, `the table holds the changed blocks only, not ${meter.cells} cells`);
  assert.equal(steps.length, 5000);
  assert.equal(steps.filter((s) => !s.same).length, 1, "one changed block");
  const { pageForm } = await extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} });
  assert.deepEqual(pageForm.excerpts, [
    { region: "body", position: 2500, kind: "paragraph", level: null, published: "<p>Block 2500.</p>\n", proposed: "<p>Block 2500, changed.</p>\n" },
  ]);
});

test("F12 a change whose compared part is too large is refused at the form and at the read-back; so are too many blocks and too long a text", async () => {
  const { extensionTool } = await load();
  const before = manyBlocks(5000);
  const after = manyBlocks(5000, (i) => (i === 0 || i === 4999 ? `<p>Block ${i}, changed.</p>\n` : null));
  const tooLarge = (err) => refusedWithCode(err) && err.message.includes("more blocks than the page snapshot form can compare");
  await assert.rejects(extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} }), tooLarge, "at the form");
  // A snapshot the display draws, of this node: only the comparison refuses it.
  const shown = [{ region: "body", position: 0, kind: "paragraph", level: null, published: "a", proposed: "b" }];
  const snapshot = { cinatraCmsPage: 1, system: "drupal", page: PAGE, writeFields: withBody(after), excerpts: shown };
  await assert.rejects(extensionTool({ input: readCall(bodyRead(before)), ports: portsWith(snapshot) }), tooLarge, "at the read-back");

  const blocks = manyBlocks(20001);
  await assert.rejects(
    extensionTool({ input: formCall(withBody(`${blocks}<p>x</p>`), bodyRead(blocks)), ports: {} }),
    (err) => refusedWithCode(err) && err.message.includes("blocks in all"),
    "too many blocks",
  );
  await assert.rejects(
    extensionTool({ input: formCall(withBody("a".repeat(4_000_001))), ports: {} }),
    (err) => refusedWithCode(err) && err.message.includes("characters in all"),
    "too long a text",
  );
  await assert.rejects(
    extensionTool({ input: readCall(bodyRead("b".repeat(4_000_001))), ports: portsWith({ ...snapshot, writeFields: withBody("<p>x</p>") }) }),
    (err) => refusedWithCode(err) && err.message.includes("characters in all"),
    "too long a read, at the read-back",
  );
});

test("F13 the splitting stops at the block limit: a value of a million blocks creates no more than the limit plus one blocks", async () => {
  const { pageExcerpts } = await load();
  const limit = 40_000;
  const read = { title: "Opening hours", body: "", fieldValues: [] };
  const values = {
    "a million empty paragraphs": "<p/>".repeat(999_999),
    "a list of 400,000 items": `<ul>${"<li>x</li>".repeat(399_000)}</ul>`,
  };
  for (const [name, value] of Object.entries(values)) {
    const meter = { blocks: 0 };
    assert.throws(
      () => pageExcerpts(read, { fields: [{ field: "body", value }] }, meter),
      (err) => refusedWithCode(err) && err.message.includes("blocks in all"),
      name,
    );
    assert.equal(meter.blocks, limit + 1, `${name}: the splitting stopped at the limit, not after ${meter.blocks} blocks`);
  }
  const meter = { blocks: 0 };
  pageExcerpts(read, { fields: [{ field: "body", value: "<p>One</p><p>Two</p>" }] }, meter);
  assert.equal(meter.blocks, 2, "a value under the limit is split whole");
});

// --- invisible characters and white space ----------------------------------
//
// One rule per changed block, the unit the review shows, with no exception
// and no normalisation. A changed block that holds an invisible character
// (format, control other than tab/LF/CR, separator, space other than U+0020,
// default ignorable, variation selector) in its read or new text is refused.
// Old and new are compared byte for byte: in the changed part (between the
// unchanged start and end, widened so no run of white space is cut), white
// space may only be a single U+0020 between two visible characters.
//
// Removed with the last rule: the whitespace-sensitive block list, the
// collapsing of white space in the body and the title, and the cases that
// pinned them ("a paragraph added after a line break" and "an edit away from
// a kept no-break space" were filed; both are refused now, because a line
// break in a changed part and a no-break space in a changed block are not
// drawn as they are).

const INVISIBLE_RE = /U\+[0-9A-F]{4,6}/;
const refusedInvisible = (codePoint, region = "body") => (err) =>
  refusedWithCode(err) && err.message.includes(`of the ${region} holds the invisible character ${codePoint}`);
const refusedSpace = (region = "body") => (err) =>
  refusedWithCode(err) && err.message.includes(`of the ${region} changes white space other than one plain space`) && !INVISIBLE_RE.test(err.message);

test("F14 a change that adds an invisible or direction-changing character is refused, naming its code point", async () => {
  const { extensionTool } = await load();
  await assert.rejects(
    extensionTool({ input: formCall(withBody("\u200B"), bodyRead("")), ports: {} }),
    refusedInvisible("U+200B"),
    "an empty body to a zero-width space",
  );
  await assert.rejects(
    extensionTool({ input: formCall(withBody(READ.body.replace("weekdays", "week\u202Edays"))), ports: {} }),
    refusedInvisible("U+202E"),
    "a direction override inside a visible word",
  );
  const added = {
    "U+200D": "\u200D", "U+2060": "\u2060", "U+FEFF": "\uFEFF", "U+2066": "\u2066", "U+200E": "\u200E", "U+061C": "\u061C",
    "U+0007": "\u0007", "U+0085": "\u0085", "U+2009": "\u2009", "U+202F": "\u202F", "U+3000": "\u3000",
    "U+2028": "\u2028", "U+2029": "\u2029", "U+00AD": "\u00AD", "U+3164": "\u3164", "U+E0041": "\u{E0041}",
    "U+FE0F": "\uFE0F", "U+FE00": "\uFE00", "U+E0100": "\u{E0100}", "U+E01EF": "\u{E01EF}", "U+E0001": "\u{E0001}", "U+00A0": "\u00A0",
  };
  for (const [codePoint, ch] of Object.entries(added)) {
    await assert.rejects(
      extensionTool({ input: formCall(withBody(READ.body.replace("nine", `ten${ch}`))), ports: {} }),
      refusedInvisible(codePoint),
      codePoint,
    );
  }
  await assert.rejects(
    extensionTool({ input: formCall({ fields: [{ field: "title", value: "Opening\u200B hours" }], publish: false }), ports: {} }),
    refusedInvisible("U+200B", "title"),
    "in the title",
  );
  await assert.rejects(
    extensionTool({ input: formCall(withBody(READ.body.replace("nine", "ni\u200Bne"))), ports: {} }),
    refusedInvisible("U+200B"),
    "inside an unchanged word, where the visible text is the same",
  );
  await assert.rejects(
    extensionTool({ input: formCall(withBody(READ.body.replace('href="/hours"', 'href="/hou\uFE0Frs"'))), ports: {} }),
    refusedInvisible("U+FE0F"),
    "a variation selector inside a link target",
  );
});

test("F15 a block that holds an invisible character or a no-break space is kept as it is: unchanged it passes, any change to it is refused", async () => {
  const { extensionTool } = await load();
  const before = "<p>See the in\u00ADformation desk.</p><p>Ask at the desk\u200B.</p><p>Families \u{1F468}\u200D\u{1F469}</p><p>Open at 10\u00A0am.</p><p>Smile \u263A\uFE0F</p><p>We open at nine.</p>";
  const after = before.replace("nine", "ten");
  const { pageForm } = await extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} });
  assert.equal(pageForm.writeFields.fields[0].value, after, "an edit of another block is filed");
  const back = await extensionTool({ input: readCall(bodyRead(before)), ports: portsWith(pageForm) });
  assert.deepEqual(back.reviewedFields, { body: after }, "and read back");
  const refused = {
    "words changed on both sides of a zero-width space": [before.replace("Ask at the desk\u200B.", "Please ask at the front desk\u200B. Thank you."), "U+200B"],
    "removing a zero-width space": [before.replace("desk\u200B.", "desk."), "U+200B"],
    "moving a zero-width space": [before.replace("desk\u200B.", "de\u200Bsk."), "U+200B"],
    "a word changed beside a soft hyphen": [before.replace("desk.</p>", "counter.</p>"), "U+00AD"],
    "a word changed beside a joined emoji": [before.replace("Families", "All families"), "U+200D"],
    "a word changed beside a no-break space": [before.replace("Open at", "We open at"), "U+00A0"],
    "a word changed beside a variation selector": [before.replace("Smile", "Smile please"), "U+FE0F"],
  };
  for (const [name, [value, codePoint]] of Object.entries(refused)) {
    await assert.rejects(extensionTool({ input: formCall(withBody(value), bodyRead(before)), ports: {} }), refusedInvisible(codePoint), name);
  }
});

test("F16 an invisible character moved between two equal pairs while the words around it change is refused", async () => {
  const { extensionTool } = await load();
  const cases = [
    ["<p>Xa\u200Bb ab Y</p>", "<p>Za b a\u200Bb W</p>"],
    ["<p>One a\u200Bb two a b three</p>", "<p>Uno a b two a\u200Bb tres</p>"],
  ];
  for (const [before, after] of cases) {
    await assert.rejects(extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} }), refusedInvisible("U+200B"), after);
  }
});

test("F17 white space is compared byte for byte: only a single space between visible characters may change", async () => {
  const { extensionTool } = await load();
  const pre = "<p>Intro.</p><pre>x = 1\ny = 2</pre>";
  const refused = {
    "a line break removed inside pre beside a changed token": [pre, pre.replace("1\ny", "9 y")],
    "two spaces in an attribute made one beside a changed word": ['<p data-code="A  B">Old</p>', '<p data-code="A B">New</p>'],
    "a tab inside an attribute beside a changed word": ['<p class="a b">Old</p>', '<p class="a\tb">New</p>'],
    "a line break added inside a paragraph": ["<p>We open at nine.</p>", "<p>We open\nat ten.</p>"],
    "a block added with a line break after it": ["<p>One.</p>\n<p>Two.</p>\n", "<p>One.</p>\n<p>New.</p>\n<p>Two.</p>\n"],
    "two spaces added with a word": [READ.body, READ.body.replace("on weekdays", "on  all weekdays")],
    "a space added at the end of a block": ["<p>One.</p><p>Two.</p>", "<p>One!</p> <p>Two.</p>"],
  };
  for (const [name, [before, after]] of Object.entries(refused)) {
    await assert.rejects(extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} }), refusedSpace(), name);
  }
  const filed = {
    "a one-word edit": [READ.body, READ.body.replace("nine", "ten")],
    "a word added in a paragraph": [READ.body, READ.body.replace("on weekdays", "on all weekdays")],
    "a token changed inside pre, white space kept": [pre, pre.replace("y = 2", "y = 3")],
    "a word changed beside a kept line break": ["<p>We open\nat nine.</p>", "<p>We open\nat ten.</p>"],
    "an attribute changed, shown as source": ['<p class="a">Old</p>', '<p class="b">Old</p>'],
    "a block added without a line break": ["<p>One.</p>\n<p>Two.</p>\n", "<p>One.</p>\n<p>New.</p><p>Two.</p>\n"],
  };
  for (const [name, [before, after]] of Object.entries(filed)) {
    const { pageForm } = await extensionTool({ input: formCall(withBody(after), bodyRead(before)), ports: {} });
    assert.equal(pageForm.writeFields.fields[0].value, after, name);
    const back = await extensionTool({ input: readCall(bodyRead(before)), ports: portsWith(pageForm) });
    assert.deepEqual(back.reviewedFields, { body: after }, `${name}, at the read-back`);
  }
  const shown = (await extensionTool({ input: formCall(withBody('<p class="b">Old</p>'), bodyRead('<p class="a">Old</p>')), ports: {} })).pageForm.excerpts;
  assert.deepEqual([shown[0].published, shown[0].proposed], ['<p class="a">Old</p>', '<p class="b">Old</p>'], "the excerpt shows the block's source, markup included");
  await assert.rejects(
    extensionTool({ input: formCall({ fields: [{ field: "field_note", value: "Plain\nmemo" }], publish: false }), ports: {} }),
    refusedSpace("field_note"),
    "a line break in a field_ value",
  );
  await assert.rejects(
    extensionTool({ input: formCall({ fields: [{ field: "title", value: "Opening\thours and more" }], publish: false }), ports: {} }),
    refusedSpace("title"),
    "a tab in the title",
  );
  await assert.rejects(
    extensionTool({ input: formCall(withBody(READ.body.replace("We open at", "We  open at"))), ports: {} }),
    (err) => refusedWithCode(err) && err.message.includes("only in white space"),
    "a change of white space alone is refused as before",
  );
});

test("F18 the read-back applies the same rule to the approved revision", async () => {
  const { extensionTool } = await load();
  const after = READ.body.replace("nine", "ten\u200B");
  const shown = [{ region: "body", position: 1, kind: "paragraph", level: null, published: '<p>We open at <a href="/hours">nine</a> on weekdays.</p>', proposed: '<p>We open at <a href="/hours">ten\u200B</a> on weekdays.</p>' }];
  const snapshot = { cinatraCmsPage: 1, system: "drupal", page: PAGE, writeFields: withBody(after), excerpts: shown };
  await assert.rejects(extensionTool({ input: readCall(), ports: portsWith(snapshot) }), refusedInvisible("U+200B"));
  const old = '<p data-code="A  B">Old</p>';
  const changed = '<p data-code="A B">New</p>';
  const attrSnapshot = {
    cinatraCmsPage: 1, system: "drupal", page: PAGE, writeFields: withBody(changed),
    excerpts: [{ region: "body", position: 0, kind: "paragraph", level: null, published: old, proposed: changed }],
  };
  await assert.rejects(extensionTool({ input: readCall(bodyRead(old)), ports: portsWith(attrSnapshot) }), refusedSpace());
});
