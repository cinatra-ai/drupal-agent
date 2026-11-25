// cinatra-ai/cinatra#3745 — the size checks measure the exact text the write sends.
//
// Each write step sends `fieldsJson` = `{{ reviewedFields | tojson }}` and
// `expectedBindingJson` = `{{ binding | tojson }}`. The connector refuses
// either text when it is longer than 256 KiB in UTF-8
// (drupal-mcp-connector, src/integration/edit-binding.ts,
// JSON_ARGUMENT_MAX_BYTES). The flow runtime renders `tojson` as Python's
// json.dumps with its defaults (separators ", " and ": ", ASCII output, keys
// in the order the value holds them: wayflowcore 26.1.2 sets
// `sort_keys: False` for an ApiNode's data) and then writes < > & ' as \u
// escapes (Jinja 3.1 `htmlsafe_json_dumps`). The tool renders that text with
// one function, `tojsonText`, and counts its UTF-8 bytes; a change or a
// binding whose text would be longer is refused before the review.
//
// RUNTIME_TEXTS below are the texts wayflowcore 26.1.2 with Jinja 3.1.6
// rendered for these values (render_nested_object_template over the template
// `{# pyagentspec-input-hint (do not remove): {{ v }} #}{{ v | tojson }}`).
//
// Zero-dependency; runs on plain node:test via tests/run.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

const load = () => import("../cinatra/tools/reviewed-change.mjs");
const LIMIT = 256 * 1024;
const utf8 = (text) => new TextEncoder().encode(text).length;

const RUNTIME_TEXTS = [
  [
    { zeta: "a<b>&'c \"q\" é \u{1F600} \\ \n\t\r\b\f \u007f\u0000\u001f/", alpha: "x", n: { b: 1, a: [true, false, null, 7, -3, 0] } },
    '{"zeta": "a\\u003cb\\u003e\\u0026\\u0027c \\"q\\" \\u00e9 \\ud83d\\ude00 \\\\ \\n\\t\\r\\b\\f\\u2028\\u007f\\u0000\\u001f/", "alpha": "x", "n": {"b": 1, "a": [true, false, null, 7, -3, 0]}}',
  ],
  [
    { title: "Öffnungszeiten — 営業時間", body: "<p>Tom &amp; Jerry's</p>" },
    '{"title": "\\u00d6ffnungszeiten \\u2014 \\u55b6\\u696d\\u6642\\u9593", "body": "\\u003cp\\u003eTom \\u0026amp; Jerry\\u0027s\\u003c/p\\u003e"}',
  ],
  [{ f: [1.5, 0.0001, 0.00001, 123456789012345.6, -2.5e-7] }, '{"f": [1.5, 0.0001, 1e-05, 123456789012345.6, -2.5e-07]}'],
  [{}, "{}"],
  [{ e: [], o: {} }, '{"e": [], "o": {}}'],
];

test("Z1 tojsonText renders each value exactly as the flow runtime's tojson does", async () => {
  const { tojsonText } = await load();
  assert.equal(typeof tojsonText, "function", "the tool exports the one rendering function");
  for (const [value, text] of RUNTIME_TEXTS) assert.equal(tojsonText(value), text);
});

test("Z2 sentBytes counts the UTF-8 bytes of that text: separators, escapes and non-ASCII as rendered", async () => {
  const { sentBytes } = await load();
  for (const [value, text] of RUNTIME_TEXTS) assert.equal(sentBytes(value), utf8(text));
  assert.equal(sentBytes({ a: "b", c: "d" }), utf8('{"a": "b", "c": "d"}'), "each separator carries its space");
  assert.equal(sentBytes({ t: "é" }), utf8('{"t": "\\u00e9"}'), "a two-byte character is sent as a six-byte escape");
  assert.equal(sentBytes({ t: "\u{1F600}" }), utf8('{"t": "\\ud83d\\ude00"}'), "a character outside the BMP is sent as two escapes");
});

// --- fieldsJson, at the form step (before the review) and at the read-back -----

const READ = {
  title: "Opening hours",
  body: "<p>We open at nine.</p>",
  fieldValues: [],
  address: "",
  nodeId: "7",
  nodeStatus: "draft",
};
const formCall = (writeFields) => ({
  op: "form",
  writeFields: JSON.stringify(writeFields),
  title: JSON.stringify(READ.title),
  body: JSON.stringify(READ.body),
  fieldValues: JSON.stringify(READ.fieldValues),
  address: JSON.stringify(READ.address),
  error: JSON.stringify({ code: "", message: "" }),
  nodeId: JSON.stringify(READ.nodeId),
  nodeStatus: JSON.stringify(READ.nodeStatus),
});
const bodyChange = (body) => ({ fields: [{ field: "body", value: body }], publish: false });
const sizeRefusal = (err) =>
  err instanceof Error &&
  err.name === "ExtensionToolCallRefusal" &&
  err.message.startsWith("reviewed_change_unavailable: ") &&
  err.message.includes(`more than the ${LIMIT} bytes the Drupal connector takes`);

// The text sent for a body change alone is {"body": "<body>"}: 10 bytes before
// the body and 2 after it. `<p>` is sent as 13 bytes and `</p>` as 14.
const plainBody = (rendered) => `<p>${"x".repeat(rendered - 10 - 2 - 13 - 14)}</p>`;
// Each é is sent as 6 bytes, & as 6 and the emoji as 12.
const mixedBody = (rendered) => `<p>${"é".repeat(1000)}&\u{1F600}${"x".repeat(rendered - 10 - 2 - 13 - 14 - 6000 - 6 - 12)}</p>`;

test("Z3 a body change whose sent text is exactly 256 KiB is filed; one byte more is refused at the form step, before the review", async () => {
  const { extensionTool } = await load();
  for (const [name, body] of [["plain", plainBody], ["non-ASCII and escaped characters", mixedBody]]) {
    const atLimit = await extensionTool({ input: formCall(bodyChange(body(LIMIT))), ports: {} });
    assert.equal(atLimit.next, "review", `${name}: at the limit the change goes to the review`);
    await assert.rejects(extensionTool({ input: formCall(bodyChange(body(LIMIT + 1))), ports: {} }), sizeRefusal, `${name}: one byte over`);
  }
  // The compact JSON of the one-byte-over body, < > & ' escaped, is exactly
  // 256 KiB: only the separator's space makes it longer, as the runtime sends it.
  const over = plainBody(LIMIT + 1);
  const compact = JSON.stringify({ body: over }).replace(/[<>&']/g, "\\u003c"); // each escape is six bytes
  assert.equal(utf8(compact), LIMIT);
});

test("Z4 the read-back refuses a reviewed revision whose sent text is one byte over", async () => {
  const { extensionTool } = await load();
  const { pageForm } = await extensionTool({ input: formCall(bodyChange(plainBody(LIMIT))), ports: {} });
  const filed = { artifactId: "artifact-7", representationRevisionId: "revision-1" };
  const answer = JSON.stringify({ approved: true, review: { envelopeVersion: 1, decision: "approved", targets: [filed] } });
  const readCall = { ...formCall(bodyChange("")), op: "read", artifactId: filed.artifactId, reviewAnswer: JSON.stringify(answer) };
  delete readCall.writeFields;
  const portsWith = (form) => ({ artifacts: { async contentRead(request) { return { ...request, text: JSON.stringify(form), truncated: false }; } } });
  const back = await extensionTool({ input: readCall, ports: portsWith(pageForm) });
  assert.deepEqual(back.reviewedFields, { body: plainBody(LIMIT) }, "at the limit the reviewed values are answered");
  // A revision that holds one more byte than the form step filed is refused.
  const tampered = {
    ...pageForm,
    writeFields: bodyChange(plainBody(LIMIT + 1)),
    excerpts: pageForm.excerpts.map((e) => ({ ...e, proposed: plainBody(LIMIT + 1) })),
  };
  await assert.rejects(extensionTool({ input: readCall, ports: portsWith(tampered) }), sizeRefusal);
});

// --- expectedBindingJson, at the check of the read (before the model step) -----

const pageCall = (binding) => ({
  op: "page",
  readNodeId: JSON.stringify("7"),
  readInstanceId: JSON.stringify("site-1"),
  nid: JSON.stringify(7),
  language: JSON.stringify("en"),
  published: JSON.stringify(true),
  fields: JSON.stringify({ title: "Opening hours", body: "<p>x</p>" }),
  binding: JSON.stringify(binding),
  nodeId: JSON.stringify("7"),
  instanceId: JSON.stringify("site-1"),
});
// {"nid": 7, "seal": "<seal>"} is sent as 22 bytes around the seal; each ' in
// the seal is sent as 6 bytes.
const bindingOf = (rendered) => ({ nid: 7, seal: `''${"s".repeat(rendered - 22 - 12)}` });

test("Z5 a binding whose sent text is exactly 256 KiB passes the check of the read; one byte more is refused there", async () => {
  const { extensionTool } = await load();
  const atLimit = await extensionTool({ input: pageCall(bindingOf(LIMIT)), ports: {} });
  assert.equal(atLimit.ok, true);
  await assert.rejects(
    extensionTool({ input: pageCall(bindingOf(LIMIT + 1)), ports: {} }),
    (err) =>
      err instanceof Error &&
      err.message.startsWith("node_read_unavailable: ") &&
      err.message.includes(`more than the ${LIMIT} bytes the Drupal connector takes`),
  );
});
