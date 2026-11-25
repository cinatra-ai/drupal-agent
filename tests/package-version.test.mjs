import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// An installed Cinatra host keeps one stored template per package, marked with its version,
// and a registry manifest per published version. At boot it skips the import of a template
// whose version it already holds, unless the template's lifecycle projection drifted from the
// manifest or the boot repaired a missing install record (both re-import at the same version).
// When the lifecycle projection matches, a missing record whose repair is refused or fails is
// still skipped; when it drifted, the template is imported again before a repair of a missing
// record is tried. So a change to the flow or to the declared tools that keeps the old version
// is not re-imported by an install whose lifecycle projection matches and whose install record
// is live: the old manifest then rejects the new tool as undeclared, or the old flow keeps
// running.
// The model-free read and write (the read step, the check of the read, the two
// publishing steps and the outcome step of the reviewed_change tool) arrived
// after 0.1.7, so the version that carries them is 0.1.8. A version below 0.1.8
// would leave each such install that already holds 0.1.7 on the old flow.
const MODEL_FREE_FIRST_VERSION = [0, 1, 8];

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

test("the package version carries the model-free read and write", () => {
  const steps = flow.$referenced_components;
  for (const step of ["read_page", "check_read", "write_draft", "write_unpublished", "write_outcome"]) {
    assert.ok(steps[step], `the flow has the step ${step}`);
  }
  assert.ok((pkg.cinatra?.tools ?? []).some((tool) => tool.name === "reviewed_change"), "package.json declares the reviewed_change tool");
  assert.ok(
    atLeast(parse(pkg.version), MODEL_FREE_FIRST_VERSION),
    `version ${pkg.version} is below ${MODEL_FREE_FIRST_VERSION.join(".")}, the first version that carries the model-free flow`,
  );
});

test("the version parser refuses a version that is not major.minor.patch", () => {
  assert.throws(() => parse("0.1"), /plain major\.minor\.patch/);
  assert.throws(() => parse("0.1.5-rc.1"), /plain major\.minor\.patch/);
  assert.equal(atLeast([0, 1, 7], MODEL_FREE_FIRST_VERSION), false);
  assert.equal(atLeast([0, 1, 8], MODEL_FREE_FIRST_VERSION), true);
  assert.equal(atLeast([0, 2, 0], MODEL_FREE_FIRST_VERSION), true);
  assert.equal(atLeast([1, 0, 0], MODEL_FREE_FIRST_VERSION), true);
});
