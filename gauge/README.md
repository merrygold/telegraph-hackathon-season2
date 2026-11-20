# Gauge

A Telegraph miner for parametric cover triggers. Every answer is a value checked on two keyless public sources, or a clear error.

**Registered and active on the Telegraph testnet (Ethereum Sepolia): miner id 4283, registration id 5291 (re-registered 16 November 2026 for the new host; old registration 5188 is superseded).** Live at https://gauge.129.121.144.223.sslip.io. Do not edit `gauge.yaml`: the registered hash is the SHA-256 of that file as served; every edit means a new registration and a new 7-day grace period.

| Intent | Route | What it returns | Sources |
|---|---|---|---|
| `MINING_HASHPRICE_VERIFY_GENERAL` | `GET /hashprice?block_height=N` | Hashprice at exactly that block, in sats per PH/s per day | blockstream.info (what the coinbase paid) and blockchain.info (subsidy plus fees). They must agree within 0.1%. |
| `LIVE_PORT_CONGESTION_GENERAL` | `GET /port-congestion?port=Helsinki` | Vessels waiting, average wait in hours, congestion level | Fintraffic Digitraffic port calls, checked against Digitraffic AIS |
| `WEATHER_CHECK_TEMPERATURE` | `GET /temperature?location=Longreach, Queensland, Australia` | Current air temperature at 2 m, in °C | Open-Meteo and MET Norway for the same point. They must agree within 2 °C. Both are weather-model analyses, not a station reading |
| `CRYPTO_PRICE_USD` | `GET /crypto-price?symbol=USDC` | Price in US dollars | Last trade on Kraken and on Bitstamp. They must agree within 0.5% |
| `FX_NOW_EUR` | `GET /fx?currency=EUR` | How many euros one US dollar buys (about 0.9, not the inverse) | ECB reference rate (via Frankfurter) and the Fawaz Ahmed currency feed. They must agree within 1%, because the ECB rate is set once a day |

## Why it exists

Paid probes on 11 November 2026 (receipts in `../tripwire/ledger.jsonl`):

- **Hashprice.** The miner that gets most routed traffic answered 46,871 for block 975340 and returned no block height. The block's real value is 42,706.575305. It was reporting a current figure, not the block asked for.
- **Euro rate.** One miner returned 1.1127 for an intent that asks how many euros a dollar buys (0.8987): the rate upside down.
- **Port waiting time.** Only two miners return the intent's format. For Helsinki at the same minute one said 1,426.4 hours and the other 5.6. The large figure comes from counting stale port-call records as ships still waiting.

## Run

```
node gauge.mjs            # http://localhost:8788
node --test               # the maths, offline
```

No dependencies. Node 20 or later.

## How the port figure is worked out

- A vessel is **waiting** when its ETA has passed, the port has recorded no arrival, and AIS shows it at anchor in a position less than 6 hours old. A stale record cannot count, because a ship that is not there has no AIS position at anchor.
- `wait_hours` is the mean of: how many hours each arrival in the last 72 hours berthed after its ETA (never below 0), and hours past ETA for each waiting vessel.
- `congestion_level`: under 2 hours low, under 12 moderate, under 48 high, otherwise severe.

Limits, stated plainly: Finnish ports only (all of them, by name or UN/LOCODE), because Digitraffic is the one keyless feed with both port calls and AIS. ETAs are updated by ships' agents as they approach, so lateness against ETA understates delay against the original schedule.

## Errors

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_params` | Missing or malformed parameter |
| 404 | `block_not_found` | The block is not mined yet |
| 404 | `no_recent_port_calls` | The port had no arrivals in 72 hours and nothing waiting |
| 422 | `port_not_covered` | Not a Finnish port |
| 422 | `location_not_found` | No place matches the name, or its region or country words do not fit |
| 422 | `not_covered` | The asset or currency is not published by both sources |
| 502 | `sources_disagree` | The two sources differ by more than the limit for that answer |
| 502 | `sources_unavailable` | Fewer than the sources needed could be reached. Temperature, price and the euro rate always need both |

## Files

- `gauge.mjs`: the server and the source calls
- `logic.mjs`: the maths, place matching and the two-source rule (`agree`), with `logic.test.mjs` (5 tests, offline)
- `index.html`: the home page with a form for each question
- `gauge.yaml`: the miner registration file, also served at `/gauge.yaml`
