// Gauge: a Telegraph miner that answers from observed public data, two sources per answer.
//   node gauge.mjs      then  http://localhost:8788/hashprice?block_height=975340
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { subsidy, difficulty, hashprice, portWait, findPort, pickPlace, nearest, Fail, agree } from "./logic.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const UA = { "User-Agent": "gauge-miner/1.0", "Digitraffic-User": "gauge-miner/1.0", "Accept-Encoding": "gzip" };


async function get(url, as = "json") {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) throw new Fail(404, "not_found", `${new URL(url).host} has no such record`);
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return as === "text" ? r.text() : r.json();
}

// ---- MINING_HASHPRICE_VERIFY_GENERAL ----
// Two independent chain indexers, and two ways to get the block reward:
// Blockstream gives what the coinbase transaction actually paid; Blockchain.com gives subsidy + fees.
const BS = "https://blockstream.info/api";
const blockSources = {
  "blockstream.info": async (h) => {
    const hash = await get(`${BS}/block-height/${h}`, "text");
    const [block, coinbase] = await Promise.all([get(`${BS}/block/${hash}`), get(`${BS}/block/${hash}/txs/0`)]);
    return { bits: block.bits, reward: coinbase[0].vout.reduce((s, o) => s + o.value, 0) };
  },
  "blockchain.info": async (h) => {
    const b = await get(`https://blockchain.info/rawblock/${h}?format=json`);
    return { bits: b.bits, reward: subsidy(h) + b.fee };
  },
};
const blockCache = new Map(); // ponytail: unbounded, blocks never change; cap it if memory matters

async function hashpriceAt(q) {
  const h = Number(q.get("block_height"));
  if (!Number.isInteger(h) || h < 0 || h > 100_000_000) throw new Fail(400, "invalid_params", "block_height must be a whole number, 0 or more");
  if (blockCache.has(h)) return blockCache.get(h);
  const got = await Promise.allSettled(Object.entries(blockSources).map(async ([name, f]) => {
    const { bits, reward } = await f(h);
    return { name, ...hashprice(reward, difficulty(bits)), fetched_at: new Date().toISOString() };
  }));
  const ok = got.filter((g) => g.status === "fulfilled").map((g) => g.value);
  if (!ok.length) {
    if (got.every((g) => g.reason?.status === 404)) throw new Fail(404, "block_not_found", `block ${h} has not been mined yet`);
    throw new Fail(502, "sources_unavailable", got.map((g) => g.reason.message).join("; "));
  }
  const vals = ok.map((s) => s.hashprice_sats_per_ph_day);
  const spread_pct = +(((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100).toFixed(6);
  if (spread_pct > 0.1) throw new Fail(502, "sources_disagree", `sources differ by ${spread_pct}%: ${ok.map((s) => `${s.name} ${s.hashprice_sats_per_ph_day}`).join(", ")}`);
  const out = {
    hashprice_sats_per_ph_day: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6),
    block_height: h,
    hashrate_eh_s: ok[0].hashrate_eh_s,
    hashprice_usd_per_ph_day: null,
    sources: ok.map((s) => ({ name: s.name, value: s.hashprice_sats_per_ph_day, fetched_at: s.fetched_at })),
    spread_pct,
    method: "block reward (subsidy + fees) x 144 / network hashrate from the block's difficulty",
  };
  if (ok.length === 2) blockCache.set(h, out); // only cache a fully corroborated answer
  return out;
}

// ---- LIVE_PORT_CONGESTION_GENERAL ----
// Finnish ports only: Digitraffic (Fintraffic) is the one keyless public feed with both port calls and AIS.
const DT = "https://meri.digitraffic.fi/api";
let ports = null, portsAt = 0;
async function finnishPorts() {
  if (!ports || Date.now() - portsAt > 86_400_000) {
    const d = await get(`${DT}/port-call/v1/ports`);
    ports = d.ssnLocations.features.filter((f) => f.locode.startsWith("FI")).map((f) => ({ locode: f.locode, name: f.properties.locationName }));
    portsAt = Date.now();
  }
  return ports;
}

async function portCongestion(q) {
  const name = q.get("port");
  if (!name) throw new Fail(400, "invalid_params", "port is required: a Finnish port name or UN/LOCODE such as Helsinki or FIHEL");
  const port = findPort(await finnishPorts(), name);
  if (!port) throw new Fail(422, "port_not_covered", `"${name.slice(0, 80)}" is not a Finnish port. Gauge covers ports reported by Fintraffic Digitraffic only.`);
  const now = Date.now();
  const from = new Date(now - 7 * 86_400_000).toISOString();
  const { portCalls } = await get(`${DT}/port-call/v1/port-calls?locode=${port.locode}&from=${from}`);
  // AIS is only needed for vessels that are past their ETA with no recorded arrival.
  const overdue = [...new Set(portCalls.filter((c) => c.mmsi && c.portAreaDetails?.some((d) => !d.ata && Date.parse(d.eta) < now)).map((c) => c.mmsi))].slice(0, 40);
  const ais = new Map();
  await Promise.all(overdue.map(async (mmsi) => {
    try {
      const f = (await get(`${DT}/ais/v1/locations?mmsi=${mmsi}`)).features?.[0];
      if (f) ais.set(mmsi, { navStat: f.properties.navStat, at: f.properties.timestampExternal });
    } catch { /* no AIS fix: the vessel is simply not counted as waiting */ }
  }));
  const w = portWait(portCalls, ais, now);
  if (!w) throw new Fail(404, "no_recent_port_calls", `${port.name} (${port.locode}) has no arrivals in the last 72 hours and no vessel waiting`);
  return {
    port: `${port.name} (${port.locode})`, ...w, as_of: new Date(now).toISOString(),
    sources: ["Fintraffic Digitraffic port calls", "Fintraffic Digitraffic AIS"],
    method: "mean of: hours each arrival in the last 72 h berthed after its ETA, and hours past ETA for vessels now at anchor",
  };
}

// ---- WEATHER_CHECK_TEMPERATURE ----
// Two independent weather services for the same point: Open-Meteo and MET Norway. Both publish a current
// analysis for any place on Earth with no key. They must agree within 2 °C, or Gauge refuses.
async function temperature(q) {
  const location = (q.get("location") ?? "").trim().slice(0, 120);
  if (location.length < 2) throw new Fail(400, "invalid_params", "location is required: a place name such as Longreach, Queensland, Australia");
  const geo = await get(`https://geocoding-api.open-meteo.com/v1/search?count=10&name=${encodeURIComponent(location.split(",")[0].trim())}`);
  const place = pickPlace(geo.results, location);
  if (!place) throw new Fail(422, "location_not_found", `no place matches "${location}". Use a town name, optionally followed by its region and country.`);
  const lat = place.latitude.toFixed(4), lon = place.longitude.toFixed(4), now = Date.now();
  const sources = {
    "open-meteo.com": async () => (await get(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`)).current.temperature_2m,
    "api.met.no": async () => nearest((await get(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`)).properties.timeseries
      .map((t) => ({ at: Date.parse(t.time), value: t.data.instant.details.air_temperature })), now),
  };
  const got = await Promise.allSettled(Object.entries(sources).map(async ([name, f]) => ({ name, value: await f() })));
  const ok = got.filter((g) => g.status === "fulfilled" && Number.isFinite(g.value.value)).map((g) => g.value);
  // One source is never enough for this answer: the point of Gauge is the second reading.
  if (ok.length < 2) throw new Fail(502, "sources_unavailable", `needs two sources, got ${ok.length}: ${got.map((g) => g.reason?.message ?? "ok").join("; ")}`);
  const vals = ok.map((s) => s.value), spread_c = +(Math.max(...vals) - Math.min(...vals)).toFixed(1);
  if (spread_c > 2) throw new Fail(502, "sources_disagree", `sources differ by ${spread_c} °C: ${ok.map((s) => `${s.name} ${s.value}`).join(", ")}`);
  return {
    temperature_c: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "), latitude: +lat, longitude: +lon,
    as_of: new Date(now).toISOString(), sources: ok, spread_c,
    method: "mean of two weather services' current air temperature at 2 m for the same point; refused if they differ by more than 2 °C",
  };
}

// ---- CRYPTO_PRICE_USD ----
// Last trade on two exchanges that quote directly in US dollars: Kraken and Bitstamp.
async function cryptoPrice(q) {
  const symbol = (q.get("symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Fail(400, "invalid_params", "symbol is required: an asset symbol such as USDC or BTC");
  const { value, ...rest } = await agree({
    "kraken.com": async () => {
      const d = await get(`https://api.kraken.com/0/public/Ticker?pair=${symbol}USD`);
      if (d.error?.length) throw new Fail(404, "not_found", "kraken.com: " + d.error[0]);
      return Object.values(d.result)[0].c[0];
    },
    "bitstamp.net": async () => (await get(`https://www.bitstamp.net/api/v2/ticker/${symbol.toLowerCase()}usd/`)).last,
  }, 0.5, 6).catch((e) => { if (e.code === "not_covered") e.message = `${symbol} is not quoted in US dollars on both Kraken and Bitstamp`; throw e; });
  return { price_usd: value, symbol, ...rest, method: "mean of the last trade in US dollars on two exchanges; refused if they differ by more than 0.5%" };
}

// ---- FX_NOW_* ----
// How much of a currency one US dollar buys: the ECB reference rate (via Frankfurter) and the Fawaz Ahmed currency feed.
async function fx(q) {
  const currency = (q.get("currency") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USD") throw new Fail(400, "invalid_params", "currency is required: a three-letter code other than USD, such as EUR");
  const { value, ...rest } = await agree({
    "frankfurter.app (ECB)": async () => {
      const d = await get(`https://api.frankfurter.app/latest?from=USD&to=${currency}`);
      if (!d.rates?.[currency]) throw new Fail(404, "not_found", "frankfurter.app has no such currency");
      return d.rates[currency];
    },
    "currency-api (Fawaz Ahmed)": async () => {
      const v = (await get("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json")).usd[currency.toLowerCase()];
      if (!v) throw new Fail(404, "not_found", "currency-api has no such currency");
      return v;
    },
  }, 1, 6).catch((e) => { if (e.code === "not_covered") e.message = `${currency} is not a currency both sources publish`; throw e; }); // 1%: the ECB rate is set once a day
  return { rate: value, currency, ...rest, method: `mean of two reference feeds: how many ${currency} one US dollar buys; refused if they differ by more than 1%` };
}

const routes = { "/hashprice": hashpriceAt, "/port-congestion": portCongestion, "/temperature": temperature, "/crypto-price": cryptoPrice, "/fx": fx, "/health": async () => ({ ok: true }) };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  // The registered YAML is served from here, byte for byte, so its hash matches what the node downloads.
  if (req.method === "GET" && url.pathname === "/gauge.yaml")
    return res.writeHead(200, { "Content-Type": "text/yaml" }).end(readFileSync(new URL("./gauge.yaml", import.meta.url)));
  if (req.method === "GET" && url.pathname === "/") // a page for people; agents use the routes below
    return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(readFileSync(new URL("./index.html", import.meta.url)));
  const handler = req.method === "GET" && routes[url.pathname];
  if (!handler) return send(404, { error: "not_found", message: `routes: ${Object.keys(routes).join(", ")}` });
  try {
    send(200, await handler(url.searchParams));
  } catch (e) {
    send(e.status ?? 502, { error: e.code ?? "upstream_error", message: e.message });
  }
}).listen(PORT, () => console.log(`Gauge on http://localhost:${PORT}`));
