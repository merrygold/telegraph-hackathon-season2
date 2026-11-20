# Tripwire

An agent that settles parametric cover on evidence it buys through Telegraph. It buys the trigger value, buys a second answer from a different miner when the trigger looks breached, and decides `PAY`, `NO_PAY`, `DISPUTED` or `NO_DATA`. Every answer is kept with its receipt.

Network: Ethereum Sepolia testnet. Payments are test USDC over x402.

## Run

Needs Node 20.6 or later.

```
npm install
echo EVM_PRIVATE_KEY=0x<fresh testnet key> > .env
node --env-file=.env mint.mjs        # 10 test USDC; the wallet needs a little Sepolia ETH for gas
node --env-file=.env server.mjs      # http://localhost:8787
```

Other commands:

```
node --env-file=.env settle.mjs covers/hashprice.json [threshold]   # settle one cover once
node --env-file=.env ask.mjs INTENT '{"param":"value"}' [minerId]    # buy one answer
node --test                                                          # decision rule, wording parser, settlement flow (7 tests, no network)
```

## Cover wording

The page has a box for the trigger clause. `parse.mjs` reads it with fixed rules: no model, no payment. It needs a metric it knows (hashprice, temperature, port waiting time, the price of USDC, USDT or DAI, or what one US dollar buys in euros), exactly one threshold ("above N" or "below N") with a fitting unit, and a place, port or block. Anything else is refused and no watch starts.

A paid `CONTENT_EXTRACTION_GENERAL` answer was tried for this step. It returned "values: 38 degrees" for a full clause, which is not enough to stake a payout on, so the wording is read by code anyone can audit and only the measured value is bought.

## A cover

```json
{
  "name": "Hashprice floor cover",
  "intent": "MINING_HASHPRICE_VERIFY_GENERAL",
  "params": { "block_height": 975340 },
  "trigger": { "field": "hashprice_sats_per_ph_day", "op": "<", "threshold": 45000, "tolerance": 0.02 },
  "primary": 9002,
  "corroborators": [71083, 302],
  "watch": true
}
```

- `primary` is optional. Without it the network chooses the first miner.
- `corroborators` are tried in order, skipping the miner that answered first.
- `tolerance` is the largest relative gap allowed between the two answers. Use `abs_tolerance` instead for an absolute gap, for example 1 degree.
- `trigger.always: true` buys the second answer on every check, not only on a breach. Without it a wrong first answer can hide a breach: the rule then guards against paying wrongly but not against refusing wrongly. It costs two answers per check. `covers/hashprice.json` uses it because it lets the network pick the first miner.
- `watch: true` makes the server check the cover on a timer until it pays. `"$BTC_TIP"` as a param value means the newest Bitcoin block.

## Covers included

| File | Mission | Trigger |
|---|---|---|
| `hashprice*.json` | 12 Mining & Power | Bitcoin hashprice under a floor at a block |
| `heat-longreach.json` | 06 Resources & Agriculture | Air temperature above 38 C at a cattle station |
| `port-helsinki.json` | 08 Commodities | Average port waiting time above 48 hours |
| `depeg-usdc.json` | 02 Stablecoin | Price of USDC below 0.98 US dollars |
| `fx-eur.json` | 03 Institutional Markets | One US dollar buys more than 0.95 euros |

Gauge (miner 4283, our own) is the first corroborator in every cover. The primary is always another operator's miner. Both are paid from, and Gauge is paid into, the same test wallet; say so wherever results are published.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `BUDGET_UUSDC` | `2000000` | Spending cap per day, in millionths of a USDC. The agent halts when the next request could exceed it and resumes the next day. |
| `WATCH_MINUTES` | `10` | Watch interval. `0` turns the loop off. |
| `PORT` | `8787` | |

A single payment is capped at $0.10.

## Things to try

| Try | Expect |
|---|---|
| Threshold far below the value | `NO_PAY`, one purchase |
| Remove `primary`, threshold 50000 at block 975340 | `DISPUTED`: the two miners differ by about 9% |
| `primary` 9002, threshold 45000 at block 975340 | `PAY`, two receipts |
| `always: true`, threshold far above the value | `NO_PAY` with two answers that agree |
| `BUDGET_UUSDC=150000`, then settle repeatedly | `budget exhausted`, the agent halts |
| Wording with no threshold, or two thresholds | Refused: no cover is created |
| A miner id that cannot serve the intent as the only corroborator | `DISPUTED`: breach not corroborated |

## Files

- `telegraph.mjs`: paid requests, spending cap, `ledger.jsonl`.
- `decide.mjs`: the decision rule. `decide.test.mjs` tests it.
- `settle.mjs`: one settlement, appended to `decisions.jsonl`. It reports each stage to a callback; `settle.test.mjs` tests the flow with fake miners.
- `parse.mjs`: cover wording to a cover. `parse.test.mjs` tests it.
- `server.mjs`, `index.html`: watch loop and the page. `POST /api/settle` streams one JSON object per line: `ask`, `price`, `signed`, `answer`, `decide`, then `done` with the record or `error`.
- `register.mjs`: on-chain registration for the miner and the comparator (dry run unless `--send`).
