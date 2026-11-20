// node --test
import test from "node:test";
import assert from "node:assert/strict";
import { subsidy, difficulty, hashprice, portWait, findPort } from "./logic.mjs";

test("hashprice matches block 975340", () => {
  assert.equal(subsidy(975340), 312_500_000);
  assert.equal(subsidy(0), 5_000_000_000);
  const r = hashprice(subsidy(975340) + 2_471_342, difficulty(386000300));
  assert.equal(r.hashprice_sats_per_ph_day, 42706.575305); // same value two live miners report
  assert.equal(r.hashrate_eh_s, 1062.034896);
});

test("portWait", () => {
  const now = Date.parse("2026-11-11T00:00:00Z");
  const call = (mmsi, eta, ata) => ({ mmsi, portAreaDetails: [{ eta, ata }] });
  const ais = new Map([[1, { navStat: 1, at: now - 60_000 }], [2, { navStat: 5, at: now }], [3, { navStat: 1, at: now - 7 * 3_600_000 }]]);
  const calls = [
    call(9, "2026-11-10T10:00:00Z", "2026-11-10T12:00:00Z"), // berthed 2 h late
    call(8, "2026-11-10T10:00:00Z", "2026-11-10T09:00:00Z"), // early counts as 0
    call(1, "2026-11-10T20:00:00Z", null), // at anchor, 4 h past ETA
    call(2, "2026-11-10T20:00:00Z", null), // moored, arrival just not recorded yet
    call(3, "2026-11-10T20:00:00Z", null), // AIS position too old
    call(7, "2026-09-01T00:00:00Z", null), // stale record
    call(6, "2026-11-01T00:00:00Z", "2026-11-01T05:00:00Z"), // arrived too long ago
  ];
  assert.deepEqual(portWait(calls, ais, now), { vessels_waiting: 1, wait_hours: 2, congestion_level: "moderate", arrivals_72h: 2 });
  assert.equal(portWait([], ais, now), null);
});

test("findPort", () => {
  const ports = [{ locode: "FIHEL", name: "Helsinki (Helsingfors)" }, { locode: "FIKOK", name: "Kokkola (Karleby)" }, { locode: "FIKTK", name: "Kotka" }];
  assert.equal(findPort(ports, "helsinki").locode, "FIHEL");
  assert.equal(findPort(ports, " FIKTK ").locode, "FIKTK");
  assert.equal(findPort(ports, "Karleby").locode, "FIKOK");
  assert.equal(findPort(ports, "Rotterdam"), null);
  assert.equal(findPort(ports, ""), null);
});

test("pickPlace and nearest", async () => {
  const { pickPlace, nearest } = await import("./logic.mjs");
  const rows = [{ name: "Longreach Island", admin1: "New South Wales", country: "Australia", country_code: "AU" }, { name: "Longreach", admin1: "Queensland", country: "Australia", country_code: "AU" }];
  assert.equal(pickPlace(rows, "Longreach, Queensland, Australia").admin1, "Queensland");
  assert.equal(pickPlace(rows, "Longreach").name, "Longreach Island"); // no qualifier: the geocoder's first result
  assert.equal(pickPlace(rows, "Longreach, Texas"), null);
  assert.equal(pickPlace([], "Nowhere"), null);
  const now = Date.parse("2026-11-11T17:40:00Z");
  assert.equal(nearest([{ at: now - 40 * 60_000, value: 26.1 }, { at: now + 20 * 60_000, value: 25.8 }], now), 25.8);
  assert.equal(nearest([{ at: now - 3 * 3_600_000, value: 30 }], now), null);
});

test("agree: two sources or an error", async () => {
  const { agree, Fail } = await import("./logic.mjs");
  const ok = await agree({ a: async () => "100", b: async () => 100.2 }, 0.5, 2);
  assert.equal(ok.value, 100.1);
  assert.equal(ok.spread_pct, 0.2);
  assert.deepEqual(ok.sources.map((s) => s.name), ["a", "b"]);
  const code = (p) => p.then(() => "no error", (e) => e.code);
  assert.equal(await code(agree({ a: async () => 100, b: async () => 101 }, 0.5, 2)), "sources_disagree");
  assert.equal(await code(agree({ a: async () => 100, b: async () => { throw new Error("down"); } }, 0.5, 2)), "sources_unavailable"); // one source is never enough
  assert.equal(await code(agree({ a: async () => { throw new Fail(404, "not_found", "x"); }, b: async () => undefined }, 0.5, 2)), "not_covered");
  assert.equal(await code(agree({ a: async () => 0, b: async () => -1 }, 0.5, 2)), "not_covered"); // no usable number anywhere
});
