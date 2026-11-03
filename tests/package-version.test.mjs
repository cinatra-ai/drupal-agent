import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// An installed Cinatra host keeps a stored template and a registry manifest per package
// version. At boot it skips a template whose version it already holds, so a change to the
// flow or to the declared tools that keeps the old version is never re-imported by an
// existing install: the old manifest then rejects the new tool as undeclared, or the old
// flow keeps running. The settle_outcome tool and its flow step arrived after 0.1.4, so the
// version that carries them is 0.1.5. A version below 0.1.5 would hide them from every
// install that already holds 0.1.4.
const SETTLE_OUTCOME_FIRST_VERSION = [0, 1, 5];

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const flow = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));

function parse(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  assert.ok(match, `package version ${JSON.stringify(version)} is a plain major.minor.patch version`);
  return match.slice(1).map(Number);
}

function atLeast(version, floor) {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== floor[i]) return version[i] > floor[i];
  }
  return true;
}

test("the package version carries the settle_outcome tool and its flow step", () => {
  const declared = (pkg.cinatra?.tools ?? []).some((tool) => tool.name === "settle_outcome");
  const inFlow = JSON.stringify(flow).includes('"settle_outcome"');
  assert.ok(declared, "package.json declares the settle_outcome tool");
  assert.ok(inFlow, "the flow calls the settle_outcome tool");
  assert.ok(
    atLeast(parse(pkg.version), SETTLE_OUTCOME_FIRST_VERSION),
    `version ${pkg.version} is below ${SETTLE_OUTCOME_FIRST_VERSION.join(".")}, the first version that carries settle_outcome`,
  );
});

test("the version parser refuses a version that is not major.minor.patch", () => {
  assert.throws(() => parse("0.1"), /plain major\.minor\.patch/);
  assert.throws(() => parse("0.1.5-rc.1"), /plain major\.minor\.patch/);
  assert.equal(atLeast([0, 1, 4], SETTLE_OUTCOME_FIRST_VERSION), false);
  assert.equal(atLeast([0, 1, 5], SETTLE_OUTCOME_FIRST_VERSION), true);
  assert.equal(atLeast([0, 2, 0], SETTLE_OUTCOME_FIRST_VERSION), true);
  assert.equal(atLeast([1, 0, 0], SETTLE_OUTCOME_FIRST_VERSION), true);
});
