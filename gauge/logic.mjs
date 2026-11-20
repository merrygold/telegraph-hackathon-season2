// Pure maths for Gauge. No network here, so it can be tested offline.

// Bitcoin block subsidy in sats at a height (halves every 210,000 blocks).
export const subsidy = (height) => Math.floor(50e8 / 2 ** Math.floor(height / 210_000));

// Difficulty from the compact "bits" field of a block header.
export function difficulty(bits) {
  const exp = bits >>> 24, mantissa = bits & 0xffffff;
  return (0xffff * 2 ** 208) / (mantissa * 2 ** (8 * (exp - 3)));
}

// Hashprice: what 1 PH/s earns in a day if every block paid like this one.
// Network hashrate = difficulty * 2^32 / 600 hashes per second; 144 blocks a day.
export function hashprice(rewardSats, diff) {
  const hashrate = (diff * 2 ** 32) / 600; // H/s
  return {
    hashprice_sats_per_ph_day: +((rewardSats * 144) / (hashrate / 1e15)).toFixed(6),
    hashrate_eh_s: +(hashrate / 1e18).toFixed(6),
  };
}

// Port waiting time from Digitraffic port calls plus AIS.
//   calls: raw port calls for one port. ais: Map mmsi -> { navStat, at } (at = ms).
// A vessel counts as waiting when its ETA has passed, the port has not recorded an arrival,
// and AIS says it is at anchor (navStat 1) in a position less than 6 hours old.
// Arrivals in the last 72 hours contribute how late they berthed against their ETA (never below 0).
const H = 3_600_000;
export function portWait(calls, ais, now) {
  const samples = [];
  let waiting = 0, arrivals = 0;
  for (const c of calls)
    for (const d of c.portAreaDetails ?? []) {
      const eta = Date.parse(d.eta), ata = Date.parse(d.ata);
      if (Number.isNaN(eta)) continue;
      if (!Number.isNaN(ata)) {
        if (ata > now - 72 * H && ata <= now) { arrivals++; samples.push(Math.max(0, ata - eta) / H); }
      } else if (eta < now && eta > now - 7 * 24 * H) {
        const v = ais.get(c.mmsi);
        if (v?.navStat === 1 && v.at > now - 6 * H) { waiting++; samples.push((now - eta) / H); }
      }
    }
  if (!samples.length) return null;
  const wait_hours = +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2);
  const congestion_level = wait_hours < 2 ? "low" : wait_hours < 12 ? "moderate" : wait_hours < 48 ? "high" : "severe";
  return { vessels_waiting: waiting, wait_hours, congestion_level, arrivals_72h: arrivals };
}

// Port name or UN/LOCODE -> { locode, name }, from a list of { locode, name }.
export function findPort(ports, q) {
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) return null;
  return ports.find((p) => p.locode.toLowerCase() === s)
    ?? ports.find((p) => p.name.toLowerCase().split(/[\s(),/-]+/).includes(s))
    ?? ports.find((p) => p.name.toLowerCase().includes(s))
    ?? null;
}

// "Longreach, Queensland, Australia" -> the geocoder result whose region and country fit the words after the first comma.
// results: Open-Meteo geocoding rows for the first word group. Returns null when nothing fits, so Gauge can refuse.
export function pickPlace(results, location) {
  const [, ...rest] = String(location).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const fits = (r) => rest.every((w) => [r.admin1, r.admin2, r.country, r.country_code].some((x) => x?.toLowerCase() === w));
  return (results ?? []).find(fits) ?? null;
}

// The value of the hourly reading nearest to `now`, or null if none is within 90 minutes.
export function nearest(series, now) {
  const best = (series ?? []).reduce((a, b) => (!a || Math.abs(b.at - now) < Math.abs(a.at - now) ? b : a), null);
  return best && Math.abs(best.at - now) <= 90 * 60_000 ? best.value : null;
}

// An error with an HTTP status and a short code, returned to the caller as JSON.
export class Fail extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// Two sources that must both answer and agree within maxPct percent; returns their mean and the evidence.
export async function agree(sources, maxPct, digits) {
  const got = await Promise.allSettled(Object.entries(sources).map(async ([name, f]) => ({ name, value: Number(await f()) })));
  const ok = got.filter((g) => g.status === "fulfilled" && Number.isFinite(g.value.value) && g.value.value > 0).map((g) => g.value);
  if (ok.length < 2) {
    // "Not listed" is a 404, or a 200 with no usable number.
    if (got.every((g) => (g.status === "fulfilled" ? !(g.value.value > 0) : g.reason?.status === 404))) throw new Fail(422, "not_covered", "neither source lists this");
    throw new Fail(502, "sources_unavailable", `needs two sources, got ${ok.length}: ${got.map((g) => g.reason?.message ?? "ok").join("; ")}`);
  }
  const vals = ok.map((s) => s.value), spread_pct = +(((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100).toFixed(4);
  if (spread_pct > maxPct) throw new Fail(502, "sources_disagree", `sources differ by ${spread_pct}%: ${ok.map((s) => `${s.name} ${s.value}`).join(", ")}`);
  return { value: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(digits), sources: ok, spread_pct, as_of: new Date().toISOString() };
}
