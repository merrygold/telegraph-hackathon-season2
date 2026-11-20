// Checks the built comparator against the reference rule from the Telegraph docs.
//   node check.mjs
// Fails loudly if the module has imports, differs from the rule on any case, or is not repeatable.
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { score, imports, wasmBytes } from "./wasm.mjs";

const abs = (v) => (v < 0n ? -v : v);

// The rule, written independently of the Rust code.
function reference(truth, miner, code, tol) {
  const exact = miner === truth ? 10000n : 0n;
  let err;
  if (code === 1) err = abs(miner - truth);
  else if (code === 2) err = (abs(miner - truth) * 10000n) / (abs(truth) > 1n ? abs(truth) : 1n);
  else return exact; // 0 Exact, 3 PassFail, unknown codes
  if (tol <= 0n) return exact;
  if (err >= 2n * tol) return 0n;
  return (10000n * (2n * tol - err)) / (2n * tol);
}

const MAX = 2n ** 63n - 1n, MIN = -(2n ** 63n);
const clamp = (v) => (v > MAX ? MAX : v < MIN ? MIN : v);

const codes = [0, 1, 2, 3, 7, -1];
const tolerances = [0n, -5n, 1n, 2n, 50n, 100n, 2500n, 10n ** 6n, 10n ** 15n];
const truths = [1n, 2n, 7n, 100n, 10n ** 6n, 42_706_575_305n, 10n ** 12n, 10n ** 18n, -1n, -100n, -(10n ** 9n), -(10n ** 18n), MAX, MIN + 1n];

function cases() {
  const out = [];
  for (const code of codes)
    for (const tol of tolerances)
      for (const truth of truths) {
        // The miner-value distance that produces an error of exactly `tol` under this code.
        const unit = code === 2 ? (abs(truth) * tol) / 10000n : tol;
        const steps = new Set([0n, 1n, unit / 2n, unit, unit + 1n, 2n * unit - 1n, 2n * unit, 2n * unit + 1n, 3n * unit, abs(truth)]);
        for (const d of steps) for (const sign of [1n, -1n]) out.push([truth, clamp(truth + sign * d), code, tol]);
      }
  return out;
}

const all = cases();
const run = () => all.map(([t, m, c, tol]) => score(t, m, c, tol));
const first = run(), second = run();

assert.equal(imports.length, 0, "module must have no imports");
all.forEach(([t, m, c, tol], i) => {
  const want = reference(t, m, c, tol);
  assert.equal(first[i], want, `truth=${t} miner=${m} code=${c} tol=${tol}: got ${first[i]}, want ${want}`);
  assert.ok(first[i] >= 0n && first[i] <= 10000n);
});
assert.deepEqual(first, second, "second run must be identical");

// A few values worked by hand.
assert.equal(score(1000n, 1000n, 0, 0n), 10000n);
assert.equal(score(1000n, 1001n, 0, 99n), 0n);
assert.equal(score(1000n, 1005n, 1, 10n), 7500n); // AbsTol: err 5, window 20
assert.equal(score(1000n, 1020n, 1, 10n), 0n);
assert.equal(score(10n ** 18n, 10n ** 18n + 10n ** 16n, 2, 100n), 5000n); // RelTol: 100 bps off, tolerance 100 bps
assert.equal(score(-1000n, -1005n, 1, 10n), 7500n);

console.log(`ok: ${all.length} cases match the reference rule, two identical runs, 0 imports`);
console.log(`size: ${wasmBytes().length} bytes`);
console.log(`wasmHash (keccak256): ${keccak256(wasmBytes())}`);
