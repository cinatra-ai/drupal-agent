// cinatra-ai/cinatra#3862 — the Drupal agent files the page snapshot.
//
// The agent reads the page, files the page snapshot with the published and the
// proposed words, the application reviews it, and the write step follows the
// review.
//
// The eight arms pin: the nine steps on one road; the read step; the compose
// step and the one example form it carries; the filing step and the type the
// pack declares it produces; the projection step and the review step; the write
// step after the review; the declared module; and the end node binding nothing.
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
const parts = oas.$referenced_components ?? {};

const EXTENSION = "@cinatra-ai/cms-snapshot-artifact";
const PAGE_TYPE = "@cinatra-ai/cms-snapshot-artifact:cms-page";
const PACKAGE_NAME = "@cinatra-ai/drupal-agent";
const LLM_BRIDGE_PATH = "/api/llm-bridge";
const PASSTHROUGH_PATH = "/api/agents/passthrough";

/** The one road, step by step. */
const ROAD = [
  "start",
  "read_node",
  "compose_change",
  "file_page",
  "gather_page_review",
  "page_review_gate",
  "load_node",
  "emit_output",
  "end",
];

/** The marker lines around the one example form of the compose step. */
const EXAMPLE_BEGIN = "--- example form begin ---";
const EXAMPLE_END = "--- example form end ---";

const WRITE_TOOLS = ["drupal_node_update", "drupal_node_create_draft_revision", "drupal_node_publish"];

function part(id) {
  const node = parts[id];
  assert.ok(node, `the flow declares the step "${id}"`);
  return node;
}

const titles = (list) => (list ?? []).map((entry) => entry.title);

function declared(list, title) {
  const entry = (list ?? []).find((e) => e && e.title === title);
  assert.ok(entry, `"${title}" is declared`);
  return entry;
}

function edgeInto(node, input) {
  return (oas.data_flow_connections ?? []).find(
    (e) => e.destination_node.$component_ref === node && e.destination_input === input,
  );
}

function assertEdge(node, input, fromNode, fromOutput) {
  const edge = edgeInto(node, input);
  assert.ok(edge, `"${node}.${input}" is edge-sourced`);
  assert.equal(edge.source_node.$component_ref, fromNode, `"${node}.${input}" comes from "${fromNode}"`);
  assert.equal(edge.source_output, fromOutput, `"${node}.${input}" comes from "${fromNode}.${fromOutput}"`);
}

function memberKeys(schema) {
  assert.ok(schema && typeof schema === "object", "a schema object declares the members");
  const properties = schema.properties;
  assert.ok(properties && typeof properties === "object", "the level declares its members");
  return Object.keys(properties).sort();
}

function assertStringItems(output) {
  assert.equal(output.type, "array");
  const items = output.json_schema?.items;
  assert.deepEqual(memberKeys(items), ["field", "value"]);
  assert.equal(items.properties.field.type, "string");
  assert.equal(items.properties.value.type, "string");
}

// ---------------------------------------------------------------------------
// A COPY of the display's form reader, as plain JavaScript, from
// @cinatra-ai/cms-snapshot-artifact src/cms-page-model.ts at commit
// 1fc58a05c93c4d1c431110b00f18dbdf9a9d4216 (framableAddress and parseCmsPage
// with the helpers they call).
// ---------------------------------------------------------------------------
const CMS_PAGE_FORM_MARKER = "cinatraCmsPage";
const CMS_PAGE_FORM_VERSION = 1;
const CMS_PAGE_MAX_EXCERPTS = 200;
const SYSTEMS = ["wordpress", "drupal"];
const KINDS = ["heading", "paragraph", "list-item"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function framableAddress(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  return value;
}

function parseExcerpt(value) {
  if (!isRecord(value)) return null;
  const { region, position, kind, level, published, proposed } = value;
  if (typeof region !== "string" || region.length === 0) return null;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) return null;
  if (typeof kind !== "string" || !KINDS.includes(kind)) return null;
  if (typeof published !== "string" || typeof proposed !== "string") return null;
  let headingLevel = null;
  if (kind === "heading") {
    if (level === undefined) headingLevel = 2;
    else if (typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6) headingLevel = level;
    else return null;
  }
  return { region, position, kind, level: headingLevel, published, proposed };
}

function parseCmsPage(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isRecord(value) || !(CMS_PAGE_FORM_MARKER in value)) return { ok: false, reason: "not-the-form" };
  if (value[CMS_PAGE_FORM_MARKER] !== CMS_PAGE_FORM_VERSION) return { ok: false, reason: "form-version" };

  const excerpts = value.excerpts;
  if (excerpts === undefined || (Array.isArray(excerpts) && excerpts.length === 0)) {
    return { ok: false, reason: "no-excerpts" };
  }

  const system = value.system;
  const page = value.page;
  if (typeof system !== "string" || !SYSTEMS.includes(system)) return { ok: false, reason: "malformed" };
  if (!isRecord(page) || typeof page.title !== "string") return { ok: false, reason: "malformed" };
  if (!Array.isArray(excerpts) || excerpts.length > CMS_PAGE_MAX_EXCERPTS) return { ok: false, reason: "malformed" };

  const parsed = [];
  for (const entry of excerpts) {
    const excerpt = parseExcerpt(entry);
    if (excerpt === null) return { ok: false, reason: "malformed" };
    parsed.push(excerpt);
  }

  return {
    ok: true,
    page: {
      system,
      page: {
        title: page.title,
        address: framableAddress(page.address),
        cmsAddress: framableAddress(page.cmsAddress),
      },
      readAt: typeof value.readAt === "string" ? value.readAt : null,
      excerpts: parsed,
    },
  };
}

// The display's Drupal fixture form, copied from the same commit's
// tests/cms-page-fixture.ts (lines 9-63; the Drupal form at 59-63).
const DRUPAL_FIXTURE_FORM = {
  cinatraCmsPage: 1,
  system: "drupal",
  page: {
    title: "Pricing — 2026 plans",
    address: "https://acme.example/pricing",
    cmsAddress: "https://acme.example/node/7/edit",
  },
  readAt: "2026-09-29T10:00:00.000Z",
  excerpts: [
    {
      region: "title",
      position: 0,
      kind: "heading",
      level: 1,
      published: "Pricing that grows with you",
      proposed: "Pricing — 2026 plans",
    },
    {
      region: "content",
      position: 2,
      kind: "paragraph",
      published: "Three plans, a price held since 2024, and the migration note under each.",
      proposed: "Three plans, one price change, and the migration note under each.",
    },
    {
      region: "content",
      position: 5,
      kind: "list-item",
      published: "Team — 35 per seat",
      proposed: "Team — 39 per seat",
    },
  ],
};

// ---------------------------------------------------------------------------

test("S1 the nine steps stand on one road, the write step after the review", () => {
  assert.deepEqual(
    (oas.nodes ?? []).map((n) => n.$component_ref),
    ROAD,
    "the flow's steps, in road order",
  );
  for (const id of ROAD) part(id);
  const edges = (oas.control_flow_connections ?? []).map((e) => [
    e.from_node.$component_ref,
    e.to_node.$component_ref,
  ]);
  const expected = ROAD.slice(1).map((to, i) => [ROAD[i], to]);
  assert.deepEqual(edges, expected, "eight control edges, one road, in exactly this order");
  assert.equal(oas.start_node.$component_ref, "start");
  assert.ok(
    ROAD.indexOf("load_node") > ROAD.indexOf("page_review_gate") &&
      edges.findIndex(([, to]) => to === "load_node") > edges.findIndex(([, to]) => to === "page_review_gate"),
    "no load_node before the review step",
  );
});

test("S2 the read step reads the node and composes its public address", () => {
  const node = part("read_node");
  const write = part("load_node");
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.includes(LLM_BRIDGE_PATH), "the read step is a bridge step");
  assert.equal(node.url, write.url);
  assert.equal(node.http_method, write.http_method);
  assert.equal(node.data.agent_id, write.data.agent_id);
  assert.deepEqual(node.data.cinatra_llm, write.data.cinatra_llm);
  assert.equal(node.data.agent_run_id, "{{ agent_run_id }}");
  assert.equal("toolbox_ids" in node.data, false, "the read step keeps the default toolbox offer");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");
  assert.equal(node.metadata.cinatra.requiresApproval, false);
  assert.equal(node.metadata.cinatra.packageName, PACKAGE_NAME);

  const system = node.data.system;
  assert.ok(system.includes("drupal_node_get"), "the read step names drupal_node_get");
  assert.ok(system.includes("drupal_instances_list"), "the read step names drupal_instances_list");
  for (const tool of WRITE_TOOLS) {
    assert.equal(system.includes(tool), false, `the read step never names ${tool}`);
  }

  assert.deepEqual(titles(node.inputs), ["instanceId", "nodeId", "agent_run_id"]);
  assertEdge("read_node", "instanceId", "start", "instanceId");
  assertEdge("read_node", "nodeId", "start", "nodeId");
  assertEdge("read_node", "agent_run_id", "start", "cinatra_run_id");

  assert.deepEqual(titles(node.outputs), ["title", "body", "fieldValues", "address", "error", "nodeStatus", "nodeBundle", "nodeLanguage"]);
  assert.equal(declared(node.outputs, "nodeLanguage").type, "string");
  assert.equal(declared(node.outputs, "title").type, "string");
  assert.equal(declared(node.outputs, "body").type, "string");
  assert.equal(declared(node.outputs, "address").type, "string");
  assertStringItems(declared(node.outputs, "fieldValues"));
  const error = declared(node.outputs, "error");
  assert.equal(error.type, "object");
  assert.deepEqual(memberKeys(error.json_schema), ["code", "message"]);
});

test("S3 the compose step answers the proposed fields and the page form, with one example form the display parses", () => {
  const node = part("compose_change");
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.includes(LLM_BRIDGE_PATH), "the compose step is a bridge step");
  assert.deepEqual(node.data.toolbox_ids, [], "no tool joins the compose step");
  assert.equal(node.metadata.cinatra.riskClass, "read_only");

  assertEdge("compose_change", "instructions", "start", "instructions");
  for (const output of ["title", "body", "fieldValues", "address", "error"]) {
    assertEdge("compose_change", output, "read_node", output);
  }

  assert.deepEqual(titles(node.outputs), ["pageTitle", "proposedFields", "pageForm"]);
  assert.equal(declared(node.outputs, "pageTitle").type, "string");
  assertStringItems(declared(node.outputs, "proposedFields"));
  const pageForm = declared(node.outputs, "pageForm");
  assert.equal(pageForm.type, "object");
  const form = pageForm.json_schema;
  assert.deepEqual(memberKeys(form), ["cinatraCmsPage", "excerpts", "page", "system"]);
  assert.deepEqual(memberKeys(form.properties.page), ["address", "cmsAddress", "title"]);
  assert.equal(form.properties.excerpts.type, "array");
  assert.deepEqual(memberKeys(form.properties.excerpts.items), [
    "kind",
    "level",
    "position",
    "proposed",
    "published",
    "region",
  ]);

  const system = node.data.system;
  assert.equal(system.split(EXAMPLE_BEGIN).length, 2, "exactly one example form");
  assert.equal(system.split(EXAMPLE_END).length, 2, "exactly one end of the example form");
  const example = system.slice(system.indexOf(EXAMPLE_BEGIN) + EXAMPLE_BEGIN.length, system.indexOf(EXAMPLE_END));
  const parsed = parseCmsPage(example.trim());
  assert.equal(parsed.ok, true, `the example form parses (${parsed.reason ?? "ok"})`);
  assert.equal(parsed.page.system, "drupal");
  const raw = JSON.parse(example.trim());
  assert.equal("readAt" in raw, false, "the example form carries no readAt key");
  assert.equal(raw.page.cmsAddress, `${raw.page.address}/edit`, "the edit address is the address plus /edit");
  assert.deepEqual(
    parsed.page.excerpts[0],
    { region: "title", position: 0, kind: "heading", level: 1, published: raw.excerpts[0].published, proposed: raw.excerpts[0].proposed },
    "the title is one heading block of level 1 at position 0",
  );

  const fixture = parseCmsPage(JSON.stringify(DRUPAL_FIXTURE_FORM));
  assert.equal(fixture.ok, true, "the display's Drupal fixture form parses");
  assert.equal(fixture.page.system, "drupal");
  assert.deepEqual(parseCmsPage(JSON.stringify({ ...raw, excerpts: [] })), { ok: false, reason: "no-excerpts" });
});

test("S4 the filing step files the page form as the display's type, and the pack declares it produces that type", () => {
  const node = part("file_page");
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.includes(PASSTHROUGH_PATH), "the filing step is a passthrough step");
  assert.equal(node.data.tool, "artifact_materialize");
  const input = node.data.input;
  assert.equal(input.extension, EXTENSION);
  assert.equal(input.objectTypeId, PAGE_TYPE);
  assert.equal(input.declaredMime, "application/json");
  assert.equal(input.node_id, "file_page");
  assert.equal(input.node_id, node.id, "the filing step names its own id");
  assert.equal(input.title, "{{ pageTitle }}");
  assert.equal(input.content, "{# pyagentspec-input-hint (do not remove): {{ pageForm }} #}{{ pageForm | tojson }}");
  assert.equal(node.data.agent_run_id, "{{ cinatra_run_id }}");
  assertEdge("file_page", "pageTitle", "compose_change", "pageTitle");
  assertEdge("file_page", "pageForm", "compose_change", "pageForm");
  assertEdge("file_page", "cinatra_run_id", "start", "cinatra_run_id");
  assert.deepEqual(titles(node.outputs), ["artifactId", "representationRevisionId"]);
  assert.equal(node.metadata.cinatra.riskClass, "write");
  assert.equal(node.metadata.cinatra.requiresApproval, false);
  assert.equal(node.metadata.cinatra.packageName, PACKAGE_NAME);

  assert.deepEqual(pkg.cinatra.produces, [{ extension: EXTENSION, objectTypeId: PAGE_TYPE }]);
  const deps = pkg.cinatra.dependencies;
  assert.equal(deps[0].packageName, "@cinatra-ai/drupal-mcp-connector", "the connector entry stays first");
  assert.deepEqual(deps[1], {
    packageName: EXTENSION,
    edgeType: "runtime",
    versionConstraint: { kind: "semver-range", range: "^0.1.0" },
    requirement: "required",
    kind: "artifact",
  });
  for (const list of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const names = Object.keys(pkg[list] ?? {});
    assert.deepEqual(
      names.filter((n) => n.startsWith("@cinatra-ai/")),
      [],
      `no first-party name in the npm ${list}`,
    );
  }
});

test("S5 the projection step names the filed revision to the review step, the flow's one pause", () => {
  const gate = part("page_review_gate");
  assert.equal(gate.component_type, "InputMessageNode");
  assert.equal(gate.metadata.cinatra.artifactReview?.targetsInput, "reviewTargets");
  assert.equal(gate.metadata.cinatra.a2uiSurfaceId, "drupal-agent:page-review");
  assert.ok(titles(gate.inputs).includes("reviewTargets"), "the review step declares the input its marker names");
  assertEdge("page_review_gate", "reviewTargets", "gather_page_review", "reviewTargets");
  assertEdge("page_review_gate", "pageTitle", "compose_change", "pageTitle");

  const node = part("gather_page_review");
  assert.equal(node.component_type, "ApiNode");
  assert.ok(node.url.includes(PASSTHROUGH_PATH), "the projection step is a passthrough step");
  assert.equal(node.data.tool, "extension_tool");
  assert.equal(node.data.input.name, "review_targets");
  assert.deepEqual(Object.keys(node.data.input.input).sort(), ["op", "reviewTargets"]);
  assert.equal(node.data.input.input.op, "review");
  assert.equal(node.data.result_input_passthrough, true);
  assert.equal(node.data.result_id_field, "ok");
  assert.equal(node.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.deepEqual(titles(node.outputs), ["reviewTargets", "ok"]);

  const template = node.data.input.input.reviewTargets;
  assert.equal(typeof template, "string", "one JSON array string");
  const rendered = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name) => `RENDERED-${name}`);
  const targets = JSON.parse(rendered);
  assert.ok(Array.isArray(targets), "a JSON array of references");
  assert.equal(targets.length, 1, "the page snapshot alone");
  assert.deepEqual(Object.keys(targets[0]).sort(), ["artifactId", "representationRevisionId"]);
  const inputs = titles(node.inputs);
  for (const key of ["artifactId", "representationRevisionId"]) {
    const value = targets[0][key];
    assert.match(value, /^RENDERED-/, `the ${key} is a placeholder the run fills`);
    const name = value.slice("RENDERED-".length);
    assert.ok(inputs.includes(name), `the projection step declares "${name}"`);
    assertEdge("gather_page_review", name, "file_page", key);
  }

  const pauses = (oas.nodes ?? [])
    .map((n) => n.$component_ref)
    .filter((id) => parts[id]?.component_type === "InputMessageNode");
  assert.deepEqual(pauses, ["page_review_gate"], "exactly one InputMessageNode in the flow");
});

test("S6 the write step follows the review", () => {
  const node = part("load_node");
  const into = (oas.control_flow_connections ?? []).filter((e) => e.to_node.$component_ref === "load_node");
  assert.deepEqual(
    into.map((e) => e.from_node.$component_ref),
    ["page_review_gate"],
    "the only control edge into the write step comes from the review step",
  );
  assertEdge("load_node", "artifactId", "file_page", "artifactId");
  assertEdge("load_node", "representationRevisionId", "file_page", "representationRevisionId");
  assertEdge("load_node", "proposedFields", "compose_change", "proposedFields");
  for (const output of ["title", "body", "fieldValues"]) {
    assertEdge("load_node", output, "read_node", output);
  }
  for (const tool of WRITE_TOOLS) {
    assert.ok(node.data.system.includes(tool), `the write step names ${tool}`);
  }
  assert.deepEqual(titles(node.outputs), ["nodeId", "changes", "reason"]);
});

test("S7 the declared module files the set it is handed and nothing else", async () => {
  assert.deepEqual(pkg.cinatra.tools, [{ name: "review_targets", module: "./cinatra/tools/review-targets.mjs" }]);
  const { extensionTool } = await import("../cinatra/tools/review-targets.mjs");
  assert.equal(typeof extensionTool, "function");

  const reference = { artifactId: "artifact-001", representationRevisionId: "revision-001" };
  const filed = [];
  const ports = {
    review: {
      file(targets) {
        filed.push(targets);
      },
    },
  };
  const result = await extensionTool({
    input: { op: "review", reviewTargets: JSON.stringify([reference]) },
    ports,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(filed, [[reference]], "the parsed set is filed once");

  await assert.rejects(
    async () => extensionTool({ input: { op: "prepare" }, ports }),
    (err) => err instanceof Error && err.message.includes("review"),
    "an unknown op rejects, naming the one op it knows",
  );
  assert.equal(filed.length, 1, "a refused op files nothing");
});

test("S8 the end node preserves the content outputs with a visible refusal reason and binds nothing: the snapshot is filed during the run", () => {
  const end = part("end");
  assert.deepEqual(titles(end.outputs), ["nodeId", "changes", "reason"]);
  assert.deepEqual(titles(oas.outputs), ["nodeId", "changes", "reason"]);
  assert.deepEqual(
    (end.outputs ?? []).filter((o) => o.cinatra?.artifact).map((o) => o.title),
    [],
    "no end output carries a binding",
  );
  assert.deepEqual(
    (oas.outputs ?? []).filter((o) => o.cinatra?.artifact).map((o) => o.title),
    [],
    "no flow output carries a binding",
  );
  assertEdge("end", "nodeId", "load_node", "nodeId");
  assertEdge("end", "changes", "load_node", "changes");
  const filings = (oas.nodes ?? [])
    .map((n) => n.$component_ref)
    .filter((id) => parts[id]?.data?.tool === "artifact_materialize");
  assert.deepEqual(filings, ["file_page"], "the one filing happens during the run, before the end");
});
