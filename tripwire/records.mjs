// Read-only views over the recorded decisions: a stable id for each, totals, and where two miners disagreed.
import { createHash } from "node:crypto";

// decisions.jsonl is append-only, so the hash of a record never changes and can serve as its link.
export const idOf = (d) => createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 12);

export function totals(decisions) {
  const t = { decisions: decisions.length, by_request: 0, by_schedule: 0, unlabelled: 0, paid_requests: 0, spent_usd: 0, payouts: 0 };
  for (const d of decisions) {
    t[d.by === "schedule" ? "by_schedule" : d.by === "request" ? "by_request" : "unlabelled"]++; // records from before 12 Nov carry no label
    t.paid_requests += d.answers.filter((a) => a.cost_usd > 0).length;
    t.spent_usd += d.cost_usd;
    if (d.payout?.tx_hash && !d.payout.skipped) t.payouts++;
  }
  t.spent_usd = +t.spent_usd.toFixed(6);
  return t;
}

// One row per question and pair of miners that ended DISPUTED with two values: how often, and the latest case.
export function disagreements(decisions) {
  const rows = new Map();
  for (const d of decisions) {
    if (d.decision !== "DISPUTED" || d.values?.length !== 2) continue;
    const pair = d.answers.filter((a) => a.result?.[d.trigger.field] != null).map((a) => ({ miner_id: a.miner_id, miner_name: a.miner_name, value: Number(a.result[d.trigger.field]) }));
    if (pair.length !== 2) continue;
    const key = JSON.stringify([d.intent, d.params, pair.map((p) => String(p.miner_id)).sort()]);
    const row = rows.get(key) ?? { intent: d.intent, params: d.params, field: d.trigger.field, times: 0 };
    rows.set(key, { ...row, times: row.times + 1, at: d.at, id: idOf(d), reason: d.reason, answers: pair }); // decisions are in time order, so the last one wins
  }
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}
