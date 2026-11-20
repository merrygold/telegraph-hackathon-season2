// Reads plain cover wording into a cover Tripwire can settle. Pure and deterministic on purpose:
// the payout rule is read by code anyone can audit, and only the measured value is bought.
// (A paid CONTENT_EXTRACTION_GENERAL answer was tried for this and returned "values: 38 degrees".)

// One entry per kind of trigger. `miners` are the ones probed live.
const KINDS = [
  {
    match: /hashprice/i, mission: "12 Mining & Power", intent: "MINING_HASHPRICE_VERIFY_GENERAL", field: "hashprice_sats_per_ph_day",
    unit: /sats?/i, tolerance: { tolerance: 0.02 }, primary: 71083, corroborators: [4283, 71083, 9002],
    params: (t) => ({ block_height: Number(t.match(/block\s+(?:height\s+)?#?(\d{1,9})/i)?.[1]) || "$BTC_TIP" }),
  },
  {
    match: /temperature|heat/i, mission: "06 Resources & Agriculture", intent: "WEATHER_CHECK_TEMPERATURE", field: "temperature_c",
    unit: /°\s*c|degrees|celsius/i, tolerance: { abs_tolerance: 1 }, primary: 78214, corroborators: [4283, 78214, 20260828],
    params: (t) => ({ location: t.match(/\b(?:at|in|near)\s+([A-Z][^.;]*?)(?=\s+(?:is|rises?|goes|climbs|falls?|drops?|exceeds?|reaches)\b|\s*[.;]|$)/)?.[1] }), // place before the verb, or closing the sentence
  },
  { // miners probed 11 Nov: 302 and 9002 agree to 0.1%; 32001 only answers when the network routes to it. Many CRYPTO_PRICE miners are fixed to one symbol and reject this.
    match: /\b(USDC|USDT|DAI)\b/, mission: "02 Stablecoin", intent: "CRYPTO_PRICE_USD", field: "price_usd",
    unit: /^(us|usd|dollars?)\b/i, tolerance: { abs_tolerance: 0.005 }, primary: 302, corroborators: [4283, 9002, 32001],
    params: (t) => ({ symbol: t.match(/\b(USDC|USDT|DAI)\b/)[1] }),
  },
  { // any other coin, named as "price of BTC". Probed 12 Nov: 302 answers BTC and ETH, 9002 and Gauge answer SOL. A coin no miner knows settles as NO_DATA.
    match: /\bprice of [A-Z]{2,6}\b/, intent: "CRYPTO_PRICE_USD", field: "price_usd",
    unit: /^(us|usd|dollars?)\b/i, tolerance: { tolerance: 0.01 }, primary: 302, corroborators: [4283, 9002],
    params: (t) => ({ symbol: t.match(/\bprice of ([A-Z]{2,6})\b/)[1] }),
  },
  { // euros only: FX_NOW_EUR is the one FX intent probed. Miner 7370 answers the inverse (USD per EUR), so it is not listed.
    match: /dollar buys|exchange rate/i, mission: "03 Institutional Markets", intent: "FX_NOW_EUR", field: "rate",
    unit: /^(eur|euros?)\b/i, tolerance: { tolerance: 0.01 }, primary: 78222, corroborators: [4283, 7310043, 20260828],
    params: () => ({ currency: "EUR" }),
  },
  {
    match: /wait|congestion|delay/i, mission: "08 Commodities", intent: "LIVE_PORT_CONGESTION_GENERAL", field: "wait_hours",
    unit: /hours?/i, tolerance: { tolerance: 0.25 }, primary: 20260828, corroborators: [4283, 20260828, 302],
    params: (t) => ({ port: t.match(/\b[Pp]ort of\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*)*)/)?.[1] }),
  },
];

const ABOVE = /\b(above|exceeds?|over|more than|greater than|higher than)\s+([\d][\d,]*(?:\.\d+)?)\s*(\S+)?/i;
const BELOW = /\b(below|under|less than|lower than)\s+([\d][\d,]*(?:\.\d+)?)\s*(\S+)?/i;

// Returns { cover } or { error }.
export function parseCover(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 20 || t.length > 2000) return { error: "paste 20 to 2,000 characters of cover wording" };
  const kind = KINDS.find((k) => k.match.test(t));
  if (!kind) return { error: "no trigger found: the wording must name hashprice, temperature, port waiting time, the price of a coin (for example: the price of BTC), or what one US dollar buys in euros" };
  const up = t.match(ABOVE), down = t.match(BELOW);
  if (!up === !down) return { error: "no single threshold found: say 'above N' or 'below N' once" };
  const [, , number, unit] = up ?? down;
  if (!kind.unit.test(unit ?? "")) return { error: `the threshold needs a unit that fits ${kind.field}` };
  const params = kind.params(t);
  const missing = Object.keys(params).find((k) => params[k] == null);
  if (missing) return { error: `could not read the ${missing} from the wording` };
  return {
    cover: {
      name: t.slice(0, 80), mission: kind.mission, intent: kind.intent, params,
      trigger: { field: kind.field, op: up ? ">" : "<", threshold: Number(number.replace(/,/g, "")), ...kind.tolerance },
      primary: kind.primary, corroborators: kind.corroborators,
    },
  };
}
