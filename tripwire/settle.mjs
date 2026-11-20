// Settle one cover: buy the trigger value, corroborate a breach with a second miner, decide, record.
//   node --env-file=.env settle.mjs covers/hashprice.json
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { ask, askMiner, transfer } from "./telegraph.mjs";
import { decide, needsSecond } from "./decide.mjs";

const DECISIONS = new URL("./decisions.jsonl", import.meta.url);

const evidence = (r) => ({
  status: r.status,
  miner_id: r.body.miner_id,
  miner_name: r.body.miner_name,
  result: r.ok ? r.body.result : undefined,
  error: r.ok ? undefined : r.body.error,
  signal_hash: r.body.signal_hash,
  receipt_hash: r.receipt?.receipt_hash,
  tx_hash: r.receipt?.tx_hash,
  cost_usd: r.cost_usd,
});

// cover: { name, intent, params, trigger, primary?: minerId, corroborators: [minerId, ...], payout?: { to, usd }, by?: "schedule" }
// on(event) is told each stage as it happens: ask, price, signed, answer, decide.
// io is replaced in tests, so the flow can be checked without paying or touching decisions.jsonl.
const live = {
  ask, askMiner, transfer,
  save: (record) => appendFileSync(DECISIONS, JSON.stringify(record) + "\n"),
  // The transaction of an earlier payout on this cover, so one cover never pays twice.
  paid: (name) => (existsSync(DECISIONS) ? readFileSync(DECISIONS, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []).find((d) => d.cover === name && d.payout?.tx_hash)?.payout.tx_hash,
  payouts: () => process.env.PAYOUTS === "on", // off unless the operator turns it on: a payout is an on-chain transfer
};
// What happens to the money on a PAY decision. Never throws: the decision is recorded either way.
async function payOut(cover, io) {
  const { to, usd } = cover.payout, prior = io.paid(cover.name);
  if (prior) return { to, usd, skipped: "this cover has already paid out", tx_hash: prior };
  if (!io.payouts()) return { to, usd, skipped: "payouts are switched off on this machine" };
  try { return { to, usd, tx_hash: await io.transfer(to, usd) }; } catch (e) { return { to, usd, error: String(e.shortMessage ?? e.message).slice(0, 200) }; }
}
export async function settle(cover, on = () => {}, io = live) {
  const answers = [];
  const buy = async (minerId) => {
    const n = answers.length + 1, step = (stage) => on({ stage, n });
    on({ stage: "ask", n, miner: minerId ?? null });
    const r = minerId ? await io.askMiner(minerId, cover.intent, cover.params, step) : await io.ask(cover.intent, cover.params, step);
    answers.push(evidence(r));
    on({ stage: "answer", n, ...answers.at(-1) });
    return r;
  };
  // A cover may name its primary miner; otherwise the network routes the request.
  const first = await buy(cover.primary);
  const a = first.ok ? first.body.result : null;

  let b = null;
  if (needsSecond(cover.trigger, a)) {
    // A second answer only counts if it comes from a different miner.
    for (const id of cover.corroborators.filter((id) => String(id) !== String(first.body.miner_id))) {
      const second = await buy(id);
      if (second.ok) { b = second.body.result; break; }
    }
  }

  on({ stage: "decide" });
  const record = {
    at: new Date().toISOString(),
    cover: cover.name,
    mission: cover.mission,
    by: cover.by === "schedule" ? "schedule" : "request", // the watch loop, or someone pressing the button
    intent: cover.intent,
    params: cover.params,
    trigger: cover.trigger,
    ...decide(cover.trigger, a, b),
    cost_usd: +answers.reduce((s, x) => s + x.cost_usd, 0).toFixed(6),
    network: "Ethereum Sepolia testnet",
    answers,
  };
  if (record.decision === "PAY" && cover.payout) {
    on({ stage: "payout", ...cover.payout });
    record.payout = await payOut(cover, io);
  }
  io.save(record);
  return record;
}

if (process.argv[1]?.endsWith("settle.mjs")) {
  const cover = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (process.argv[3]) cover.trigger.threshold = Number(process.argv[3]); // override for a quick retest
  console.log(JSON.stringify(await settle(cover), null, 2));
}
