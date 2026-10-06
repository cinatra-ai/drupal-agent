import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const oas = JSON.parse(readFileSync(new URL("../cinatra/oas.json", import.meta.url), "utf8"));

// The runtime's spec library derives a template node's inputs only from bare
// placeholders and ignores filtered ones, so a declared input that a template
// reads only through a filter makes the loader refuse the flow. A placeholder
// inside a comment counts as bare (the input-hint comment is the cure).
function filteredOnlyInputs(components) {
  const strings = (value, out) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const item of value) strings(item, out);
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key !== "inputs" && key !== "outputs") strings(item, out);
      }
    }
    return out;
  };
  const found = [];
  for (const [key, component] of Object.entries(components)) {
    if (!Array.isArray(component?.inputs)) continue;
    const bare = new Set();
    const filtered = new Set();
    for (const text of strings(component, [])) {
      for (const match of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
        const expression = match[1];
        if (expression.includes("|")) filtered.add(expression.split("|")[0].trim());
        else bare.add(expression.trim());
      }
    }
    for (const input of component.inputs) {
      if (filtered.has(input.title) && !bare.has(input.title)) found.push(`${key}.${input.title}`);
    }
  }
  return found.sort();
}

test("every declared input a component's template reads through a filter is also named bare", () => {
  const withInputs = Object.entries(oas.$referenced_components).filter(([, c]) => Array.isArray(c?.inputs));
  assert.ok(withInputs.length > 0);
  assert.ok(withInputs.some(([key]) => key === "emit_output"));
  assert.deepEqual(filteredOnlyInputs(oas.$referenced_components), []);
});

test("the scanner flags a filtered-only input and accepts a comment hint", () => {
  const component = (message) => ({ n: { inputs: [{ title: "a" }], message } });
  assert.deepEqual(filteredOnlyInputs(component("{{ a | tojson }}")), ["n.a"]);
  assert.deepEqual(filteredOnlyInputs(component("{# {{ a }} #}{{ a | tojson }}")), []);
});
