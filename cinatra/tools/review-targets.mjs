/**
 * THE PACK'S ONE DECLARED TOOL.
 *
 * The agent reads the page, files the page snapshot with the published and the
 * proposed words, the application reviews it, and the write step follows the
 * review. This module hands the application the reference of the filed page
 * snapshot, and nothing else: it reads and writes no other port, no table and
 * no artifact.
 */

/** A value the flow sends as JSON TEXT, read back. */
function parseJsonish(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Hand the review set to the application exactly as given: a set this module
 * cannot read is handed over as it arrived.
 */
async function review(input, ports) {
  const parsed = parseJsonish(input.reviewTargets);
  const targets = parsed === null ? input.reviewTargets : parsed;
  ports.review.file(targets);
  return { ok: true };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Its one operation is `review`; any other is
 * refused.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = typeof call.op === "string" ? call.op.trim() : "";
  if (op === "review") return review(call, ports);
  throw new Error(`review_targets: \`op\` must be review — got ${JSON.stringify(call.op)}`);
}
