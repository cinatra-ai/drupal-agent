/**
 * THE WRITE STEP'S OUTCOME, SETTLED.
 *
 * The write step answers one declared outcome: `saved`, `no_change` or
 * `refused`. This module reads that answer against the reviewed proposal and
 * the actual read, and it lets the run go on only when the answer holds. It
 * reads and writes no port, no table and no artifact.
 *
 * - `refused` stops the run with the write step's reason.
 * - `no_change` holds only when the reviewed proposal is empty, or each
 *   proposed field equals its current value.
 * - `saved` with no change holds only for a proposal that changes nothing
 *   (an explicit publish-only request).
 * - `saved` and `no_change` carry an exactly empty reason; any reason means the
 *   write step did not do what the answer says, and stops the run.
 * - A read that failed (any `error.code` other than the exact empty string), a
 *   status other than `published` or `draft`, a proposed field or a read field
 *   value without a text field name, field values that name a field twice, an answer that is not exactly one of the three outcomes, or an input
 *   this module cannot read as its declared shape, stops the run.
 * - It cannot see the write itself: a `saved` answer with a non-empty diff is
 *   taken on the write step's own report.
 *
 * It stops the run by the host's documented means: it throws an error named
 * `ExtensionToolCallRefusal` whose message is one sentence. The host then
 * answers the call as refused, and the flow step that called it fails the run.
 */

export const OUTCOMES = ["saved", "no_change", "refused"];

/** The statuses a successful read reports; the read step answers `unknown` for any other. */
const STATUSES = ["published", "draft"];

/** The ONE name the host reads as a module's refusal of a call. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

/** The host repeats a refusal sentence of at most this many characters. */
const SENTENCE_MAX = 400;

/** One sentence on one line, within the host's length bound. */
function sentenceOf(text) {
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length <= SENTENCE_MAX ? line : `${line.slice(0, SENTENCE_MAX - 1).trimEnd()}…`;
}

function refuse(text) {
  const error = new Error(sentenceOf(text));
  error.name = REFUSAL_NAME;
  throw error;
}

/** A value the flow sends as JSON TEXT, read back; a value it cannot read is null. */
function parseJsonish(value) {
  if (typeof value !== "string") return value === undefined ? null : value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const textOf = (value) => (typeof value === "string" ? value : value == null ? "" : JSON.stringify(value));

/** A text value the flow sends as JSON text (or as the bare text), read back; undefined when absent. */
function readText(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return textOf(value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    // the bare text itself
  }
  return value;
}

/** True when a list holds an element that is not an object with a non-empty text `field`. */
const nameless = (list) => list.some((item) => !isPlainObject(item) || typeof item.field !== "string" || item.field === "");

/** The field's current value as the read answered it, or undefined when the read has none. */
function currentValue(field, read) {
  if (field === "title") return typeof read.title === "string" ? read.title : undefined;
  if (field === "body") return typeof read.body === "string" ? read.body : undefined;
  const entry = read.fieldValues.find((item) => item && item.field === field);
  return entry ? textOf(entry.value) : undefined;
}

/** The names of the proposed fields that differ from the read (or that the read does not have). */
function differingFields(proposed, read) {
  return proposed
    .filter((item) => currentValue(item?.field, read) !== textOf(item?.value))
    .map((item) => String(item?.field ?? "an unnamed field"));
}

function settle(call) {
  const outcome = readText(call.outcome);
  const statedReason = readText(call.reason);
  const reason = (statedReason ?? "").trim();
  const changes = parseJsonish(call.changes);
  const proposed = parseJsonish(call.proposedFields);
  const fieldValues = parseJsonish(call.fieldValues);
  const error = parseJsonish(call.error);
  if (!OUTCOMES.includes(outcome)) {
    refuse("The write step answered no declared outcome (saved, no_change or refused), so nothing is known to be saved.");
  }
  if (outcome === "refused") {
    refuse(reason || "The write step refused the edit without a reason; nothing is known to be saved.");
  }
  if (statedReason !== "") {
    refuse(`The write step answered ${outcome} but its reason is not empty, so nothing is known to be saved` + (reason ? `: ${reason}` : "."));
  }
  // An input this module cannot read is never read as "nothing there": the flow
  // always sends each one as JSON text of its declared shape (an empty list is `[]`).
  if (!Array.isArray(proposed)) refuse("The reviewed proposal could not be read, so nothing is known to be saved.");
  if (!Array.isArray(fieldValues)) refuse("The page's field values could not be read, so nothing is known to be saved.");
  if (!Array.isArray(changes)) refuse("The write step's changes could not be read, so nothing is known to be saved.");
  if (!isPlainObject(error) || typeof error.code !== "string") refuse("The read step's error could not be read, so nothing is known to be saved.");
  const read = { title: readText(call.title), body: readText(call.body), fieldValues };
  const diff = changes;
  const proposal = proposed;
  if (error.code !== "") {
    refuse(`The page could not be read (${JSON.stringify(error.code)}), so no edit can be saved.`);
  }
  if (!STATUSES.includes(readText(call.nodeStatus))) {
    refuse("The page's status was not read as published or draft, so no edit can be saved.");
  }
  if (nameless(proposal) || nameless(fieldValues)) {
    refuse("A proposed field or a read field value has no field name, so they cannot be compared.");
  }
  const named = fieldValues.map((item) => item?.field);
  if (new Set(named).size !== named.length) {
    refuse("The page's field values name a field more than once, so they cannot be compared.");
  }
  const differing = differingFields(proposal, read);
  if (outcome === "no_change") {
    if (diff.length > 0) {
      refuse("The write step answered no_change but reported changes, so its answer cannot be trusted.");
    }
    if (differing.length > 0) {
      refuse(
        `The reviewed proposal changes ${differing.join(", ")} but the write step saved nothing.`,
      );
    }
  }
  if (outcome === "saved" && diff.length === 0 && differing.length > 0) {
    refuse(
      `The write step answered saved but reported no change for ${differing.join(", ")}, ` +
        "so nothing is known to be saved.",
    );
  }
  return { ok: true };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Its one operation is `settle`; any other is
 * refused.
 */
export async function extensionTool({ input }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "settle") return settle(call);
  throw new Error(`settle_outcome: \`op\` must be settle — got ${JSON.stringify(call.op)}`);
}
