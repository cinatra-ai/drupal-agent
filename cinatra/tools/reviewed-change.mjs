/**
 * THE REVIEWED CHANGE: THE FORM THAT IS FILED, AND THE READ BACK.
 *
 * `op: page` (step `check_read`, right after the model-free read of
 * `drupal_node_read_for_edit`) takes the connector's answer only when it is a
 * read of the run's node with a binding, and hands its plain text values on;
 * see `page`.
 *
 * `op: form` builds the page snapshot a person reviews from the read and the
 * values the compose step answers (`writeFields`: the fields and the publish
 * flag, which this agent refuses: it saves, and never publishes). A value that equals the read is left out: only a field that changes
 * is filed, shown and written, and the filed values, the shown blocks and the
 * values the read-back answers all come from that one result. The changed
 * blocks the display shows (`excerpts`) are derived from those values by
 * `pageExcerpts`, in code: each changed block is shown as its
 * source text, so everything written for it is shown. A change the display
 * cannot show is refused, and nothing is filed: so is any request to publish,
 * and a change whose values, as the JSON text the write step sends, exceed
 * what the connector takes. It also answers
 * `next`: `no_change` when the values change nothing and ask for no publish,
 * so the flow ends the run past the filing and the review; `review`
 * otherwise. What it files passes `checkedSnapshot`, the one check the
 * read-back applies to the approved revision too.
 *
 * Every operation takes the read only when it is a successful read
 * (`checkedRead`); any other read is refused and never ends the run as a
 * change of nothing.
 *
 * `op: unchanged` is the step of that no-change road. It derives the blocks
 * again, refuses unless the values still change nothing and ask for no
 * publish, and answers the run's outcome: the node, no changes, no reason.
 *
 * `op: read`, after the review, reads back the revision the person approved
 * and answers its values. The write step takes the values it writes only from
 * this answer, so it can write nothing the reviewed snapshot did not hold. The
 * read derives the blocks again from those values and the same read, and
 * refuses when the reviewed text shows other blocks, when it would write a
 * field that none of the derived blocks shows (so a field whose value equals
 * the read is never written, though the snapshot names it), and when the
 * revision, as a whole, is not a snapshot of this run's node that the display
 * draws (`checkedSnapshot`).
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
 * - It answers the values as one object of the changed fields
 *   (`reviewedFields`, field name to new value), which a publishing step sends
 *   whole as `fieldsJson`, and the approved revision as a one-item list
 *   (`reviewedSnapshot`), which the publish card shows.
 *
 * `op: outcome` (step `write_outcome`, after the publishing step) reads the
 * connector's answer to the write and answers the branch the flow takes and
 * the run's output; see `outcome`.
 *
 * It refuses by the host's documented means: it throws an error named
 * `ExtensionToolCallRefusal` whose message is one sentence, which starts with
 * its code: `node_read_unavailable` for `page`, `write_answer_unreadable` for
 * `outcome`, `reviewed_change_unavailable` for the others. It writes no port,
 * no table and no artifact.
 */

export const CODE = "reviewed_change_unavailable";
export const PAGE_CODE = "node_read_unavailable";
export const OUTCOME_CODE = "write_answer_unreadable";

/** The type of the page snapshot the flow files. */
const PAGE_TYPE = "@cinatra-ai/website-artifacts:page-snapshot";

/** The one envelope version of the review's answer this module reads. */
const ENVELOPE_VERSION = 1;

/** The ONE name the host reads as a module's refusal of a call. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

/** The host repeats a refusal sentence of at most this many characters. */
const SENTENCE_MAX = 400;

/** How a refusal sentence of each code starts. */
const REFUSAL_START = {
  [CODE]: "nothing was written",
  [PAGE_CODE]: "nothing was proposed or written",
  [OUTCOME_CODE]: "the outcome of the save is not known",
};

function refuseAs(code, cause, next) {
  const line = `${code}: ${REFUSAL_START[code]}, because ${cause}; ${next}.`.replace(/\s+/g, " ").trim();
  const error = new Error(line.length <= SENTENCE_MAX ? line : `${line.slice(0, SENTENCE_MAX - 1).trimEnd()}…`);
  error.name = REFUSAL_NAME;
  throw error;
}

function refuse(cause, next = "start a new run") {
  refuseAs(CODE, cause, next);
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
  if (writeFields.fields.length === 0) {
    refuse("the reviewed revision carries no field to write");
  }
  if (writeFields.publish) refuse("the reviewed revision asks to publish, and this agent never publishes");
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
// the same words, white space aside), a changed block that holds an invisible
// character or changes white space the display cannot draw (see the ONE RULE
// PER CHANGED BLOCK below), and more than 200 changed blocks.
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

/**
 * The top-level pieces of a text, `{ name, source }`, in order; joined, they
 * are the text. A generator: each piece is made only when it is taken.
 */
function* piecesOf(text) {
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
    yield { name, source: text.slice(i, end) };
    i = end;
  }
}

/**
 * The pieces grouped into blocks `{ name, source }`: white space between them
 * joins the block before it (the first block takes white space before it), a
 * run of text and inline elements is one block. Joined, they are the text. A
 * generator: it holds one block at a time and yields it when the next one
 * starts, so no list of blocks is made here.
 */
function* grouped(text) {
  let last = null;
  let lead = "";
  for (const piece of piecesOf(text)) {
    if (piece.source.trim() === "") {
      if (last !== null) last.source += piece.source;
      else lead += piece.source;
      continue;
    }
    const inline = piece.name === "#text" || INLINE_ELEMENTS.has(piece.name);
    if (inline && last?.name === "#inline") {
      last.source += piece.source;
    } else {
      if (last !== null) yield last;
      last = { name: inline ? "#inline" : piece.name, source: lead + piece.source };
    }
    lead = "";
  }
  if (last !== null) yield last;
  if (lead !== "") yield { name: "#inline", source: lead };
}

/**
 * The blocks of one value: `{ kind, level, source }`, in order; their sources
 * joined are the value. `budget`, when given, is `{ left, meter }`, shared by
 * all the values one derivation splits: each block made is counted against
 * `left` as it is made, and the splitting refuses at the first block past it,
 * so no more than `left` + 1 blocks are ever made. `meter.blocks`, when
 * given, counts the blocks made.
 */
export function blocksOf(value, budget) {
  const blocks = [];
  const take = (block) => {
    if (budget !== undefined) {
      if (budget.meter !== undefined) budget.meter.blocks += 1;
      budget.left -= 1;
      if (budget.left < 0) {
        refuse(`the values to compare hold more than ${MAX_BLOCKS} blocks in all, more than the page snapshot form can compare`);
      }
    }
    blocks.push(block);
  };
  for (const block of grouped(value)) {
    const heading = /^h([1-6])$/.exec(block.name);
    if (heading) {
      take({ kind: "heading", level: Number(heading[1]), source: block.source });
      continue;
    }
    if (block.name === "ul" || block.name === "ol") {
      const startAt = block.source.search(/</);
      const openEnd = tagEnd(block.source, startAt);
      const closeAt = block.source.toLowerCase().lastIndexOf(`</${block.name}`);
      const innerEnd = closeAt >= openEnd ? closeAt : block.source.length;
      // Each item is taken when the next one is found: the first with the
      // list's opening tag, the last with its closing tag.
      let held = null;
      for (const item of grouped(block.source.slice(openEnd, innerEnd))) {
        if (held === null) {
          held = { kind: "list-item", level: null, source: block.source.slice(0, openEnd) + item.source };
          continue;
        }
        take(held);
        held = { kind: "list-item", level: null, source: item.source };
      }
      if (held !== null) {
        held.source += block.source.slice(innerEnd);
        take(held);
        continue;
      }
    }
    take({ kind: "paragraph", level: null, source: block.source });
  }
  return blocks;
}

/**
 * The most characters, in all, of the values the derivation compares: the read
 * value and the value to write of each field that changes. It is far above any
 * page a person reviews block by block, and it bounds the work of splitting
 * the values into blocks.
 */
const MAX_TEXT = 4_000_000;

/**
 * The most blocks, in all, of the values the derivation compares, on both
 * sides: it bounds the memory of the block lists and of the numbers that stand
 * for them. The splitting counts each block as it makes it and refuses at the
 * first block past this limit, so it never makes more than one block past it.
 */
const MAX_BLOCKS = 40_000;

/**
 * The most cells of one comparison table, which covers only the blocks between
 * the unchanged blocks at the start and at the end of a value. 4,000,000 cells
 * of 4 bytes are 16 MB, and admit for example a part of 2,000 blocks on each
 * side: ten times the 200 changed blocks the display can show, so a change the
 * display can show is refused only when its first and last changed block are
 * more than about 2,000 blocks apart.
 */
const MAX_TABLE_CELLS = 4_000_000;

/**
 * The two block lists aligned by their longest common run of unchanged blocks.
 * Each step is `{ same: true }`, or a change `{ old, next }` where a removed
 * block has no `next` and an added one no `old`; the removed and added blocks
 * between two unchanged ones are paired in order. A step's index is the
 * position the display draws.
 *
 * Each block is compared by a number that stands for its source, so one
 * comparison costs the same for any block. The unchanged blocks at the start
 * and at the end are matched first, in linear time; only the part between them
 * is compared in a table, whose size is checked against MAX_TABLE_CELLS before
 * the table is made. `meter`, when given, counts the cells of the table made.
 */
export function alignedBlocks(region, was, will, meter) {
  const numbers = new Map();
  const numberOf = (block) => {
    let number = numbers.get(block.source);
    if (number === undefined) {
      number = numbers.size;
      numbers.set(block.source, number);
    }
    return number;
  };
  const a = was.map(numberOf);
  const b = will.map(numberOf);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start;
  const m = endB - start;
  const cols = m + 1;
  const cells = (n + 1) * cols;
  if (cells > MAX_TABLE_CELLS) {
    refuse(`the changed part of ${region} spans ${n} blocks of the read and ${m} blocks of the value to write, more blocks than the page snapshot form can compare`);
  }
  const common = new Uint32Array(cells);
  if (meter !== undefined) meter.cells += cells;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      common[i * cols + j] = a[start + i] === b[start + j]
        ? common[(i + 1) * cols + j + 1] + 1
        : Math.max(common[(i + 1) * cols + j], common[i * cols + j + 1]);
    }
  }
  const steps = [];
  for (let k = 0; k < start; k += 1) steps.push({ same: true });
  let removed = [];
  let added = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) steps.push({ old: removed[k], next: added[k] });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush();
      steps.push({ same: true });
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && common[(i + 1) * cols + j] >= common[i * cols + j + 1])) {
      removed.push(was[start + i]);
      i += 1;
    } else {
      added.push(will[start + j]);
      j += 1;
    }
  }
  flush();
  for (let k = endA; k < a.length; k += 1) steps.push({ same: true });
  return steps;
}

const sameWords = (a, b) => a.trim().split(/\s+/).join(" ") === b.trim().split(/\s+/).join(" ");

// ---------------------------------------------------------------------------
// INVISIBLE CHARACTERS AND WHITE SPACE: ONE RULE PER CHANGED BLOCK.
//
// The display draws each changed block as plain text: its source, markup
// included, with a run of white space drawn as one space. So what it cannot
// show must not change. The rule works on each changed block (the unit the
// review shows), byte for byte, with no exception and no normalisation:
//
// 1. A changed block that holds an invisible character, in its read text or in
//    its new text, is refused: the agent does not change such a block, and a
//    person changes it on the site. An invisible character is any character of
//    the Unicode classes Cf, Cc (except tab, line feed and carriage return),
//    Zs (except U+0020, so U+00A0 is one), Zl, Zp, Default_Ignorable_Code_Point
//    and Variation_Selector.
// 2. The changed part of a block is what lies between its unchanged start and
//    its unchanged end, both byte for byte equal, widened so that no run of
//    white space is cut. In it, on both sides, white space may only be a single
//    U+0020 between two visible characters: that is exactly what the display
//    draws. Any other white space there (a tab, a line break, two spaces, a
//    space at the edge of the block) is refused.
// 3. A block whose sides differ only in white space stays refused, as the
//    display's parser rejects it.
// ---------------------------------------------------------------------------

const INVISIBLE = /(?![\t\n\r ])[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/u;
const SPACE = /\s/;

const codePointName = (text) => `U+${text.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;

/** Whether `text` holds, from `from` to `to`, white space other than one U+0020 between two visible characters. */
function otherSpace(text, from, to) {
  for (let i = from; i < to; i += 1) {
    if (!SPACE.test(text[i])) continue;
    if (text[i] !== " " || i === 0 || i === text.length - 1 || SPACE.test(text[i - 1]) || SPACE.test(text[i + 1])) return true;
  }
  return false;
}

/** Refuses a changed block (`published` against `proposed`) that breaks the rule above. */
export function checkedBlock(region, position, published, proposed) {
  const name = `the changed block ${position + 1} of the ${region}`;
  for (const side of [published, proposed]) {
    const found = INVISIBLE.exec(side);
    if (found !== null) {
      refuse(
        `${name} holds the invisible character ${codePointName(side.slice(found.index))}, which the page snapshot cannot show, and the agent does not change a block that holds one`,
        "make that change on the site",
      );
    }
  }
  let start = 0;
  const shorter = Math.min(published.length, proposed.length);
  while (start < shorter && published[start] === proposed[start]) start += 1;
  let end = 0;
  while (end < shorter - start && published[published.length - 1 - end] === proposed[proposed.length - 1 - end]) end += 1;
  while (start > 0 && SPACE.test(published[start - 1])) start -= 1;
  while (end > 0 && SPACE.test(published[published.length - end])) end -= 1;
  if (otherSpace(published, start, published.length - end) || otherSpace(proposed, start, proposed.length - end)) {
    refuse(
      `${name} changes white space other than one plain space between visible characters, which the page snapshot cannot show as it is`,
      "start a new run whose change keeps that white space as it is, or make that change on the site",
    );
  }
}

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
 * in the read's order: title, body, then the `field_` values. The total text
 * is checked first, then the values are split, each block counted against
 * MAX_BLOCKS as it is made, and each changed block is checked by
 * `checkedBlock`. `meter.blocks`, when given, counts the blocks made.
 */
export function pageExcerpts(read, writeFields, meter) {
  const values = read instanceof Map
    ? read
    : readValuesOf({ title: read.title, body: read.body, fieldValues: JSON.stringify(read.fieldValues ?? []) });
  const toWrite = new Map();
  for (const item of writeFields.fields) {
    if (!values.has(item.field)) refuse(`the field ${item.field} is not a field the read returned`);
    toWrite.set(item.field, item.value);
  }
  const compared = [];
  let characters = 0;
  for (const [region, before] of values) {
    if (!toWrite.has(region) || toWrite.get(region) === before) continue;
    const after = toWrite.get(region);
    characters += before.length + after.length;
    compared.push({ region, before, after });
  }
  if (characters > MAX_TEXT) {
    refuse(`the values to compare hold more than ${MAX_TEXT} characters in all, more than the page snapshot form can compare`);
  }
  const budget = { left: MAX_BLOCKS, meter };
  for (const item of compared) {
    if (item.region === "title") continue;
    item.was = blocksOf(item.before, budget);
    item.will = blocksOf(item.after, budget);
  }
  const excerpts = [];
  for (const { region, before, after, was, will } of compared) {
    if (region === "title") {
      if (sameWords(before, after)) refuse("the title changes only in white space, which the page snapshot cannot show");
      checkedBlock(region, 0, before, after);
      excerpts.push({ region, position: 0, kind: "heading", level: 1, published: before, proposed: after });
      continue;
    }
    alignedBlocks(region, was, will).forEach((step, position) => {
      if (step.same) return;
      const { old, next } = step;
      const published = old ? old.source : "";
      const proposed = next ? next.source : "";
      if (sameWords(published, proposed)) {
        refuse(`a block of ${region} changes only in white space, which the page snapshot cannot show`);
      }
      checkedBlock(region, position, published, proposed);
      const shape = next ?? old;
      excerpts.push({ region, position, kind: shape.kind, level: shape.level, published, proposed });
    });
  }
  if (excerpts.length > MAX_EXCERPTS) refuse(`the change has more than ${MAX_EXCERPTS} blocks, more than the page snapshot can show`);
  return excerpts;
}

/** The statuses a successful read answers (the read step's `nodeStatus`). */
const READ_STATUSES = new Set(["published", "draft"]);

/**
 * THE READ, accepted only when it is a successful read. A successful read
 * always carries: an error object whose `code` and `message` are both the
 * empty text (what `page` answers for a read it accepts), a status of
 * `published` or `draft`, a non-empty title and a list of `field_` text
 * values, for a non-empty node id of the run. Anything
 * else is a failed read, whatever its shape: `{}`, `{ message }`, `null`, a
 * text, a missing input and each flow default that stands in for one. A failed
 * read is refused with its own message when it has one, else with a fixed one;
 * it never leads to a filing or to the no-change outcome.
 */
function checkedRead(call) {
  const error = parseJson(readText(call.error));
  if (!isPlainObject(error) || error.code !== "" || error.message !== "") {
    const message = isPlainObject(error) && typeof error.message === "string" ? error.message.trim() : "";
    refuse(message !== "" ? `the read of the node failed: ${message}` : "no successful read of the node was handed to this step");
  }
  const nodeId = readText(call.nodeId).trim();
  if (nodeId === "") refuse("no node id was handed to this step");
  const status = readText(call.nodeStatus).trim();
  if (!READ_STATUSES.has(status)) refuse("the read answered no status of published or draft, so it was not a successful read");
  const values = readValuesOf(call);
  if (values.get("title").trim() === "") refuse("the read answered no title, so it was not a successful read");
  return { nodeId, status, values, address: readText(call.address).trim() };
}

/** The page record the snapshot files: the node of this run's read, as the display's top shows it. */
function pageOf(read) {
  const address = read.address === "" ? null : read.address;
  return {
    nodeId: read.nodeId,
    status: read.status,
    title: read.values.get("title"),
    address,
    cmsAddress: address === null ? null : `${address}/edit`,
  };
}

// ---------------------------------------------------------------------------
// THE ONE CHECK OF A PAGE SNAPSHOT, used by `op: form` on what it files and by
// `op: read` on the approved revision.
//
// `displayReading` restates the rules by which the display's parser accepts a
// snapshot (cinatra-ai/website-artifacts, src/cms-page-model.ts, parseCmsPage):
// the marker and its version, at least one excerpt and at most 200, a system it
// knows, a page record with a text title, and each excerpt with a region, a
// whole position of 0 or more, a kind it draws, two text sides that do not hold
// the same words, a heading level of 1 to 6 (2 when absent), and positions that
// rise between consecutive excerpts of one region. It answers the parser's
// reason. `checkedSnapshot` adds what this pack files: the Drupal system, each
// excerpt with exactly the keys and the level form `pageExcerpts` builds, and a
// page record equal, key by key, to the one built from this run's read.
// ---------------------------------------------------------------------------

const DISPLAY_SYSTEMS = ["wordpress", "drupal"];
const DISPLAY_KINDS = ["heading", "paragraph", "list-item"];
const EXCERPT_KEYS = ["kind", "level", "position", "proposed", "published", "region"];
const PAGE_PARTS = [
  ["nodeId", "node id"],
  ["status", "status"],
  ["title", "title"],
  ["address", "address"],
  ["cmsAddress", "edit address"],
];

/** Whether the display's parser accepts one excerpt. */
function displayDrawsExcerpt(value) {
  if (!isPlainObject(value)) return false;
  const { region, position, kind, level, published, proposed } = value;
  if (typeof region !== "string" || region.length === 0) return false;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) return false;
  if (typeof kind !== "string" || !DISPLAY_KINDS.includes(kind)) return false;
  if (typeof published !== "string" || typeof proposed !== "string") return false;
  if (sameWords(published, proposed)) return false;
  if (kind === "heading" && level !== undefined && !(typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6)) {
    return false;
  }
  return true;
}

/** The display parser's answer for a snapshot: `{ ok: true }` or `{ ok: false, reason }`, with its reasons. */
export function displayReading(form) {
  if (!isPlainObject(form) || !Object.prototype.hasOwnProperty.call(form, "cinatraCmsPage")) return { ok: false, reason: "not-the-form" };
  if (form.cinatraCmsPage !== 1) return { ok: false, reason: "form-version" };
  const { excerpts, system, page } = form;
  if (excerpts === undefined || (Array.isArray(excerpts) && excerpts.length === 0)) return { ok: false, reason: "no-excerpts" };
  if (typeof system !== "string" || !DISPLAY_SYSTEMS.includes(system)) return { ok: false, reason: "malformed" };
  if (!isPlainObject(page) || typeof page.title !== "string") return { ok: false, reason: "malformed" };
  if (!Array.isArray(excerpts) || excerpts.length > MAX_EXCERPTS) return { ok: false, reason: "malformed" };
  let previous;
  for (const excerpt of excerpts) {
    if (!displayDrawsExcerpt(excerpt)) return { ok: false, reason: "malformed" };
    if (previous !== undefined && previous.region === excerpt.region && excerpt.position <= previous.position) {
      return { ok: false, reason: "malformed" };
    }
    previous = excerpt;
  }
  return { ok: true };
}

/** THE ONE CHECK: refuses, naming the part that differs, unless the snapshot is one the display draws of this node. */
export function checkedSnapshot(form, page) {
  if (isPlainObject(form) && !isPlainObject(form.page)) refuse("the page snapshot carries no page record");
  const reading = displayReading(form);
  if (!reading.ok) refuse(`the page snapshot is not one the page display draws (${reading.reason})`);
  if (form.system !== "drupal") refuse("the page snapshot is not a Drupal page snapshot");
  const keys = Object.keys(form.page).sort();
  if (JSON.stringify(keys) !== JSON.stringify(PAGE_PARTS.map(([key]) => key).sort())) {
    refuse("the page record of the page snapshot holds other keys than the node id, status, title, address and edit address");
  }
  for (const [key, name] of PAGE_PARTS) {
    if (form.page[key] !== page[key]) refuse(`the page record of the page snapshot names another ${name} than this run's read of the node`);
  }
  for (const excerpt of form.excerpts) {
    if (JSON.stringify(Object.keys(excerpt).sort()) !== JSON.stringify(EXCERPT_KEYS)) {
      refuse("a changed block of the page snapshot holds other keys than the ones the page snapshot form builds");
    }
    const levelOk = excerpt.kind === "heading" ? Number.isInteger(excerpt.level) : excerpt.level === null;
    if (!levelOk) refuse("a changed block of the page snapshot has a level that is not the form the page snapshot builds");
  }
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

/**
 * The values to write with every value that equals the read left out: only a
 * field that changes is filed, shown and written. A field the read did not
 * return is refused.
 */
function changedOf(values, writeFields) {
  for (const item of writeFields.fields) {
    if (!values.has(item.field)) refuse(`the field ${item.field} is not a field the read returned`);
  }
  return { fields: writeFields.fields.filter((item) => item.value !== values.get(item.field)), publish: writeFields.publish };
}

/** `op: form` — the page snapshot to file, built from the read and the values to write, and the road it takes. */
function form(call) {
  const writeFields = checkedWriteFields(parseJson(readText(call.writeFields)));
  const read = checkedRead(call);
  const changed = changedOf(read.values, writeFields);
  if (changed.publish) {
    // This agent saves a change and never publishes: a published page gets a
    // draft revision of the same node and an unpublished page stays
    // unpublished. The page display draws only changed text blocks and no node
    // status, so a person could not see a publish in the review either.
    refuse(
      "the request asks to publish, and this agent never publishes: it saves the change as a draft revision of a published page, or saves an unpublished page without publishing it",
      "publish the page on the site, or start a new run that asks for the change alone",
    );
  }
  const excerpts = pageExcerpts(read.values, changed);
  if (changed.fields.length === 0) {
    return { ok: true, next: "no_change", pageForm: {} };
  }
  checkedSendSize(changed.fields);
  const page = pageOf(read);
  const pageForm = { cinatraCmsPage: 1, system: "drupal", page, writeFields: changed, excerpts };
  checkedSnapshot(pageForm, page);
  return { ok: true, next: "review", pageForm };
}

/** The most characters of the request the no-change reason repeats. */
export const REQUEST_MAX = 300;

/** The most characters of the node's title the no-change reason repeats. */
const TITLE_MAX = 120;

/** Text on one line, cut to `max` characters with an ellipsis. */
function oneLine(text, max) {
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * `op: unchanged` — the outcome of a change that changes nothing: the node, no
 * changes, and a reason built here, never by the model. The compose step's
 * answer is the same for a request that needs no change and for a request it
 * dropped, and no code can tell the two apart (whether the request asked to
 * publish is known only through that same answer). So the run ends completed,
 * and the reason tells the person that nothing was proposed, reviewed or
 * written for their request, and repeats the request so they can see it.
 */
function unchanged(call) {
  const writeFields = checkedWriteFields(parseJson(readText(call.writeFields)));
  const read = checkedRead(call);
  if (writeFields.publish) refuse("the request asks to publish, which needs the review");
  if (changedOf(read.values, writeFields).fields.length > 0) refuse("the values to write change the node, which needs the review");
  const title = oneLine(read.values.get("title"), TITLE_MAX);
  const request = oneLine(readText(call.instructions), REQUEST_MAX);
  const lead = `No change was proposed for this request on node ${oneLine(read.nodeId, 40)} ("${title}"), so nothing was reviewed or written`;
  const reason = request === "" ? `${lead}; the request was empty.` : `${lead}: ${request}`;
  return { ok: true, nodeId: read.nodeId, changes: [], reason };
}

const excerptKey = (list) =>
  JSON.stringify(
    list.map((e) => (isPlainObject(e) ? [e.region, e.position, e.kind, e.kind === "heading" ? e.level : null, e.published, e.proposed] : e)),
  );

async function read(call, ports) {
  const artifactId = readText(call.artifactId).trim();
  if (artifactId === "") refuse("the run filed no page snapshot");
  const readNode = checkedRead(call);
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
  checkedSnapshot(parseJson(result.text), pageOf(readNode));
  const derived = pageExcerpts(readNode.values, values);
  const regions = new Set(derived.map((e) => e.region));
  for (const item of values.fields) {
    if (!regions.has(item.field)) refuse(`the reviewed revision would write the field ${item.field}, which its shown blocks do not show`);
  }
  if (excerptKey(values.shown) !== excerptKey(derived)) {
    refuse("the reviewed revision shows other words than the values it would write");
  }
  checkedSendSize(values.fields);
  return {
    ok: true,
    reviewedFields: fieldsObject(values.fields),
    reviewedRevisionId: revisionId,
    reviewedSnapshot: [{ artifactId, representationRevisionId: revisionId }],
  };
}

// ---------------------------------------------------------------------------
// WHAT THE PUBLISHING STEP SENDS.
//
// A publishing step sends the reviewed values whole as `fieldsJson`, the JSON
// text of one object (field name to new value), rendered by the flow's
// `tojson` (`tojsonText` below), and the binding as the text of the read's
// binding. The connector takes each such text of at most 256 KiB in UTF-8
// (drupal-mcp-connector JSON_ARGUMENT_MAX_BYTES) and refuses a longer one. So
// a change whose text would be longer is refused before it is filed and again
// at the read-back, and a binding whose text would be longer is refused at the
// check of the read, before anything is proposed; nothing is sent.
// ---------------------------------------------------------------------------

/** The most bytes of a JSON text argument the connector takes. */
export const SEND_MAX_BYTES = 256 * 1024;

/** The values to write as the one object the publishing step sends. */
function fieldsObject(fields) {
  return Object.fromEntries(fields.map((item) => [item.field, item.value]));
}

/** Python's json.dumps escape of one string, ASCII output (`ensure_ascii`), as `tojson` writes it. */
function pythonJsonString(text) {
  const SHORT = { 0x22: '\\"', 0x5c: "\\\\", 0x08: "\\b", 0x0c: "\\f", 0x0a: "\\n", 0x0d: "\\r", 0x09: "\\t" };
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (SHORT[unit] !== undefined) out += SHORT[unit];
    else if (unit >= 0x20 && unit <= 0x7e) out += text[i];
    // Every other UTF-16 unit, so each half of a character outside the BMP,
    // becomes \u and four lower-case hex digits.
    else out += `\\u${unit.toString(16).padStart(4, "0")}`;
  }
  return `${out}"`;
}

/** Python's repr of a number as json.dumps writes it. */
function pythonJsonNumber(value) {
  if (!Number.isFinite(value)) refuse("a value to send is not a finite number", "start a new run");
  // A whole number arrives as a Python int; JSON text read here cannot tell
  // 1.0 from 1, so a whole number is written as an int.
  if (Number.isInteger(value)) return BigInt(value).toString();
  const [mantissa, exponentText] = value.toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent >= -4 && exponent < 16) return String(value);
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/**
 * THE TEXT A `{{ value | tojson }}` ARGUMENT RENDERS TO in the flow runtime
 * (wayflowcore 26.1.2: an ApiNode's data is rendered by
 * `render_str_template`, `_utils/_templating_helpers.py:482-492`, which sets
 * `json.dumps_kwargs` to `{"sort_keys": False}`; Jinja 3.1 `do_tojson` calls
 * `htmlsafe_json_dumps`, `jinja2/utils.py:637-673`). So: Python's
 * `json.dumps` with its defaults (separators ", " and ": ", `ensure_ascii`,
 * keys in the order the value holds them), then each < > & ' written as
 * \u003c, \u003e, \u0026 and \u0027. The pre-checks and the tests both
 * render with this one function.
 */
export function tojsonText(value) {
  const dumps = (v) => {
    if (v === null) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "string") return pythonJsonString(v);
    if (typeof v === "number") return pythonJsonNumber(v);
    if (Array.isArray(v)) return `[${v.map(dumps).join(", ")}]`;
    if (isPlainObject(v)) return `{${Object.entries(v).map(([k, item]) => `${pythonJsonString(k)}: ${dumps(item)}`).join(", ")}}`;
    return refuse("a value to send is not JSON", "start a new run");
  };
  return dumps(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/'/g, "\\u0027");
}

/** The UTF-8 bytes of the text `tojson` renders for `value`: the size the connector measures. */
export function sentBytes(value) {
  return new TextEncoder().encode(tojsonText(value)).length;
}

/** Refuses values whose JSON text, as the publishing step sends it, is longer than the connector takes. */
function checkedSendSize(fields) {
  const bytes = sentBytes(fieldsObject(fields));
  if (bytes > SEND_MAX_BYTES) {
    refuse(
      `the values to write, as the JSON text the write sends, take ${bytes} bytes, more than the ${SEND_MAX_BYTES} bytes the Drupal connector takes`,
      "start a new run with a smaller change, or make that change on the site",
    );
  }
}

// ---------------------------------------------------------------------------
// page: THE CHECK OF THE CONNECTOR'S READ.
// ---------------------------------------------------------------------------

/** A value the flow renders with `tojson`, read back; the value itself when it is not JSON text. */
function jsonValue(value) {
  if (typeof value !== "string") return value;
  const parsed = parseJson(value);
  return parsed === undefined ? value : parsed;
}

/** The form of a language code the connector answers. */
const LANGUAGE_FORM = /^[a-zA-Z0-9_-]+$/;

/**
 * THE CHECK OF THE READ (step `check_read`, right after the model-free read of
 * `drupal_node_read_for_edit`). It takes the connector's answer only when it
 * is a read of the run's node on the run's instance: the answered `nodeId`
 * equals the run's node id (a whole number) and `nid` is that number, the
 * answered `instanceId` equals the run's, `published` is a boolean, `language`
 * is a language code, `fields` is an object with a non-empty text `title`, and
 * `binding` is a non-empty object. The binding is checked only as that: its
 * members belong to the connector and the Cinatra module, and the flow passes
 * it on to the write unchanged, by its own edge from the read.
 *
 * It hands on, under the names the later steps read: the status (`published`
 * or `draft`), the title, the body (empty when the read has no text body), the
 * `field_` values that are texts (other values are not offered for a change),
 * an empty address (the read names no public address) and an empty error.
 * Anything else is refused: the run fails before the model step, and nothing
 * is proposed, filed or written. The connector's text is never repeated.
 */
function page(call) {
  const no = (cause) => refuseAs(PAGE_CODE, cause, "start a new run");
  const nodeId = readText(call.nodeId).trim();
  if (!/^[1-9][0-9]*$/.test(nodeId)) no("the run names no node id that is a whole number");
  if (jsonValue(call.readNodeId) !== nodeId || jsonValue(call.nid) !== Number(nodeId)) {
    no("the read answered another node than the run's node");
  }
  const instanceId = readText(call.instanceId).trim();
  if (instanceId === "" || jsonValue(call.readInstanceId) !== instanceId) {
    no("the read answered another Drupal instance than the run's instance");
  }
  const published = jsonValue(call.published);
  if (typeof published !== "boolean") no("the read answered no published state");
  const language = jsonValue(call.language);
  if (typeof language !== "string" || !LANGUAGE_FORM.test(language)) no("the read answered no language");
  const fields = jsonValue(call.fields);
  if (!isPlainObject(fields)) no("the read answered no field values");
  if (typeof fields.title !== "string" || fields.title.trim() === "") no("the read answered no title");
  const binding = jsonValue(call.binding);
  if (!isPlainObject(binding) || Object.keys(binding).length === 0) {
    no("the read answered no binding, which the write needs to save only an unchanged page");
  }
  const bindingBytes = sentBytes(binding);
  if (bindingBytes > SEND_MAX_BYTES) {
    no(`the read's binding, as the JSON text the write sends, takes ${bindingBytes} bytes, more than the ${SEND_MAX_BYTES} bytes the Drupal connector takes`);
  }
  const fieldValues = Object.entries(fields)
    .filter(([name, value]) => name.startsWith("field_") && typeof value === "string")
    .map(([field, value]) => ({ field, value }));
  return {
    ok: true,
    nodeId,
    instanceId,
    status: published ? "published" : "draft",
    title: fields.title,
    body: typeof fields.body === "string" ? fields.body : "",
    fieldValues,
    address: "",
    error: { code: "", message: "" },
  };
}

// ---------------------------------------------------------------------------
// outcome: THE CONNECTOR'S ANSWER TO THE WRITE.
// ---------------------------------------------------------------------------

/**
 * The refusal codes of a bound write other than `node_changed`
 * (drupal-mcp-connector, src/integration/edit-binding.ts, REFUSAL), each with
 * the plain message the run ends with. After each of them but
 * `write_unverified` nothing was written.
 */
export const WRITE_REFUSALS = {
  pending_revision:
    "Nothing was written: the page has a newer revision that waits for review on the site. Publish or discard that revision on the site, then start a new run.",
  permission_denied:
    "Nothing was written: the site or Cinatra does not permit this edit for the connected account or for you. Check the permissions, then start a new run.",
  invalid_input:
    "Nothing was written: the site refused the field values or the request. Check the fields on the site, or start a new run with another change.",
  refused: "Nothing was written: the site refused the save. Start a new run; if it is refused again, make the change on the site.",
  write_unverified:
    "The save was sent, but its result could not be verified: a change may have been saved. Check the page on the site before trying again.",
  invalid_binding:
    "Nothing was written: the read the review was based on does not fit this site or page any more, for example because the Drupal connection was changed. Start a new run.",
  wrong_page_state: "Nothing was written: the page's published state does not fit the save this run chose. Start a new run.",
  module_capability_missing:
    "Nothing was written: the site does not offer the Cinatra Drupal module tools that save only an unchanged page. Update the module on the site and expose its tools, then start a new run.",
  read_unavailable: "Nothing was written: the page could not be read on the site before the save. Start a new run later.",
};

/** The text of one stored field as the write answers it: the value of a single item, else the items as JSON text. */
function storedText(items) {
  if (Array.isArray(items) && items.length === 1 && isPlainObject(items[0]) && typeof items[0].value === "string") return items[0].value;
  return JSON.stringify(items);
}

/**
 * THE OUTCOME OF THE WRITE (step `write_outcome`, right after the publishing
 * step that ran). It reads the connector's answer and answers `next`, the
 * branch the flow takes, with the run's output, all built here, never by a
 * model:
 *
 * - `written` for an answer with `applied` exactly true, the run's node id, a
 *   revision id and a stored value of each reviewed field. `changes` names each
 *   reviewed field with its value as read before and the value the site stored
 *   after; `reason` is empty.
 * - `node_changed` (an answer with `ok` exactly false and that code): nothing
 *   was written, because the page changed on the site after the read. The flow
 *   goes back to the read; `reviewNotice` tells the person on the next review
 *   that the change was proposed again against the current page.
 * - each other refusal code (`WRITE_REFUSALS`, an answer with `ok` exactly
 *   false): the run ends completed with `error` and its plain message as
 *   `reason`.
 *
 * Any other answer, and no answer at all, is refused
 * (`write_answer_unreadable`): the run fails and tells the person to check the
 * page on the site, because the save's outcome is not known. The connector's
 * own text is never repeated.
 */
function outcome(call) {
  const no = (cause) => refuseAs(OUTCOME_CODE, cause, "check the page on the site before a new run");
  const nodeId = readText(call.nodeId).trim();
  const base = { ok: true, nodeId, changes: [], reason: "", error: {}, reviewNotice: "" };
  const okAnswer = jsonValue(call.ok);
  const code = jsonValue(call.code);
  const applied = jsonValue(call.applied);
  if (okAnswer === false && applied !== true) {
    if (code === "node_changed") {
      return {
        ...base,
        next: "node_changed",
        reviewNotice:
          "Nothing was written: the page changed on the site after it was read. " +
          "The change was proposed again against the current page; review it again.",
      };
    }
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(WRITE_REFUSALS, code)) {
      const message = WRITE_REFUSALS[code];
      return { ...base, next: code, reason: message, error: { code, message } };
    }
  }
  if (applied !== true || okAnswer === false) no("the answer is neither a save nor a refusal this agent knows");
  if (!/^[1-9][0-9]*$/.test(nodeId) || jsonValue(call.answerNodeId) !== nodeId) no("the answer names another node than the run's node");
  const revisionId = jsonValue(call.revisionId);
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0) no("the answer names no saved revision");
  const stored = jsonValue(call.storedFields);
  const reviewed = jsonValue(call.reviewedFields);
  if (!isPlainObject(stored) || !isPlainObject(reviewed) || Object.keys(reviewed).length === 0) {
    no("the answer or the run carries no fields of the save");
  }
  const read = readValuesOf(call);
  const changes = [];
  for (const [field, value] of Object.entries(reviewed)) {
    if (typeof value !== "string" || !read.has(field)) no("the run's reviewed values are not fields of the read");
    if (!Object.prototype.hasOwnProperty.call(stored, field)) no(`the answer carries no stored value of the field ${field}`);
    changes.push({ field, before: read.get(field), after: storedText(stored[field]) });
  }
  return { ...base, next: "written", changes };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Its operations are `page`, `form`,
 * `unchanged`, `read` and `outcome`; any other is refused.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "page") return page(call);
  if (op === "form") return form(call);
  if (op === "unchanged") return unchanged(call);
  if (op === "read") return read(call, ports);
  if (op === "outcome") return outcome(call);
  throw new Error(`reviewed_change: \`op\` must be page, form, unchanged, read or outcome — got ${JSON.stringify(call.op)}`);
}
