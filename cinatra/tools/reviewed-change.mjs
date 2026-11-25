/**
 * THE REVIEWED CHANGE: THE FORM THAT IS FILED, AND THE READ BACK.
 *
 * `op: form` builds the page snapshot a person reviews from the read and the
 * values the compose step answers (`writeFields`: the fields and the publish
 * flag). A value that equals the read is left out: only a field that changes
 * is filed, shown and written, and the filed values, the shown blocks and the
 * values the read-back answers all come from that one result. The changed
 * blocks the display shows (`excerpts`) are derived from those values by
 * `pageExcerpts`, in code: each changed block is shown as its
 * source text, so everything written for it is shown. A change the display
 * cannot show is refused, and nothing is filed: so is a publish with no
 * change of text, for which the display has nothing to draw. It also answers
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

function refuse(cause, next = "start a new run") {
  const line = `${CODE}: nothing was written, because ${cause}; ${next}.`.replace(/\s+/g, " ").trim();
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
  if (writeFields.fields.length === 0) {
    refuse("the reviewed revision carries no field to write");
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
// the same words, white space aside), a change that adds, removes or moves an
// invisible character (see INVISIBLE CHARACTERS below), and more than 200
// changed blocks. The display draws a run of white space inside a shown
// block as one space, so the exact white space of a shown block is not
// distinguishable; markup and words are.
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
// INVISIBLE CHARACTERS.
//
// The display draws the shown blocks as plain text, so a character that draws
// nothing, or that changes the direction of the text around it, cannot be
// seen by the person who reviews the change. Such a character is called
// invisible here:
// - a format character (Unicode category Cf): the zero-width space, non-joiner
//   and joiner, the word joiner, U+FEFF, the soft hyphen, the direction marks
//   and the direction embeddings, overrides and isolates, and the tag
//   characters;
// - a control character (Cc) other than tab, line feed and carriage return;
// - a space (Zs) other than U+0020 and U+00A0, and the line and paragraph
//   separators (Zl, Zp): a thin, hair or narrow space can join or split words
//   unseen, and the display draws a separator as a space;
// - any other character Unicode marks as default ignorable, which draws
//   nothing in normal text (for example U+034F or the Hangul fillers), except
//   the variation selectors U+FE00 to U+FE0F, which only choose the look of
//   the visible character before them (an emoji or a text form).
//
// U+00A0, the no-break space, is taken as a space and kept as it is: the
// display draws it as a space of full width, which is what it is; it changes
// no word and no direction; pages often hold it; and a block whose only change
// is a space to U+00A0 is refused already, as a change of white space alone.
//
// THE RULE: a change may not add, remove or move an invisible character. It
// is computed on the difference between the read value and the value to
// write, so a page that already holds such characters can still be edited.
// The visible text of the two values (each value without its invisible
// characters) is matched from the start and from the end. In the unchanged
// visible text at the start and at the end, every run of invisible characters
// must stand where it stood. In the changed part between them, each run of
// invisible characters must stand between the same two visible characters on
// both sides, as often: a run is kept where an edit leaves its visible
// neighbours alone, and is added, removed or moved otherwise. So removing a
// joiner from an emoji sequence, or replacing the sequence, is refused: it
// removes a joiner, and changes what is drawn in a way the plain text does not
// show. A change that breaks the rule is refused before anything is filed,
// with the first such character named by its code point.
// ---------------------------------------------------------------------------

const INVISIBLE_CLASS = String.raw`(?![\t\n\r \u00A0\uFE00-\uFE0F])[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]`;
const INVISIBLE_ONE = new RegExp(`^${INVISIBLE_CLASS}$`, "u");
const INVISIBLE_RUN = new RegExp(`(?:${INVISIBLE_CLASS})+`, "uy");
const INVISIBLE_ANY = new RegExp(INVISIBLE_CLASS, "u");

/**
 * The most invisible characters the changed part of one value may hold, on
 * both sides together: it bounds the memory of the check. A page holds a few.
 */
const MAX_INVISIBLE = 10_000;

const isHigh = (unit) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit) => unit >= 0xdc00 && unit <= 0xdfff;
const codePointName = (text) => `U+${text.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;

/** The width, in code units, of the character that starts at `i`. */
const widthAt = (text, i) => (isHigh(text.charCodeAt(i)) && isLow(text.charCodeAt(i + 1)) ? 2 : 1);

/** The width, in code units, of the character that ends at `k`. */
const widthBefore = (text, k) => (k >= 2 && isLow(text.charCodeAt(k - 1)) && isHigh(text.charCodeAt(k - 2)) ? 2 : 1);

/** The index after the run of invisible characters that starts at `i` (`i` when there is none). */
function runEnd(text, i) {
  INVISIBLE_RUN.lastIndex = i;
  const match = INVISIBLE_RUN.exec(text);
  return match === null ? i : i + match[0].length;
}

/** The index where the run of invisible characters that ends at `k` starts (`k` when there is none). */
function runStart(text, k) {
  let at = k;
  while (at > 0) {
    const width = widthBefore(text, at);
    if (!INVISIBLE_ONE.test(text.slice(at - width, at))) break;
    at -= width;
  }
  return at;
}

function refuseInvisible(verb, ch, region) {
  refuse(
    `the change ${verb} an invisible character ${codePointName(ch)} in the ${region}, which the page snapshot cannot show`,
    verb === "adds" ? "start a new run whose change does not add it" : "start a new run whose change keeps it where it is, or make that change on the site",
  );
}

/** Refuses when two runs of invisible characters at one unchanged place differ: names the first character that differs. */
function sameRun(region, was, will) {
  if (was === will) return;
  let i = 0;
  while (i < was.length && i < will.length && was.codePointAt(i) === will.codePointAt(i)) i += widthAt(was, i);
  if (i < will.length) refuseInvisible("adds", will.slice(i), region);
  refuseInvisible("removes", was.slice(i), region);
}

/**
 * The runs of invisible characters of `text` from `from` to `to`, each counted
 * by `sign` in `counts` under a key made of the visible character before it,
 * the run and the visible character after it.
 */
function countRuns(text, from, to, sign, counts, state) {
  let i = from;
  while (i < to) {
    const end = runEnd(text, i);
    if (end === i) {
      i += widthAt(text, i);
      continue;
    }
    state.characters += end - i;
    if (state.characters > MAX_INVISIBLE) {
      refuse(`the changed part of the ${state.region} holds more than ${MAX_INVISIBLE} invisible characters, more than the page snapshot form can check`);
    }
    const before = i === 0 ? "" : text.slice(i - widthBefore(text, i), i);
    const after = end >= text.length ? "" : text.slice(end, end + widthAt(text, end));
    const key = `${before}\u0000${text.slice(i, end)}\u0000${after}`;
    counts.set(key, (counts.get(key) ?? 0) + sign);
    i = end;
  }
}

/** Refuses unless the value to write keeps every invisible character of the read value, by THE RULE above, and adds none. */
export function checkedInvisibles(region, was, will) {
  if (!INVISIBLE_ANY.test(was) && !INVISIBLE_ANY.test(will)) return;
  // The unchanged start: the common text, cut back to the start of the run of
  // invisible characters it ends in, then matched visible character by
  // visible character.
  let start = 0;
  const shorter = Math.min(was.length, will.length);
  while (start < shorter && was.charCodeAt(start) === will.charCodeAt(start)) start += 1;
  if (start > 0 && isHigh(was.charCodeAt(start - 1))) start -= 1;
  start = runStart(was, start);
  let fromWas = start;
  let fromWill = start;
  let endWas;
  let endWill;
  for (;;) {
    endWas = runEnd(was, fromWas);
    endWill = runEnd(will, fromWill);
    const doneWas = endWas >= was.length;
    const doneWill = endWill >= will.length;
    const nextWas = doneWas ? "" : was.slice(endWas, endWas + widthAt(was, endWas));
    const nextWill = doneWill ? "" : will.slice(endWill, endWill + widthAt(will, endWill));
    if (nextWas !== nextWill) break;
    sameRun(region, was.slice(fromWas, endWas), will.slice(fromWill, endWill));
    if (doneWas) return;
    fromWas = endWas + nextWas.length;
    fromWill = endWill + nextWill.length;
  }
  // The unchanged end, matched the same way from the end, never into the
  // unchanged start.
  let tail = 0;
  const longest = Math.min(was.length - endWas, will.length - endWill);
  while (tail < longest && was.charCodeAt(was.length - 1 - tail) === will.charCodeAt(will.length - 1 - tail)) tail += 1;
  let toWas = was.length - tail;
  let toWill = will.length - tail;
  if (tail > 0 && toWas < was.length && isLow(was.charCodeAt(toWas))) {
    toWas += 1;
    toWill += 1;
  }
  const skip = runEnd(was, toWas) - toWas;
  toWas += skip;
  toWill += skip;
  for (;;) {
    const backWas = runStart(was, toWas);
    const backWill = runStart(will, toWill);
    const prevWas = backWas > endWas ? was.slice(backWas - widthBefore(was, backWas), backWas) : "";
    const prevWill = backWill > endWill ? will.slice(backWill - widthBefore(will, backWill), backWill) : "";
    if (prevWas === "" || prevWas !== prevWill) break;
    sameRun(region, was.slice(backWas, toWas), will.slice(backWill, toWill));
    toWas = backWas - prevWas.length;
    toWill = backWill - prevWill.length;
  }
  // The changed part: each run kept between the same two visible characters.
  const counts = new Map();
  const state = { region, characters: 0 };
  countRuns(was, fromWas, toWas, 1, counts, state);
  countRuns(will, fromWill, toWill, -1, counts, state);
  let removed;
  let added;
  for (const [key, count] of counts) {
    const run = key.split("\u0000")[1];
    if (count > 0 && removed === undefined) removed = run;
    if (count < 0 && added === undefined) added = run;
  }
  if (removed !== undefined && added !== undefined && removed.codePointAt(0) === added.codePointAt(0)) {
    refuseInvisible("moves", removed, region);
  }
  if (added !== undefined) refuseInvisible("adds", added, region);
  if (removed !== undefined) refuseInvisible("removes", removed, region);
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
 * is checked first, then the invisible characters of each value
 * (`checkedInvisibles`), then the values are split, each block counted against
 * MAX_BLOCKS as it is made. `meter.blocks`, when given, counts the blocks made.
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
  for (const { region, before, after } of compared) checkedInvisibles(region, before, after);
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
 * empty text (the read step's contract for a successful read), a status of
 * `published` or `draft`, a non-empty change time, a non-empty title and a
 * list of `field_` text values, for a non-empty node id of the run. Anything
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
  const changed = readText(call.nodeChanged).trim();
  if (changed === "") refuse("the read answered no change time, so it was not a successful read");
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
  if (changed.fields.length === 0 && changed.publish) {
    // A publish with no change of text stages no content, and the page display
    // draws only changed text blocks and no node status: there is nothing true
    // for it to draw, and the publish card opens only after an approved review.
    refuse(
      "a publish with no change of text cannot be reviewed on the page display yet: the display draws only changed text blocks, never the node's status",
      "ask for the publish together with a change of text, or publish the node on the site",
    );
  }
  const excerpts = pageExcerpts(read.values, changed);
  if (changed.fields.length === 0) {
    return { ok: true, next: "no_change", pageForm: {} };
  }
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
