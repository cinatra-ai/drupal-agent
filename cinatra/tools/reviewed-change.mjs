/**
 * THE REVIEWED CHANGE, READ BACK.
 *
 * The compose step files the values to write in the page snapshot itself
 * (`writeFields`: the fields and the publish flag), and a person reviews that
 * snapshot. After the review, this module reads back the revision the person
 * approved and answers its values. The write step takes the values it writes
 * only from this answer, so it can write nothing the reviewed snapshot did not
 * hold.
 *
 * - The revision read is the one the review's answer names for the filed
 *   artifact, never the one this run filed: after a Regenerate the approved
 *   revision is a successor of it.
 * - It reads through the host's artifact read port, by that revision id, and
 *   never the latest revision.
 * - It refuses, so the step and the run fail and the write step never runs,
 *   when the answer names no approved revision of the filed artifact, when the
 *   read fails, is cut short or answers another revision or artifact, and when
 *   the text carries no values to write.
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
  };
}

async function read(call, ports) {
  const artifactId = readText(call.artifactId).trim();
  if (artifactId === "") refuse("the run filed no page snapshot");
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
  return { ok: true, reviewedFields: values.fields, reviewedPublish: values.publish, reviewedRevisionId: revisionId };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Its one operation is `read`; any other is
 * refused.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "read") return read(call, ports);
  throw new Error(`reviewed_change: \`op\` must be read — got ${JSON.stringify(call.op)}`);
}
