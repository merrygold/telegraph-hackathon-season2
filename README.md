# Tripwire: settle "pays if a number crosses a line" contracts with bought evidence

Entries for **Telegraph Hackathon Season II**, one in each track, built around one idea. Everything runs on **Ethereum Sepolia testnet with test tokens only**. No real money is involved anywhere.

Many contracts say "pay if a number crosses a line": hashprice under a floor, a port holding ships more than 48 hours, a coin losing its peg. A person usually checks the number. Tripwire is an agent that buys the number over x402, checks it with a second independent miner, and records PAY, NO_PAY, DISPUTED or NO_DATA with a payment receipt for every answer.

| Track | Name | Folder | Live |
|---|---|---|---|
| Apps & Agents | **Tripwire** | [`tripwire/`](tripwire/) | https://tripwire.129.121.144.223.sslip.io |
| Miners | **Gauge** | [`gauge/`](gauge/) | https://gauge.129.121.144.223.sslip.io (miner id 4283, registration 5291) |
| Evaluators | **Tripwire Measure** | [`measure/`](measure/) | https://measure.129.121.144.223.sslip.io |

## How a cover is settled

1. **Read the wording.** Fixed rules (no model) turn a sentence such as "Pays if the price of ETH falls below 1,500 US dollars." into a trigger, so the payout rule can be audited.
2. **Buy the number.** One Telegraph miner is asked for the measured value; the agent's wallet pays one cent in test USDC through x402.
3. **Corroborate.** On a breach (or always, if set) the same number is bought from a different miner. A miner is never asked twice.
4. **Decide.** PAY only if both answers agree within the cover's tolerance and both are past the line. DISPUTED if they disagree or fall on opposite sides, so a coin flip never moves money.
5. **Record.** Answers, miner names, payment transactions and links to the stored answers go into `tripwire/decisions.jsonl` and `tripwire/ledger.jsonl`. A cover stored on the server may also carry a small test-USDC payout (capped, once per cover, off unless enabled).

Cover types: Bitcoin hashprice, waiting time at a Finnish port, air temperature at a place, the price of a coin, a stablecoin depeg, and dollars-to-euros.

## What each entry is

- **Tripwire** is the app: wording reader, live stage-by-stage settlement view, ledger with a permanent link for each decision, and a list of questions where miners disagreed.
- **Gauge** answers five intents (`MINING_HASHPRICE_VERIFY_GENERAL`, `LIVE_PORT_CONGESTION_GENERAL`, `WEATHER_CHECK_TEMPERATURE`, `CRYPTO_PRICE_USD`, `FX_NOW_EUR`) from two keyless public sources each, and returns an error instead of a guess when they disagree.
- **Tripwire Measure** is a Rust/WASM comparator that scores an answer against the true value (0 to 10,000), a runnable endpoint, a truth-source file, and a benchmark of real paid answers (`measure/benchmark.md`).

## Evidence

- `tripwire/decisions.jsonl`: every decision. `tripwire/ledger.jsonl`: every paid request, with receipts. `evidence/`: copies taken from the first host.
- Example worth reading: Port of Helsinki, one miner answered 965.2 hours and Gauge answered 0.06 hours, so the decision was DISPUTED. One answer alone would have paid a 48-hour delay cover wrongly.

## Run it

Node 20 or later. No framework and no build step except the comparator (Rust).

```
node local.mjs                          # app, miner and comparator locally, then open http://localhost:18787
cd tripwire && node --test              # decide, wording reader, settle flow, payout rules, ledger views (no network, no payment)
cd gauge && node --test                 # maths, place matching, two-source rule
cd measure && npm run check             # comparator against an independent reference rule on 12,444 cases
```

To make real paid requests, put a throwaway Sepolia key in `tripwire/.env` (`EVM_PRIVATE_KEY=0x...`) and fund it with test USDC (`node --env-file=.env mint.mjs`). See `TUTORIAL.md` for a walk-through and `deploy/` for the server setup.

## Disclosure and limits

- The app pays from, and Gauge is paid into, **one test wallet** (`0x5a7457D50a0bC554d83c810DeA7394cA62411880`). Gauge is one of the app's second opinions but is never its first source.
- This is not insurance and moves no real money. Weather cover is not new; the range of triggers and the corroboration step are the point.
- The comparator cannot go live on the hashprice family on the network today (Telegraph bounty issue #171); the evaluator entry rests on the benchmark and an uploaded truth source.
- Port waiting time covers Finnish ports only. Temperature comes from weather-model analyses, not a station. The payout is a plain test-USDC transfer, not an escrow contract.
