// The runnable endpoint a validator calls before it accepts the comparator.
//   node runnable.mjs      POST /runnable  {"batch":[{"ground_truth_value":1,"miner_value":1,"spec":[1,10]}]}
// It runs the same .wasm file that is registered, and serves that file at /tripwire_measure.wasm.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { score, wasmBytes } from "./wasm.mjs";

const PORT = Number(process.env.PORT ?? 8789);

// int64 values do not fit a JS number, so quote every integer before parsing and read them as BigInt.
const parse = (text) => JSON.parse(text.replace(/(?<![\w."])-?\d+(?![\w."])/g, '"$&"'));
const int64 = (v) => {
  const n = BigInt(v);
  if (n < -(2n ** 63n) || n >= 2n ** 63n) throw new Error("value is outside int64");
  return n;
};

export function scoreBatch(text) {
  const { batch } = parse(text);
  if (!Array.isArray(batch) || batch.length > 100) throw new Error("batch must be a list of at most 100 questions");
  return {
    results: batch.map((q) => {
      try {
        return { score: Number(score(int64(q.ground_truth_value), int64(q.miner_value), Number(BigInt.asIntN(32, int64(q.spec[0]))), int64(q.spec[1]))) };
      } catch (e) {
        return { error: e.message };
      }
    }),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  createServer(async (req, res) => {
    const send = (code, body, type = "application/json") => res.writeHead(code, { "Content-Type": type }).end(body);
    if (req.method === "GET" && req.url === "/tripwire_measure.wasm") return send(200, wasmBytes(), "application/wasm");
    if (req.method === "GET" && req.url === "/") return send(200, readFileSync(new URL("./index.html", import.meta.url)), "text/html; charset=utf-8"); // a page for people
    if (req.method !== "POST" || !req.url.startsWith("/runnable")) return send(404, '{"error":"POST /runnable"}');
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) return send(413, '{"error":"too large"}'); }
    try { send(200, JSON.stringify(scoreBatch(body))); } catch (e) { send(400, JSON.stringify({ error: e.message })); }
  }).listen(PORT, () => console.log(`Runnable comparator on http://localhost:${PORT}/runnable`));
}
