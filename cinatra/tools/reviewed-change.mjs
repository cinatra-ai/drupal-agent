/**
 * THE REVIEWED CHANGE: THE FORM THAT IS FILED, AND THE READ BACK.
 *
 * `op: form` builds the page snapshot a person reviews from the read and the
 * values the compose step answers (`writeFields`: the fields and the publish
 * flag). The changed blocks the display shows (`excerpts`) are derived from
 * those values by `pageExcerpts`, in code; a change the display cannot show is
 * refused, and nothing is filed.
 *
 * `op: read`, after the review, reads back the revision the person approved
 * and answers its values. The write step takes the values it writes only from
 * this answer, so it can write nothing the reviewed snapshot did not hold. The
 * read derives the blocks again from those values and the same read, and
 * refuses when the reviewed text shows other blocks.
 *
 * - The revision read is the one the review's answer names for the filed
 *   artifact, never the one this run filed: after a Regenerate the approved
 *   revision is a successor of it.
 * - It reads through the host's artifact read port, by that revision id, and
 *   never the latest revision.
 * - It refuses, so the step and the run fail and the write step never runs,
 *   when the answer names no approved revision of the filed artifact, when the
 *   read fails, is cut short or answers another revision or artifact, when the
 *   text carries no values to write, and when it shows other blocks than the
 *   ones derived from its values.
 *
 * It refuses by the host's documented means: it throws an error named
 * `ExtensionToolCallRefusal` whose message is one sentence, which starts with
 * the code `reviewed_change_unavailable`. It writes no port, no table and no
 * artifact.
 */

export const CODE = "reviewed_change_unavailable";

/** The type of the page snapshot the flow files. */
const PAGE_TYPE = "@cinatra-ai/website-artifacts:page-snapshot";

/** The ONE name the host reads as a module's refusal of a call. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

/** The host repeats a refusal sentence of at most this many characters. */
const SENTENCE_MAX = 400;

function refuse(cause) {
  const line = `${CODE}: nothing was written, because ${cause}; start a new run.`.replace(/\s+/g, " ").trim();
  const error = new Error(line.length <= SENTENCE_MAX ? line : `${line.slice(0, SENTENCE_MAX - 1).trimEnd()}…`);
  error.name = REFUSAL_NAME;
  throw error;
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A text value the flow sends as JSON text (or as the bare text), read back; "" when absent. */
function readText(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    // the bare text itself
  }
  return value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The revision of the filed artifact the review's answer approves. */
function approvedRevision(answerText, artifactId) {
  const answer = parseJson(answerText.trim());
  if (!isPlainObject(answer) || !isPlainObject(answer.review)) {
    refuse("the review's answer names no approved revision");
  }
  if (answer.approved !== true && answer.review.decision !== "approved") {
    refuse("the review's answer is not an approval");
  }
  const targets = answer.review.targets;
  if (!Array.isArray(targets) || targets.length !== 1 || !isPlainObject(targets[0])) {
    refuse("the review's answer does not name exactly one approved revision");
  }
  const [target] = targets;
  if (target.artifactId !== artifactId) {
    refuse("the review approved another artifact than the page snapshot this run filed");
  }
  if (typeof target.representationRevisionId !== "string" || target.representationRevisionId.trim() === "") {
    refuse("the review's answer names no revision of the page snapshot");
  }
  return target.representationRevisionId;
}

/** The values to write, as the reviewed text holds them. */
function valuesToWrite(text) {
  const form = parseJson(text);
  if (!isPlainObject(form) || form.cinatraCmsPage !== 1 || form.system !== "drupal") {
    refuse("the reviewed revision is not a Drupal page snapshot");
  }
  const writeFields = form.writeFields;
  if (!isPlainObject(writeFields) || !Array.isArray(writeFields.fields) || typeof writeFields.publish !== "boolean") {
    refuse("the reviewed revision carries no values to write");
  }
  const seen = new Set();
  for (const item of writeFields.fields) {
    if (!isPlainObject(item) || typeof item.field !== "string" || item.field.trim() === "" || typeof item.value !== "string") {
      refuse("a field of the reviewed revision has no name or no text value");
    }
    if (seen.has(item.field)) refuse(`the reviewed revision names the field ${item.field} twice`);
    seen.add(item.field);
  }
  if (writeFields.fields.length === 0 && writeFields.publish !== true) {
    refuse("the reviewed revision carries no values to write");
  }
  return {
    fields: writeFields.fields.map((item) => ({ field: item.field, value: item.value })),
    publish: writeFields.publish,
    shown: form.excerpts,
  };
}

// ---------------------------------------------------------------------------
// THE SHOWN BLOCKS, DERIVED FROM THE VALUES TO WRITE.
//
// The display draws the changed blocks (`excerpts`) of the page snapshot, each
// as plain words; it never draws `writeFields`. So the blocks are derived here,
// by one function, from the read and the values to write: at filing time
// (`op: form`) and again at the read-back (`op: read`), which refuses when the
// reviewed text shows other blocks.
//
// A value is split into its top-level blocks: a heading h1 to h6, a paragraph,
// each item of a list (with the list's own opening tag), any other element, a
// comment, and a run of text with inline elements. Blocks are paired by their
// position. A block whose markup changed is shown with its plain words; when
// its words did not change (a link target, an attribute, a list type, a
// comment, an image, a block without words), the display cannot show the
// change, so it is refused.
// ---------------------------------------------------------------------------

/** The most blocks the display draws from one form. */
const MAX_EXCERPTS = 200;

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** The top-level nodes of a value: `{ name, source }`, in order. */
function topLevelNodes(html) {
  const nodes = [];
  const pushText = (text) => {
    if (text.trim() !== "") nodes.push({ name: "#text", source: text });
  };
  const token = new RegExp(TOKEN.source, "g");
  let depth = 0;
  let start = 0;
  let name = "";
  let at = 0;
  let match;
  while ((match = token.exec(html)) !== null) {
    const index = match.index;
    if (depth === 0) pushText(html.slice(at, index));
    const [whole, slash, rawName] = match;
    at = token.lastIndex;
    if (rawName === undefined) {
      if (depth === 0) nodes.push({ name: "#comment", source: whole });
      continue;
    }
    const tag = rawName.toLowerCase();
    if (slash === "/") {
      if (depth === 0) {
        nodes.push({ name: "#stray", source: whole });
      } else if (--depth === 0) {
        nodes.push({ name, source: html.slice(start, at) });
      }
      continue;
    }
    if (depth === 0) {
      start = index;
      name = tag;
    }
    if (VOID_ELEMENTS.has(tag) || whole.endsWith("/>")) {
      if (depth === 0) nodes.push({ name: tag, source: whole });
      continue;
    }
    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, at);
      const end = close < 0 ? html.length : html.indexOf(">", close) < 0 ? html.length : html.indexOf(">", close) + 1;
      token.lastIndex = end;
      at = end;
      if (depth === 0) nodes.push({ name: tag, source: html.slice(index, end) });
      continue;
    }
    depth += 1;
  }
  if (depth > 0) nodes.push({ name, source: html.slice(start) });
  else pushText(html.slice(at));
  // A run of text and inline elements is one block.
  const merged = [];
  for (const node of nodes) {
    const inline = node.name === "#text" || INLINE_ELEMENTS.has(node.name);
    const last = merged[merged.length - 1];
    if (inline && last?.name === "#inline") last.source += node.source;
    else merged.push(inline ? { name: "#inline", source: node.source } : node);
  }
  return merged.map((node) => ({ ...node, source: node.name === "#inline" ? node.source.trim() : node.source }));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A block's plain words: no comment, no tag, entities decoded, white space as one space. */
function plainWords(source) {
  return source
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body) => {
      if (body[0] === "#") {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The source a block is compared by: white space as one space, except in pre. */
const comparable = (name, source) => (name === "pre" ? source : source.replace(/\s+/g, " ").trim());

/** The blocks of one value: `{ kind, level, key, words }`, in order. */
function blocksOf(value) {
  const blocks = [];
  for (const node of topLevelNodes(value)) {
    const heading = /^h([1-6])$/.exec(node.name);
    if (heading) {
      blocks.push({ kind: "heading", level: Number(heading[1]), key: comparable(node.name, node.source), words: plainWords(node.source) });
    } else if (node.name === "ul" || node.name === "ol") {
      const open = /^<[^>]*>/.exec(node.source)[0];
      const closeAt = node.source.toLowerCase().lastIndexOf(`</${node.name}`);
      const inner = node.source.slice(open.length, closeAt < open.length ? node.source.length : closeAt);
      const items = topLevelNodes(inner);
      if (items.length === 0) blocks.push({ kind: "paragraph", level: null, key: comparable(node.name, node.source), words: "" });
      for (const item of items) {
        blocks.push({
          kind: "list-item",
          level: null,
          key: comparable(node.name, open + item.source),
          words: plainWords(item.source),
        });
      }
    } else {
      blocks.push({ kind: "paragraph", level: null, key: comparable(node.name, node.source), words: plainWords(node.source) });
    }
  }
  return blocks;
}

/** The most blocks one value may have for the alignment. */
const MAX_BLOCKS = 2000;

/**
 * The two block lists aligned by their longest common run of unchanged blocks.
 * Each step is `{ same: true }`, or a change `{ old, next }` where a removed
 * block has no `next` and an added one no `old`; the removed and added blocks
 * between two unchanged ones are paired in order. A step's index is the
 * position the display draws.
 */
function alignedBlocks(region, was, will) {
  if (was.length > MAX_BLOCKS || will.length > MAX_BLOCKS) refuse(`${region} has more than ${MAX_BLOCKS} blocks`);
  const rows = was.length + 1;
  const cols = will.length + 1;
  const common = new Uint32Array(rows * cols);
  for (let i = was.length - 1; i >= 0; i -= 1) {
    for (let j = will.length - 1; j >= 0; j -= 1) {
      common[i * cols + j] = was[i].key === will[j].key
        ? common[(i + 1) * cols + j + 1] + 1
        : Math.max(common[(i + 1) * cols + j], common[i * cols + j + 1]);
    }
  }
  const steps = [];
  let removed = [];
  let added = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) steps.push({ old: removed[k], next: added[k] });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < was.length || j < will.length) {
    if (i < was.length && j < will.length && was[i].key === will[j].key) {
      flush();
      steps.push({ same: true });
      i += 1;
      j += 1;
    } else if (j >= will.length || (i < was.length && common[(i + 1) * cols + j] >= common[i * cols + j + 1])) {
      removed.push(was[i]);
      i += 1;
    } else {
      added.push(will[j]);
      j += 1;
    }
  }
  flush();
  return steps;
}

const sameWords = (a, b) => a.trim().split(/\s+/).join(" ") === b.trim().split(/\s+/).join(" ");

/** The read's values as the derivation takes them: title, body and the `field_` values. */
function readValuesOf(call) {
  const fieldValues = parseJson(readText(call.fieldValues));
  if (!Array.isArray(fieldValues)) refuse("the read's field values are not a list");
  const values = new Map([["title", readText(call.title)], ["body", readText(call.body)]]);
  for (const item of fieldValues) {
    if (!isPlainObject(item) || typeof item.field !== "string" || typeof item.value !== "string" || !item.field.startsWith("field_")) {
      refuse("a field value of the read has no field_ name or no text value");
    }
    if (values.has(item.field)) refuse(`the read names the field ${item.field} twice`);
    values.set(item.field, item.value);
  }
  return values;
}

/**
 * THE ONE DERIVATION of the blocks the review shows, from the read (`title`,
 * `body`, `fieldValues`) and the values to write (`{ fields }`). Regions come
 * in the read's order: title, body, then the `field_` values.
 */
export function pageExcerpts(read, writeFields) {
  const values = read instanceof Map
    ? read
    : readValuesOf({ title: read.title, body: read.body, fieldValues: JSON.stringify(read.fieldValues ?? []) });
  const toWrite = new Map();
  for (const item of writeFields.fields) {
    if (!values.has(item.field)) refuse(`the field ${item.field} is not a field the read returned`);
    toWrite.set(item.field, item.value);
  }
  const excerpts = [];
  for (const [region, before] of values) {
    if (!toWrite.has(region)) continue;
    const after = toWrite.get(region);
    if (region === "title") {
      if (before === after) continue;
      if (sameWords(before, after)) refuse("the title changes only in white space, which the page snapshot cannot show");
      excerpts.push({ region, position: 0, kind: "heading", level: 1, published: before, proposed: after });
      continue;
    }
    alignedBlocks(region, blocksOf(before), blocksOf(after)).forEach((step, position) => {
      if (step.same) return;
      const { old, next } = step;
      const published = old ? old.words : "";
      const proposed = next ? next.words : "";
      if (next !== undefined && next.words === "") {
        refuse(`a block of ${region} to write has no words, which the page snapshot cannot show`);
      }
      if (sameWords(published, proposed)) {
        refuse(`a block of ${region} changes only in its markup, which the page snapshot cannot show`);
      }
      const shape = next ?? old;
      excerpts.push({ region, position, kind: shape.kind, level: shape.level, published, proposed });
    });
  }
  if (excerpts.length > MAX_EXCERPTS) refuse(`the change has more than ${MAX_EXCERPTS} blocks, more than the page snapshot can show`);
  return excerpts;
}

/** The values to write as the compose step answers them, checked. */
function checkedWriteFields(value) {
  if (!isPlainObject(value) || !Array.isArray(value.fields) || typeof value.publish !== "boolean") {
    refuse("the compose step answered no values to write");
  }
  const seen = new Set();
  for (const item of value.fields) {
    if (!isPlainObject(item) || typeof item.field !== "string" || item.field.trim() === "" || typeof item.value !== "string") {
      refuse("a value to write has no field name or no text value");
    }
    if (seen.has(item.field)) refuse(`the values to write name the field ${item.field} twice`);
    seen.add(item.field);
  }
  return { fields: value.fields.map((item) => ({ field: item.field, value: item.value })), publish: value.publish };
}

/** `op: form` — the page snapshot to file, built from the read and the values to write. */
function form(call) {
  const writeFields = checkedWriteFields(parseJson(readText(call.writeFields)));
  const error = parseJson(readText(call.error));
  const failedRead = !isPlainObject(error) || (typeof error.code === "string" ? error.code.trim() !== "" : error.code !== undefined);
  if (failedRead && (writeFields.fields.length > 0 || writeFields.publish)) refuse("the read failed, so there is nothing to write");
  const values = readValuesOf(call);
  const address = readText(call.address).trim();
  return {
    ok: true,
    pageForm: {
      cinatraCmsPage: 1,
      system: "drupal",
      page: { title: values.get("title"), address: address === "" ? null : address, cmsAddress: address === "" ? null : `${address}/edit` },
      writeFields,
      excerpts: failedRead ? [] : pageExcerpts(values, writeFields),
    },
  };
}

const excerptKey = (list) =>
  JSON.stringify(
    list.map((e) => (isPlainObject(e) ? [e.region, e.position, e.kind, e.kind === "heading" ? e.level : null, e.published, e.proposed] : e)),
  );

async function read(call, ports) {
  const artifactId = readText(call.artifactId).trim();
  if (artifactId === "") refuse("the run filed no page snapshot");
  const readValues = readValuesOf(call);
  const revisionId = approvedRevision(readText(call.reviewAnswer), artifactId);
  let result;
  try {
    result = await ports.artifacts.contentRead({ artifactId, representationRevisionId: revisionId, objectType: PAGE_TYPE });
  } catch {
    refuse("the reviewed revision could not be read");
  }
  if (!isPlainObject(result) || typeof result.text !== "string") {
    refuse("the reviewed revision could not be read");
  }
  if (result.truncated !== false) refuse("the read of the reviewed revision was cut short");
  if (result.representationRevisionId !== revisionId) refuse("the read answered another revision than the approved one");
  if (result.artifactId !== undefined && result.artifactId !== artifactId) {
    refuse("the read answered another artifact than the reviewed one");
  }
  const values = valuesToWrite(result.text);
  if (!Array.isArray(values.shown)) refuse("the reviewed revision shows no changed blocks");
  if (excerptKey(values.shown) !== excerptKey(pageExcerpts(readValues, values))) {
    refuse("the reviewed revision shows other words than the values it would write");
  }
  return { ok: true, reviewedFields: values.fields, reviewedPublish: values.publish, reviewedRevisionId: revisionId };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Its operations are `form` and `read`; any other
 * is refused.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "form") return form(call);
  if (op === "read") return read(call, ports);
  throw new Error(`reviewed_change: \`op\` must be form or read — got ${JSON.stringify(call.op)}`);
}
