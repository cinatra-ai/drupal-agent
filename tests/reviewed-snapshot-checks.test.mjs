// cinatra-ai/cinatra#3745 — what is filed is a snapshot the display draws, the
// approved revision is the snapshot of this run's node, and only a successful
// read leads anywhere.
//
// 1. A request to publish with no change of text stages no content, and the
//    page display draws only changed text blocks: its parser refuses a
//    snapshot with no excerpts, and it draws no node status. The application
//    opens its publish card only after a review approved earlier in the same
//    run, so such a request cannot reach the card past the review either. The
//    form step refuses it with a reason, and nothing is filed or written.
// 2. One check, used by the form step on what it files and by the read-back
//    on the approved revision: the display's parser accepts the snapshot,
//    each excerpt has the exact form the form step builds, and the page record
//    names this run's node (node id, status, title, address and edit address
//    as the form step builds them from this run's read).
// 3. A successful read is defined positively: an error object whose code and
//    message are both empty, a status of published or draft, a change time,
//    a title, and a list of field values, for a node id of the run. Every
//    other read, of any shape, and every flow default standing in for one,
//    is refused: it never ends the run as a change of nothing.
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
const refusedWithCode = (err) =>
  err instanceof Error && err.name === "ExtensionToolCallRefusal" && err.message.startsWith(`${CODE}: `) && !err.message.includes("\n");
const refusedSaying = (text) => (err) => refusedWithCode(err) && err.message.includes(text);

async function load() {
  return import("../cinatra/tools/reviewed-change.mjs");
}

const READ = {
  nodeId: "7",
  title: "Opening hours",
  body: "<h2>When we open</h2><p>We open at nine on weekdays.</p>",
  fieldValues: [{ field: "field_note", value: "Plain note" }],
  address: "https://www.example.org/node/7",
  error: { code: "", message: "" },
  nodeStatus: "draft",
};

/** The read inputs as the flow renders them: each value as JSON text. */
const readInputs = (read = READ) => ({
  nodeId: JSON.stringify(read.nodeId),
  title: JSON.stringify(read.title),
  body: JSON.stringify(read.body),
  fieldValues: JSON.stringify(read.fieldValues),
  address: JSON.stringify(read.address),
  error: JSON.stringify(read.error),
  nodeStatus: JSON.stringify(read.nodeStatus),
});
const formCall = (writeFields, read = READ) => ({ op: "form", writeFields: JSON.stringify(writeFields), ...readInputs(read) });
const unchangedCall = (writeFields, read = READ) => ({ op: "unchanged", writeFields: JSON.stringify(writeFields), ...readInputs(read) });

const FILED = { artifactId: "artifact-7", representationRevisionId: "revision-1" };
const ANSWER = JSON.stringify({ approved: true, review: { envelopeVersion: 1, decision: "approved", targets: [FILED] } });
const readCall = (read = READ) => ({ op: "read", artifactId: FILED.artifactId, reviewAnswer: JSON.stringify(ANSWER), ...readInputs(read) });
const portsWith = (form) => ({
  artifacts: {
    async contentRead(request) {
      return { ...request, text: typeof form === "string" ? form : JSON.stringify(form), truncated: false };
    },
  },
});

const BODY_CHANGE = { fields: [{ field: "body", value: READ.body.replace("nine", "ten") }], publish: false };
const NOTHING = { fields: [], publish: false };

const sourcesOf = (node, input) =>
  oas.data_flow_connections
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => [e.source_node.$component_ref, e.source_output]);

// --- 1. a publish with no change of text ------------------------------------

test("P1 any request to publish is refused at the form step with its reason, and nothing is filed", async () => {
  const { extensionTool } = await load();
  const cases = {
    "a publish alone": { fields: [], publish: true },
    "a publish with a value equal to the read": { fields: [{ field: "title", value: READ.title }, { field: "body", value: READ.body }], publish: true },
    "a publish with a change of text": { ...BODY_CHANGE, publish: true },
  };
  for (const [name, writeFields] of Object.entries(cases)) {
    await assert.rejects(
      extensionTool({ input: formCall(writeFields), ports: {} }),
      refusedSaying("this agent never publishes"),
      name,
    );
    await assert.rejects(extensionTool({ input: unchangedCall(writeFields), ports: {} }), refusedWithCode, `${name}: the no-change step refuses it too`);
  }
});

test("P2 the refusal ends the run before the filing: the filing step is reached only through the form step's answer", () => {
  const into = (id) => oas.control_flow_connections.filter((e) => e.to_node.$component_ref === id).map((e) => [e.from_node.$component_ref, e.from_branch ?? null]);
  assert.deepEqual(into("file_page"), [["route_change", "default"]]);
  assert.deepEqual(into("route_change"), [["form_page", null]]);
  assert.equal("completed_error_codes" in parts.form_page.data, false, "a refusal of the form step fails the step, and so the run");
  assert.deepEqual(sourcesOf("file_page", "pageForm"), [["form_page", "pageForm"]]);
});

test("P3 the read-back refuses a revision that would publish, whatever it shows", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall(BODY_CHANGE), ports: {} });
  const cases = {
    "a publish alone, no blocks": { ...pageForm, writeFields: { fields: [], publish: true }, excerpts: [] },
    "a publish alone, the blocks of another change": { ...pageForm, writeFields: { fields: [], publish: true } },
    "a publish with the shown change": { ...pageForm, writeFields: { ...BODY_CHANGE, publish: true } },
  };
  for (const [name, form] of Object.entries(cases)) {
    await assert.rejects(extensionTool({ input: readCall(), ports: portsWith(form) }), refusedWithCode, name);
  }
});

// --- 2. the approved revision is the snapshot of this run's node ------------

test("S1 the filed page record names this run's node: node id, status, title, address and edit address", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall(BODY_CHANGE), ports: {} });
  assert.deepEqual(pageForm.page, {
    nodeId: "7",
    status: "draft",
    title: "Opening hours",
    address: READ.address,
    cmsAddress: `${READ.address}/edit`,
  });
  const result = await extensionTool({ input: readCall(), ports: portsWith(pageForm) });
  assert.deepEqual(result.reviewedFields, { body: BODY_CHANGE.fields[0].value });
});

test("S2 a revision whose page record is missing or names another node, status, title or address is refused, saying which part differs", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall(BODY_CHANGE), ports: {} });
  const page = pageForm.page;
  const cases = {
    "no page record": [{ ...pageForm, page: undefined }, "page"],
    "a page record that is not an object": [{ ...pageForm, page: "Opening hours" }, "page"],
    "another node": [{ ...pageForm, page: { ...page, nodeId: "8" } }, "node id"],
    "no node id": [{ ...pageForm, page: { ...page, nodeId: undefined } }, "node id"],
    "another title": [{ ...pageForm, page: { ...page, title: "Prices" } }, "title"],
    "another status": [{ ...pageForm, page: { ...page, status: "published" } }, "status"],
    "another address": [{ ...pageForm, page: { ...page, address: "https://www.example.org/node/8" } }, "address"],
    "another edit address": [{ ...pageForm, page: { ...page, cmsAddress: "https://www.example.org/node/8/edit" } }, "edit address"],
    "an extra key": [{ ...pageForm, page: { ...page, nid: "8" } }, "page"],
  };
  for (const [name, [form, part]] of Object.entries(cases)) {
    await assert.rejects(
      extensionTool({ input: readCall(), ports: portsWith(form) }),
      (err) => refusedWithCode(err) && err.message.includes(part),
      name,
    );
  }
  // The same revision read against another node's read is refused: the snapshot names node 7.
  await assert.rejects(extensionTool({ input: readCall({ ...READ, nodeId: "8" }), ports: portsWith(pageForm) }), refusedSaying("node id"), "another run's node");
  await assert.rejects(extensionTool({ input: readCall({ ...READ, nodeStatus: "published" }), ports: portsWith(pageForm) }), refusedSaying("status"), "another status read");
});

test("S3 an excerpt that has not the form the display draws, or not the form the form step builds, is refused", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall({ fields: [{ field: "title", value: "Hours" }, BODY_CHANGE.fields[0]], publish: false }), ports: {} });
  const [title, block] = pageForm.excerpts;
  const cases = {
    "a kind the display does not draw": [title, { ...block, kind: "quote" }],
    "a heading without its level": [{ ...title, level: undefined }, block],
    "a heading level out of range": [{ ...title, level: 7 }, block],
    "a level on a paragraph": [title, { ...block, level: 2 }],
    "a negative position": [title, { ...block, position: -1 }],
    "a position that is not a whole number": [title, { ...block, position: 1.5 }],
    "positions that do not rise in a region": [title, block, { ...block }],
    "two sides with the same words": [title, { ...block, proposed: block.published.replace(" at ", "  at ") }],
    "a side that is not text": [title, { ...block, proposed: 3 }],
    "no region": [title, { ...block, region: "" }],
    "an extra key": [title, { ...block, note: "x" }],
    "an entry that is not an object": [title, "x"],
    "excerpts that are not a list": "x",
  };
  for (const [name, excerpts] of Object.entries(cases)) {
    await assert.rejects(extensionTool({ input: readCall(), ports: portsWith({ ...pageForm, excerpts }) }), refusedWithCode, name);
  }
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ ...block, position: i }));
  await assert.rejects(extensionTool({ input: readCall(), ports: portsWith({ ...pageForm, excerpts: tooMany }) }), refusedWithCode, "more than 200 excerpts");
});

test("S4 the one check is the one the form step applies to what it files", async () => {
  const { checkedSnapshot, extensionTool } = await load();
  assert.equal(typeof checkedSnapshot, "function");
  const { pageForm } = await extensionTool({ input: formCall(BODY_CHANGE), ports: {} });
  assert.doesNotThrow(() => checkedSnapshot(pageForm, pageForm.page));
  assert.throws(() => checkedSnapshot({ ...pageForm, excerpts: [] }, pageForm.page), refusedSaying("no-excerpts"));
  assert.throws(() => checkedSnapshot({ ...pageForm, page: { ...pageForm.page, nodeId: "8" } }, pageForm.page), refusedSaying("node id"));
  const source = readFileSync(path.join(root, "cinatra/tools/reviewed-change.mjs"), "utf8");
  const calls = source.match(/checkedSnapshot\(/g) ?? [];
  assert.equal(calls.length, 3, "declared once, called by the form step and by the read-back");
});

// --- 3. only a successful read leads anywhere --------------------------------

test("R1 a failed read of any shape is refused at the form step and at the no-change step, never routed as no change", async () => {
  const { extensionTool } = await load();
  const reads = {
    "an empty error object": { ...READ, error: {} },
    "an error with a message and no code": { ...READ, error: { message: "failure" } },
    "an error with a code and no message": { ...READ, error: { code: "" } },
    "an error that is null": { ...READ, error: null },
    "an error that is text": { ...READ, error: "failure" },
    "a failure code": { ...READ, error: { code: "read-failed", message: "The site did not answer." } },
    "a message beside an empty code": { ...READ, error: { code: "", message: "The site did not answer." } },
    "an unknown status": { ...READ, nodeStatus: "unknown" },
    "no status": { ...READ, nodeStatus: "" },
    "no title": { ...READ, title: "" },
    "no node id": { ...READ, nodeId: "" },
  };
  for (const [name, read] of Object.entries(reads)) {
    await assert.rejects(extensionTool({ input: formCall(NOTHING, read), ports: {} }), refusedWithCode, `form: ${name}`);
    await assert.rejects(extensionTool({ input: unchangedCall(NOTHING, read), ports: {} }), refusedWithCode, `unchanged: ${name}`);
    await assert.rejects(extensionTool({ input: formCall(BODY_CHANGE, read), ports: {} }), refusedWithCode, `form with a change: ${name}`);
  }
  await assert.rejects(
    extensionTool({ input: formCall(NOTHING, { ...READ, error: { message: "The site did not answer." } }), ports: {} }),
    refusedSaying("The site did not answer."),
    "the read's own error is the reason",
  );
  await assert.rejects(extensionTool({ input: formCall(NOTHING, { ...READ, error: {} }), ports: {} }), refusedSaying("no successful read"), "a fixed reason otherwise");
});

test("R2 a read input missing from the call, or standing at the flow's default, is refused at every step of the tool", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall(BODY_CHANGE), ports: {} });
  const steps = { form_page: formCall(NOTHING), no_change_outcome: unchangedCall(NOTHING), read_reviewed_page: readCall() };
  // `address` is not one: the read step answers the empty address for a site
  // without an https address. The empty list of field values is a real answer
  // too (a node with no `field_` text value), so `fieldValues` is refused only
  // when missing; at its default the other inputs still decide.
  const READ_INPUTS = ["nodeId", "title", "fieldValues", "error", "nodeStatus"];
  const REAL_AT_DEFAULT = new Set(["fieldValues"]);
  for (const [step, input] of Object.entries(steps)) {
    const declared = Object.fromEntries(parts[step].inputs.map((i) => [i.title, i]));
    for (const name of READ_INPUTS) {
      assert.ok(name in declared, `${step} declares ${name}`);
      assert.ok(sourcesOf(step, name).length === 1, `${step}.${name} has one source`);
      const atDefault = { ...input, [name]: JSON.stringify(declared[name].default) };
      if (!REAL_AT_DEFAULT.has(name)) await assert.rejects(extensionTool({ input: atDefault, ports: portsWith(pageForm) }), refusedWithCode, `${step}: ${name} at its default`);
      const missing = { ...input };
      delete missing[name];
      await assert.rejects(extensionTool({ input: missing, ports: portsWith(pageForm) }), refusedWithCode, `${step}: no ${name}`);
    }
    const allDefaults = { ...input };
    for (const name of READ_INPUTS) allDefaults[name] = JSON.stringify(declared[name].default);
    await assert.rejects(extensionTool({ input: allDefaults, ports: portsWith(pageForm) }), refusedWithCode, `${step}: every read input at its default`);
    for (const value of ["{}", "null", "\"\""]) {
      await assert.rejects(extensionTool({ input: { ...input, error: value }, ports: portsWith(pageForm) }), refusedWithCode, `${step}: error ${value}`);
    }
  }
});

test("R3 the steps take the read's status and error from the check of the read, and the node id from the start", () => {
  for (const step of ["form_page", "no_change_outcome", "read_reviewed_page"]) {
    for (const name of ["title", "body", "fieldValues", "error"]) {
      assert.deepEqual(sourcesOf(step, name), [["check_read", name]], `${step}.${name}`);
    }
    assert.deepEqual(sourcesOf(step, "nodeStatus"), [["check_read", "status"]], `${step}.nodeStatus`);
    assert.deepEqual(sourcesOf(step, "nodeId"), [["start", "nodeId"]], `${step}.nodeId`);
    assert.equal(parts[step].inputs.some((i) => i.title === "nodeChanged"), false, `${step} takes no change time: the binding carries it to the write`);
  }
  for (const step of ["form_page", "read_reviewed_page"]) assert.deepEqual(sourcesOf(step, "address"), [["check_read", "address"]], `${step}.address`);
});

test("R4 a successful read that asks for no change still ends the run as a change of nothing", async () => {
  const { extensionTool } = await load();
  assert.equal((await extensionTool({ input: formCall(NOTHING), ports: {} })).next, "no_change");
  const equal = { fields: [{ field: "body", value: READ.body }], publish: false };
  assert.equal((await extensionTool({ input: formCall(equal), ports: {} })).next, "no_change");
  const told = (outcome) => {
    assert.equal(outcome.ok, true);
    assert.equal(outcome.nodeId, "7");
    assert.deepEqual(outcome.changes, []);
    assert.match(outcome.reason, /^No change was proposed for this request on node 7 .*nothing was reviewed or written/);
  };
  for (const writeFields of [NOTHING, equal]) told(await extensionTool({ input: unchangedCall(writeFields), ports: {} }));
  const published = { ...READ, nodeStatus: "published", address: "" };
  told(await extensionTool({ input: unchangedCall(NOTHING, published), ports: {} }));
});
