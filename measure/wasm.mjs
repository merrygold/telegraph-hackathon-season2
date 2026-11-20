// Loads the comparator module and scores with it, the same way a validator calls it.
import { readFileSync } from "node:fs";

export const WASM_FILE = new URL("./tripwire_measure.wasm", import.meta.url);
export const wasmBytes = () => readFileSync(WASM_FILE);

const module = new WebAssembly.Module(wasmBytes());
export const imports = WebAssembly.Module.imports(module); // must be empty
const { exports: x } = new WebAssembly.Instance(module, {});

// truth, miner, tolerance are BigInt (int64); code is a number. Returns a BigInt score in basis points.
export function score(truth, miner, code, tolerance) {
  const ptr = x.imw_alloc(16);
  if (!ptr) throw new Error("imw_alloc failed");
  const spec = new DataView(x.memory.buffer, ptr, 16);
  spec.setBigInt64(0, BigInt(code), true);
  spec.setBigInt64(8, tolerance, true);
  const s = x.imw_score_deterministic(truth, miner, ptr);
  x.imw_free(ptr, 16);
  return s;
}
