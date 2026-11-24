/**
 * THE REVIEWED CHANGE: THE FORM THAT IS FILED, AND THE READ BACK.
 *
 * `op: form` builds the page snapshot a person reviews from the read and the
 * values the compose step answers (`writeFields`: the fields and the publish
 * flag). The changed blocks the display shows (`excerpts`) are derived from
 * those values by `pageExcerpts`, in code: each changed block is shown as its
 * source text, so everything written for it is shown. A change the display
 * cannot show is refused, and nothing is filed. It also answers `next`:
 * `no_change` when the values change nothing and ask for no publish, so the
 * flow ends the run past the filing and the review; `review` otherwise.
 *
 * `op: unchanged` is the step of that no-change road. It derives the blocks
 * again, refuses unless the values still change nothing and ask for no
 * publish, and answers the run's outcome: the node, no changes, no reason.
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
 * - The answer is an approval only when all its signals agree: `approved` is
 *   true, `review.decision` is "approved" and `review.envelopeVersion` is 1
 *   (cinatra-ai/cinatra, src/lib/artifacts/artifact-review-rejection.ts,
 *   buildReviewApproveEnvelope).
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

/** The one envelope version of the review's answer this module reads. */
const ENVELOPE_VERSION = 1;

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
  if (answer.approved !== true || answer.review.decision !== "approved") {
    refuse("the review's answer is not an approval");
  }
  if (answer.review.envelopeVersion !== ENVELOPE_VERSION) {
    refuse("the review's answer is not of the version this pack reads");
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
// The display draws the changed blocks (`excerpts`) of the page snapshot as
// plain text; it never draws `writeFields`. So the blocks are derived here, by
// one function, from the read and the values to write: at filing time
// (`op: form`) and again at the read-back (`op: read`), which refuses when the
// reviewed text shows other blocks.
//
// A value is split into its top-level blocks: a heading h1 to h6, a
// paragraph, each item of a list (the first with the list's opening tag, the
// last with its closing tag), any other element, a comment, and a run of text
// with inline elements. White space between blocks belongs to the block
// before it. The blocks joined are the value, byte for byte. Blocks are
// compared byte for byte and paired by their position, and a changed block is
// shown as its SOURCE text on both sides: markup, link targets, attributes,
// tags, comments and images are drawn as text, whether or not the words
// change. Every block that is not shown is byte for byte the read.
//
// What the display cannot show is refused: a block whose two sides differ only
// in white space (the display's parser rejects a block whose two sides hold
// the same words, white space aside), and more than 200 changed blocks. The
// display draws a run of white space inside a shown block as one space, so the
// exact white space of a shown block is not distinguishable; markup and words
// are.
// ---------------------------------------------------------------------------

/** The most blocks the display draws from one form. */
const MAX_EXCERPTS = 200;

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);
const OPEN_TAG = /<([A-Za-z][A-Za-z0-9-]*)/y;
const ANY_TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)/y;

/** The index after the `>` that closes the tag starting at `from`, quotes respected. */
function tagEnd(text, from) {
  let quote = null;
  for (let i = from + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return text.length;
}

function commentEnd(text, from) {
  const end = text.indexOf("-->", from + 4);
  return end < 0 ? text.length : end + 3;
}

/** The index after the element that starts at `from`, with its matching end tag. */
function elementEnd(text, from, name) {
  const first = tagEnd(text, from);
  if (VOID_ELEMENTS.has(name) || text[first - 2] === "/") return first;
  let depth = 1;
  let i = first;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) return text.length;
    if (text.startsWith("<!--", lt)) {
      i = commentEnd(text, lt);
      continue;
    }
    ANY_TAG.lastIndex = lt;
    const match = ANY_TAG.exec(text);
    const end = tagEnd(text, lt);
    if (match !== null && match[2].toLowerCase() === name) {
      if (match[1] === "/") depth -= 1;
      else if (text[end - 2] !== "/") depth += 1;
      if (depth === 0) return end;
    }
    i = match !== null ? end : lt + 1;
  }
  return text.length;
}

function startsPiece(text, at) {
  if (text.startsWith("<!--", at)) return true;
  OPEN_TAG.lastIndex = at;
  return OPEN_TAG.test(text);
}

/** The top-level pieces of a text, `{ name, source }`, in order; joined, they are the text. */
function piecesOf(text) {
  const pieces = [];
  let i = 0;
  while (i < text.length) {
    let end;
    let name = "#text";
    if (text.startsWith("<!--", i)) {
      end = commentEnd(text, i);
      name = "#comment";
    } else {
      OPEN_TAG.lastIndex = i;
      const match = OPEN_TAG.exec(text);
      if (match !== null) {
        name = match[1].toLowerCase();
        end = elementEnd(text, i, name);
      } else {
        end = i + 1;
        while (end < text.length) {
          const lt = text.indexOf("<", end);
          if (lt < 0) {
            end = text.length;
            break;
          }
          if (startsPiece(text, lt)) {
            end = lt;
            break;
          }
          end = lt + 1;
        }
      }
    }
    pieces.push({ name, source: text.slice(i, end) });
    i = end;
  }
  return pieces;
}

/**
 * The pieces grouped into blocks `{ name, source }`: white space between them
 * joins the block before it (the first block takes white space before it), a
 * run of text and inline elements is one block. Joined, they are the text.
 */
function grouped(text) {
  const blocks = [];
  let lead = "";
  for (const piece of piecesOf(text)) {
    const last = blocks[blocks.length - 1];
    if (piece.source.trim() === "") {
      if (last) last.source += piece.source;
      else lead += piece.source;
      continue;
    }
    const inline = piece.name === "#text" || INLINE_ELEMENTS.has(piece.name);
    if (inline && last?.name === "#inline") last.source += piece.source;
    else blocks.push({ name: inline ? "#inline" : piece.name, source: lead + piece.source });
    lead = "";
  }
  if (lead !== "") blocks.push({ name: "#inline", source: lead });
  return blocks;
}

/** The blocks of one value: `{ kind, level, source }`, in order; their sources joined are the value. */
function blocksOf(value) {
  const blocks = [];
  for (const block of grouped(value)) {
    const heading = /^h([1-6])$/.exec(block.name);
    if (heading) {
      blocks.push({ kind: "heading", level: Number(heading[1]), source: block.source });
      continue;
    }
    if (block.name === "ul" || block.name === "ol") {
      const startAt = block.source.search(/</);
      const openEnd = tagEnd(block.source, startAt);
      const closeAt = block.source.toLowerCase().lastIndexOf(`</${block.name}`);
      const innerEnd = closeAt >= openEnd ? closeAt : block.source.length;
      const items = grouped(block.source.slice(openEnd, innerEnd)).map((item) => item.source);
      if (items.length > 0) {
        items[0] = block.source.slice(0, openEnd) + items[0];
        items[items.length - 1] += block.source.slice(innerEnd);
        for (const source of items) blocks.push({ kind: "list-item", level: null, source });
        continue;
      }
    }
    blocks.push({ kind: "paragraph", level: null, source: block.source });
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
      common[i * cols + j] = was[i].source === will[j].source
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
    if (i < was.length && j < will.length && was[i].source === will[j].source) {
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
      const published = old ? old.source : "";
      const proposed = next ? next.source : "";
      if (sameWords(published, proposed)) {
        refuse(`a block of ${region} changes only in white space, which the page snapshot cannot show`);
      }
      const shape = next ?? old;
      excerpts.push({ region, position, kind: shape.kind, level: shape.level, published, proposed });
    });
  }
  if (excerpts.length > MAX_EXCERPTS) refuse(`the change has more than ${MAX_EXCERPTS} blocks, more than the page snapshot can show`);
  return excerpts;
}

/** Whether the read step answered a failure: an error that is not an object, or a non-empty code. */
function readFailed(call) {
  const error = parseJson(readText(call.error));
  return !isPlainObject(error) || (typeof error.code === "string" ? error.code.trim() !== "" : error.code !== undefined);
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

/** `op: form` — the page snapshot to file, built from the read and the values to write, and the road it takes. */
function form(call) {
  const writeFields = checkedWriteFields(parseJson(readText(call.writeFields)));
  if (readFailed(call)) refuse("the read failed, so there is nothing to file");
  const values = readValuesOf(call);
  const address = readText(call.address).trim();
  const excerpts = pageExcerpts(values, writeFields);
  return {
    ok: true,
    next: excerpts.length === 0 && !writeFields.publish ? "no_change" : "review",
    pageForm: {
      cinatraCmsPage: 1,
      system: "drupal",
      page: { title: values.get("title"), address: address === "" ? null : address, cmsAddress: address === "" ? null : `${address}/edit` },
      writeFields,
      excerpts,
    },
  };
}

/** `op: unchanged` — the outcome of a change that changes nothing: the node, no changes, no reason. */
function unchanged(call) {
  const writeFields = checkedWriteFields(parseJson(readText(call.writeFields)));
  if (readFailed(call)) refuse("the read failed, so nothing is known to need no change");
  if (writeFields.publish) refuse("the request asks to publish, which needs the review");
  if (pageExcerpts(readValuesOf(call), writeFields).length > 0) refuse("the values to write change the node, which needs the review");
  return { ok: true, nodeId: readText(call.nodeId).trim(), changes: [], reason: "" };
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
 * argument, `{ input, ports }`. Its operations are `form`, `unchanged` and
 * `read`; any other is refused.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "form") return form(call);
  if (op === "unchanged") return unchanged(call);
  if (op === "read") return read(call, ports);
  throw new Error(`reviewed_change: \`op\` must be form, unchanged or read — got ${JSON.stringify(call.op)}`);
}
