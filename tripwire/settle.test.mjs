// node --test   (no network, no payment: the paid calls are replaced by fakes)
import test from "node:test";
import assert from "node:assert/strict";
process.env.EVM_PRIVATE_KEY ??= "0x" + "11".repeat(32); // telegraph.mjs builds an account on import; nothing is signed here
const { settle } = await import("./settle.mjs");

const reply = (id, value, ok = true) => ({ ok, status: ok ? 200 : 503, cost_usd: ok ? 0.01 : 0, receipt: { receipt_hash: "0xr" + id, tx_hash: "0xt" + id },
  body: ok ? { miner_id: String(id), miner_name: "M" + id, result: { v: value }, signal_hash: "0xs" + id } : { error: "no_compatible_miner" } });
// A fake network: `routed` answers /ask, `byId` answers /ask/{id}. Records who was asked.
const fake = (routed, byId) => {
  const asked = [], saved = [], sent = [];
  return { asked, saved, sent, io: {
    paid: () => undefined, payouts: () => true,
    transfer: async (to, usd) => { sent.push([to, usd]); return "0xpaid"; },
    ask: async () => { asked.push("auto"); return routed; },
    askMiner: async (id) => { asked.push(id); return byId[id]; },
    save: (r) => saved.push(r),
  } };
};
const cover = (over = {}) => ({ name: "t", intent: "X", params: {}, trigger: { field: "v", op: ">", threshold: 10, tolerance: 0.1 }, corroborators: [1, 2, 3], ...over });

test("no breach: one purchase, no second answer", async () => {
  const f = fake(reply(1, 5), {});
  const r = await settle(cover(), undefined, f.io);
  assert.equal(r.decision, "NO_PAY");
  assert.deepEqual(f.asked, ["auto"]);
  assert.equal(r.cost_usd, 0.01);
  assert.equal(f.saved.length, 1);
});

test("breach: skips the miner that answered first, falls through a failed corroborator, pays on agreement", async () => {
  const f = fake(reply(1, 20), { 2: reply(2, 0, false), 3: reply(3, 20.5) });
  const events = [];
  const r = await settle(cover(), (e) => events.push(e.stage + (e.n ?? "")), f.io);
  assert.equal(r.decision, "PAY");
  assert.deepEqual(f.asked, ["auto", 2, 3]); // never asks miner 1 again
  assert.deepEqual(r.answers.map((a) => a.miner_id), ["1", undefined, "3"]);
  assert.deepEqual(events, ["ask1", "answer1", "ask2", "answer2", "ask3", "answer3", "decide"]);
  assert.equal(r.cost_usd, 0.02);
});

test("named primary is asked by id; disagreement is DISPUTED", async () => {
  const f = fake(null, { 9: reply(9, 20), 1: reply(1, 5) });
  const r = await settle(cover({ primary: 9 }), undefined, f.io);
  assert.equal(r.decision, "DISPUTED");
  assert.deepEqual(f.asked, [9, 1]);
});

test("always: a safe first answer still gets a second, and opposite sides are DISPUTED", async () => {
  const f = fake(reply(1, 5), { 2: reply(2, 20) });
  const r = await settle(cover({ trigger: { field: "v", op: ">", threshold: 10, tolerance: 0.1, always: true } }), undefined, f.io);
  assert.equal(r.decision, "DISPUTED");
  assert.deepEqual(f.asked, ["auto", 2]);
});

test("no answer at all: NO_DATA", async () => {
  const f = fake(reply(1, 0, false), {});
  assert.equal((await settle(cover(), undefined, f.io)).decision, "NO_DATA");
});

const pays = { name: "t", payout: { to: "0xbeef", usd: 0.05 } }, agree = () => fake(reply(1, 20), { 2: reply(2, 20) });

test("PAY with a payout: one transfer, recorded with its transaction", async () => {
  const f = agree(), events = [];
  const r = await settle(cover(pays), (e) => events.push(e.stage), f.io);
  assert.deepEqual(f.sent, [["0xbeef", 0.05]]);
  assert.deepEqual(r.payout, { to: "0xbeef", usd: 0.05, tx_hash: "0xpaid" });
  assert.deepEqual(events.slice(-2), ["decide", "payout"]);
  assert.deepEqual(f.saved[0].payout, r.payout);
});

test("no transfer when the decision is not PAY, when the cover already paid, or when payouts are off", async () => {
  const no = fake(reply(1, 5), {});
  assert.equal((await settle(cover(pays), undefined, no.io)).payout, undefined);
  const twice = agree(); twice.io.paid = (name) => name === "t" && "0xfirst";
  assert.deepEqual((await settle(cover(pays), undefined, twice.io)).payout, { to: "0xbeef", usd: 0.05, skipped: "this cover has already paid out", tx_hash: "0xfirst" });
  const off = agree(); off.io.payouts = () => false;
  assert.match((await settle(cover(pays), undefined, off.io)).payout.skipped, /switched off/);
  assert.deepEqual([no.sent, twice.sent, off.sent], [[], [], []]);
});

test("a failed transfer keeps the decision and records the error", async () => {
  const f = agree(); f.io.transfer = async () => { throw new Error("insufficient funds"); };
  const r = await settle(cover(pays), undefined, f.io);
  assert.equal(r.decision, "PAY");
  assert.equal(r.payout.error, "insufficient funds");
  assert.equal(f.saved.length, 1);
});

test("records who started the check", async () => {
  assert.equal((await settle(cover(), undefined, fake(reply(1, 5), {}).io)).by, "request");
  assert.equal((await settle(cover({ by: "schedule" }), undefined, fake(reply(1, 5), {}).io)).by, "schedule");
});
