// Offline benchmark: score real, paid miner answers against the truth source with the comparator.
//   node gauge.mjs (in ../gauge), then:  node benchmark.mjs > benchmark.md
// Miner answers come from Tripwire's ledger of paid requests, so every row has a receipt.
import { readFileSync } from "node:fs";
import { score } from "./wasm.mjs";

const TRUTH = process.env.GAUGE_URL ?? "http://localhost:8788";
const INTENT = "MINING_HASHPRICE_VERIFY_GENERAL", FIELD = "hashprice_sats_per_ph_day";
const SCALE = 1e6; // the intent stores this field with 6 decimals
const TOL_BPS = 50n; // ponytail: assumed RelTol 0.5%; the node's own setting for this intent is not public

const ledger = readFileSync(new URL("../tripwire/ledger.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const answers = new Map(); // "height|miner" -> latest answer
const routed = []; // baseline: requests where the network chose the miner itself
for (const e of ledger) {
  if (String(e.body?.miner_id) === "4283") continue; // Gauge supplies the truth here, so scoring it against itself would prove nothing
  if (e.payload.intent !== INTENT || e.status !== 200) continue;
  const h = e.payload.params.block_height;
  if (e.path === "/engine/v1/ask") routed.push({ at: e.at, h, miner: e.body.miner_id, value: e.body.result?.[FIELD] });
  answers.set(`${h}|${e.body.miner_id}`, { h, miner: `${e.body.miner_name.replace(/[^\x20-\x7e].*/, "").trim()} (${e.body.miner_id})`, value: e.body.result?.[FIELD], receipt: e.receipt?.receipt_hash });
}

const fixed = (v) => BigInt(Math.round(v * SCALE));
const truth = new Map();
for (const h of new Set([...answers.values()].map((a) => a.h))) {
  const r = await fetch(`${TRUTH}/hashprice?block_height=${h}`);
  if (r.ok) truth.set(h, (await r.json())[FIELD]);
}

const perMiner = new Map();
const rows = [...answers.values()].filter((a) => truth.has(a.h)).sort((a, b) => a.h - b.h || a.miner.localeCompare(b.miner)).map((a) => {
  const t = truth.get(a.h);
  const ok = a.value != null && Number.isFinite(Number(a.value));
  const s = ok ? Number(score(fixed(t), fixed(Number(a.value)), 2, TOL_BPS)) : 0;
  const m = perMiner.get(a.miner) ?? perMiner.set(a.miner, []).get(a.miner);
  m.push(s);
  const off = ok ? `${(((a.value - t) / t) * 100).toFixed(4)}%` : "n/a";
  return `| ${a.h} | ${a.miner} | ${ok ? a.value : "no number"} | ${t} | ${off} | ${s} | ${a.receipt ? "`" + a.receipt.slice(0, 18) + "…`" : ""} |`;
});

const scoreOf = (h, v) => (v != null && Number.isFinite(Number(v)) ? Number(score(fixed(truth.get(h)), fixed(Number(v)), 2, TOL_BPS)) : 0);
const base = routed.filter((r) => truth.has(r.h)).map((r) => ({ ...r, s: scoreOf(r.h, r.value) }));
const bad = base.filter((r) => r.s === 0).length;

console.log(`# Benchmark: ${INTENT}

Truth: the Gauge reference endpoint (two chain indexers that must agree). Comparator: \`tripwire_measure.wasm\`, RelTol, tolerance ${TOL_BPS} bps (assumed).
Miner answers are real paid requests on Ethereum Sepolia testnet, taken from Tripwire's ledger. Generated ${new Date().toISOString()}.

## Baseline: the network's own routing

The family has no champion comparator, so the live ranking comes from a generic fallback scorer. These are the ${base.length} requests where we let the network choose the miner. Our measurement scores ${bad} of them 0.

| When (UTC) | Block | Miner the network chose | Its answer | Truth | Score here (bps) |
|---|---|---|---|---|---|
${base.map((r) => `| ${r.at.slice(0, 16).replace("T", " ")} | ${r.h} | ${r.miner} | ${r.value ?? "no number"} | ${truth.get(r.h)} | ${r.s} |`).join("\n")}

## Mean score per miner

| Miner | Answers | Mean score (bps) |
|---|---|---|
${[...perMiner].sort((a, b) => b[1].reduce((x, y) => x + y) / b[1].length - a[1].reduce((x, y) => x + y) / a[1].length).map(([m, s]) => `| ${m} | ${s.length} | ${Math.round(s.reduce((x, y) => x + y) / s.length)} |`).join("\n")}

## Every answer

| Block | Miner | Miner value | Truth | Off by | Score (bps) | Receipt |
|---|---|---|---|---|---|---|
${rows.join("\n")}`);
