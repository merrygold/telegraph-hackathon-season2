// Tripwire: watch loop plus a one-page view.
//   node --env-file=.env server.mjs        then open http://localhost:8787
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { settle } from "./settle.mjs";
import { account, spentUsd, resetSpent, BUDGET_USD } from "./telegraph.mjs";
import { parseCover } from "./parse.mjs";
import { idOf, totals, disagreements } from "./records.mjs";
import { createPublicClient, http, parseAbi, formatEther } from "viem";
import { sepolia } from "viem/chains";

const GAUGE = process.env.GAUGE_URL ?? "http://localhost:8788";
const MEASURE = process.env.MEASURE_URL ?? "http://localhost:8789";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const chain = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
let bal = { at: 0, value: null };
// Wallet balances for the page, read from the chain at most every 20 seconds. null if the RPC is unreachable.
async function balances() {
  if (Date.now() - bal.at < 20_000) return bal.value;
  try {
    const [usdc, eth] = await Promise.all([
      chain.readContract({ address: USDC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [account.address] }),
      chain.getBalance({ address: account.address }),
    ]);
    bal = { at: Date.now(), value: { usdc: Number(usdc) / 1e6, eth: Number(formatEther(eth)) } };
  } catch { bal = { at: Date.now() - 15_000, value: bal.value }; } // keep the last good reading, retry in 5 s
  return bal.value;
}
// The page shows the miner and the comparator too. Only these fixed routes are forwarded.
async function forward(res, url, init) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
  } catch { json(res, 503, { error: "not_running", message: "That service is not running on this machine. Start everything with: node local.mjs" }); }
}

const PORT = Number(process.env.PORT ?? 8787);
const WATCH_MINUTES = Number(process.env.WATCH_MINUTES ?? 10); // 0 turns the watch loop off
const here = (p) => new URL(p, import.meta.url);
const readLines = (p) =>
  existsSync(here(p)) ? readFileSync(here(p), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
const covers = () =>
  readdirSync(here("./covers/")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(here("./covers/" + f), "utf8")));

let halted = null; // set when the agent stops itself, e.g. budget exhausted
// The budget is per day, so a public demo that hits its cap comes back by itself.
setInterval(() => { resetSpent(); halted = null; }, 86_400_000).unref();

// "$BTC_TIP" in a cover's params means "the newest Bitcoin block at the time of the check".
async function resolveParams(params) {
  const out = { ...params };
  for (const [k, v] of Object.entries(out))
    if (v === "$BTC_TIP") out[k] = Number(await (await fetch("https://blockstream.info/api/blocks/tip/height")).text());
  return out;
}

function validate(c) {
  const t = c?.trigger;
  if (typeof c?.intent !== "string" || !/^[A-Z0-9_]{3,80}$/.test(c.intent)) return "intent must be an intent name";
  if (!c.params || typeof c.params !== "object") return "params must be an object";
  if (!t || typeof t.field !== "string") return "trigger.field is required";
  if (t.op !== "<" && t.op !== ">") return 'trigger.op must be "<" or ">"';
  if (!Number.isFinite(t.threshold)) return "trigger.threshold must be a number";
  if (t.abs_tolerance != null ? !(t.abs_tolerance >= 0) : !(t.tolerance >= 0 && t.tolerance <= 1)) return "set trigger.tolerance (0 to 1) or trigger.abs_tolerance (0 or more)";
  if (!Array.isArray(c.corroborators) || !c.corroborators.length || c.corroborators.length > 5) return "corroborators must list 1 to 5 miner ids";
  if (![c.primary ?? 0, ...c.corroborators].every((id) => /^\d+$/.test(String(id)))) return "miner ids must be numbers";
  if (c.payout != null && !(/^0x[0-9a-fA-F]{40}$/.test(c.payout.to) && c.payout.usd > 0 && c.payout.usd <= 1)) return "payout needs an address in 'to' and 'usd' above 0, at most 1";
  return null;
}

// A payout is honoured only for a cover exactly as it is on file. A pasted or edited cover settles, but moves no money:
// otherwise anyone could post a cover that pays the wallet's balance to themselves.
function onFile(cover) {
  const { by, ...posted } = cover;
  if (!covers().some((c) => JSON.stringify(c) === JSON.stringify(posted))) delete posted.payout;
  return posted;
}

async function run(cover, on) {
  if (halted) throw new Error(halted);
  try {
    return await settle({ ...cover, name: String(cover.name ?? "unnamed cover").slice(0, 200), params: await resolveParams(cover.params) }, on);
  } catch (e) {
    if (/budget exhausted/.test(e.message)) halted = e.message;
    throw e;
  }
}

// The autonomous part: check every open cover on a timer, with no human in the loop.
async function watch() {
  const paid = new Set(readLines("./decisions.jsonl").filter((d) => d.decision === "PAY").map((d) => d.cover));
  for (const cover of covers()) {
    if (!cover.watch || paid.has(cover.name) || halted) continue;
    try {
      const d = await run({ ...cover, by: "schedule" });
      console.log(new Date().toISOString(), d.decision, cover.name, `$${d.cost_usd}`);
    } catch (e) {
      console.error("watch:", e.message);
    }
  }
}
if (WATCH_MINUTES > 0) { setInterval(watch, WATCH_MINUTES * 60_000); watch(); }

const json = (res, code, body) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/")
      return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(readFileSync(here("./index.html")));
    if (req.method === "GET" && req.url === "/api/state") {
      const all = readLines("./decisions.jsonl");
      return json(res, 200, {
        wallet: account.address, network: "Ethereum Sepolia testnet",
        balances: await balances(), usdc_contract: USDC,
        spent_usd: spentUsd(), budget_usd: BUDGET_USD, halted, watch_minutes: WATCH_MINUTES,
        payouts_on: process.env.PAYOUTS === "on",
        covers: covers(), totals: totals(all), disagreements: disagreements(all),
        decisions: all.slice(-50).reverse().map((d) => ({ ...d, id: idOf(d) })),
      });
    }
    if (req.method === "GET" && req.url.startsWith("/api/decision/")) { // the permanent link of one decision
      const d = readLines("./decisions.jsonl").find((d) => idOf(d) === req.url.slice(14));
      return d ? json(res, 200, { ...d, id: idOf(d) }) : json(res, 404, { error: "no decision with that id" });
    }
    const u = new URL(req.url, "http://x");
    if (req.method === "GET" && ["/api/gauge/hashprice", "/api/gauge/port-congestion", "/api/gauge/temperature", "/api/gauge/crypto-price", "/api/gauge/fx"].includes(u.pathname))
      return forward(res, GAUGE + u.pathname.slice(10) + u.search);
    if (req.method === "GET" && req.url === "/api/benchmark")
      return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(readFileSync(here("../measure/benchmark.md")));
    if (req.method === "POST" && req.url === "/api/measure") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 10_000) return json(res, 413, { error: "too large" }); }
      return forward(res, MEASURE + "/runnable", { method: "POST", body });
    }
    if (req.method === "POST" && (req.url === "/api/settle" || req.url === "/api/parse")) {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 10_000) return json(res, 413, { error: "too large" }); }
      if (req.url === "/api/parse") { // free: reads cover wording into a cover, buys nothing
        const parsed = parseCover(body);
        return json(res, parsed.error ? 400 : 200, parsed);
      }
      let cover;
      try { cover = JSON.parse(body); } catch { return json(res, 400, { error: "body is not JSON" }); }
      const problem = validate(cover);
      if (problem) return json(res, 400, { error: problem });
      // One JSON object per line: each stage as it happens, then {stage:"done", record} or {stage:"error"}.
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
      const send = (e) => res.write(JSON.stringify(e) + "\n");
      try { const record = await run(onFile(cover), send); send({ stage: "done", record: { ...record, id: idOf(record) } }); } catch (e) { send({ stage: "error", error: e.message }); }
      return res.end();
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, /budget exhausted/.test(e.message) ? 429 : 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Tripwire on http://localhost:${PORT}, wallet ${account.address}, watch every ${WATCH_MINUTES} min`));
