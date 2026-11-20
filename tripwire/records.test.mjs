// node --test
import test from "node:test";
import assert from "node:assert/strict";
import { idOf, totals, disagreements } from "./records.mjs";

const ans = (id, v, cost = 0.01) => ({ miner_id: String(id), miner_name: "M" + id, result: v == null ? undefined : { h: v }, cost_usd: cost });
const rec = (over) => ({ at: "2026-11-11T10:00:00.000Z", cover: "c", intent: "PORT", params: { port: "Helsinki" }, trigger: { field: "h" }, decision: "NO_PAY", values: [1], cost_usd: 0.01, answers: [ans(1, 1)], ...over });
const dispute = (at, a, b) => rec({ at, decision: "DISPUTED", reason: "miners differ", values: [a[1], b[1]], cost_usd: 0.02, answers: [ans(...a), ans(...b)] });

test("idOf is stable and differs between records", () => {
  assert.equal(idOf(rec()), idOf(JSON.parse(JSON.stringify(rec()))));
  assert.notEqual(idOf(rec()), idOf(rec({ at: "2026-11-11T10:00:01.000Z" })));
  assert.match(idOf(rec()), /^[0-9a-f]{12}$/);
});

test("totals split requests from the schedule and count only real payouts", () => {
  const t = totals([
    rec(), // before labelling
    rec({ by: "request", answers: [ans(1, 1), ans(2, null, 0)] }),
    rec({ by: "schedule", decision: "PAY", payout: { tx_hash: "0xa" } }),
    rec({ by: "request", decision: "PAY", payout: { tx_hash: "0xa", skipped: "this cover has already paid out" } }),
  ]);
  assert.deepEqual(t, { decisions: 4, by_request: 2, by_schedule: 1, unlabelled: 1, paid_requests: 4, spent_usd: 0.04, payouts: 1 });
});

test("disagreements group by question and miner pair, newest case kept", () => {
  const rows = disagreements([
    dispute("2026-11-11T10:00:00.000Z", [9002, 965.2], [4283, 0.06]),
    rec(),
    dispute("2026-11-11T12:00:00.000Z", [4283, 0.07], [9002, 960]), // same pair, other order
    rec({ decision: "DISPUTED", values: [5], reason: "not corroborated: no second answer" }), // one value only: not a disagreement
    dispute("2026-11-11T11:00:00.000Z", [9002, 965.2], [302, 3]),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].times, rows[0].at, rows[0].answers.map((a) => a.value)], [2, "2026-11-11T12:00:00.000Z", [0.07, 960]]);
  assert.equal(rows[1].times, 1);
});
