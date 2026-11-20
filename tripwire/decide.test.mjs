// node --test
import test from "node:test";
import assert from "node:assert/strict";
import { decide, needsSecond } from "./decide.mjs";

const t = { field: "x", op: "<", threshold: 50, tolerance: 0.02 };
const d = (a, b) => decide(t, a, b).decision;

test("decide", () => {
  assert.equal(d({ x: 60 }), "NO_PAY");
  assert.equal(d({ x: 50 }), "NO_PAY"); // threshold itself is not a breach
  assert.equal(d({}), "NO_DATA");
  assert.equal(d({ x: null }), "NO_DATA"); // null must not read as 0 and trigger "<"
  assert.equal(d({ x: "abc" }), "NO_DATA");
  assert.equal(d({ x: 40 }), "DISPUTED"); // no second answer
  assert.equal(d({ x: 40 }, { x: 30 }), "DISPUTED"); // both breach but disagree
  assert.equal(d({ x: 49.9 }, { x: 50.1 }), "DISPUTED"); // close, but second does not breach
  assert.equal(d({ x: 40 }, { x: 40.5 }), "PAY");
  assert.equal(decide({ ...t, op: ">" }, { x: 60 }, { x: 60.5 }).decision, "PAY");
  const hot = { field: "x", op: ">", threshold: 1, abs_tolerance: 1 };
  assert.equal(decide(hot, { x: 1.5 }, { x: 2.4 }).decision, "PAY"); // 46% apart, but within 1 unit
  assert.equal(decide(hot, { x: 1.5 }, { x: 2.6 }).decision, "DISPUTED");
  const al = { ...t, always: true }; // second answer bought every time
  assert.equal(decide(al, { x: 60 }).decision, "DISPUTED"); // no second answer
  assert.equal(decide(al, { x: 60 }, { x: 60.5 }).decision, "NO_PAY");
  assert.equal(decide(al, { x: 60 }, { x: 40 }).decision, "DISPUTED"); // wrong first answer no longer hides a breach
  assert.equal(decide(al, { x: 50.1 }, { x: 49.9 }).decision, "DISPUTED"); // close, opposite sides
  assert.equal(decide(al, { x: 40 }, { x: 40.5 }).decision, "PAY");
  assert.equal(needsSecond(al, { x: 60 }), true);
  assert.equal(needsSecond(t, { x: 40 }), true);
  assert.equal(needsSecond(t, { x: 60 }), false);
});
