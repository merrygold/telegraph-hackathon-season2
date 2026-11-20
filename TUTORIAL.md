# Settle a parametric cover with two paid answers

A parametric cover pays when a measured number crosses a threshold: wind over 90 km/h at a site, hashprice under 45,000 sats, a ship waiting more than 48 hours. Nobody inspects a loss. That makes the measurement the whole contract: whoever supplies the number decides the payout.

This tutorial builds the smallest agent that settles such a cover on [Telegraph](https://docs.telegraphprotocol.com). It buys the number from one miner, and if the number breaches the trigger it buys a second answer from a different miner before deciding. About 50 lines of logic, three dependencies, Ethereum Sepolia testnet, one cent per answer.

Everything here is the code in `tripwire/`. Testnet only: no real funds anywhere.

## Why one answer is not enough

On 11 November 2026 we asked the network for Bitcoin hashprice at block 975340.

| Miner | Answer (sats per PH/s per day) |
|---|---|
| The one the network routed us to | 46,871 |
| Two others, asked by id | 42,707 and 42,706.575305 |

The block's real value is 42,706.575305. The routed miner was reporting a current figure and ignoring the block height. A cover with a floor at 45,000 should pay on this block, and on that answer alone it would not. And for a port-delay cover at Helsinki, one miner said ships were waiting 1,426 hours while another said 5.6: a single answer would have paid a claim that never triggered. A second answer costs $0.01.

## 1. Set up

You need Node 20 or later and a **new** wallet used for nothing else.

```
cd tripwire
npm install                                  # @x402/fetch, @x402/evm, viem
echo "EVM_PRIVATE_KEY=0x<new test key>" > .env
node --env-file=.env mint.mjs                # mints 10 test USDC (needs a little Sepolia ETH for gas)
```

Never put a mainnet key in that file.

## 2. Pay for an answer

A Telegraph request is a plain `POST /engine/v1/ask`. The node replies `402` with a price, the client signs a USDC authorisation, retries, and gets `200` with the answer and a receipt. `@x402/fetch` does the round trip for you (`telegraph.mjs`):

```js
const NETWORK = "eip155:11155111"; // Ethereum Sepolia
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";

const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  spendControls: {
    allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: "100000" }], // $0.10
  },
});
```

Two things the docs do not make obvious:

- **Each `allowedAssets` entry needs its own `network`.** Without it the client refuses to pay and the error does not say why.
- **`maxAmountPerPayment` caps one request, not the day.** Keep your own running total and stop before the budget is gone. `telegraph.mjs` counts a failed paid call at the full per-request cap, so the total can only be too strict.

Try it:

```
node --env-file=.env ask.mjs MINING_HASHPRICE_VERIFY_GENERAL '{"block_height":975340}'
```

The reply carries what you need for evidence: `body.result` (the intent's fields), `body.miner_id`, `body.signal_hash`, `body.cost_usd`, and an `X-TELEGRAPH-RECEIPT` header that decodes to `receipt_hash` and `tx_hash`.

## 3. Write the cover as data

```json
{
  "name": "Hashprice floor cover",
  "intent": "MINING_HASHPRICE_VERIFY_GENERAL",
  "params": { "block_height": 975340 },
  "trigger": { "field": "hashprice_sats_per_ph_day", "op": "<", "threshold": 45000, "tolerance": 0.02 },
  "corroborators": [71083, 9002]
}
```

`tolerance` is the largest gap allowed between the two miners (2% here). `corroborators` are miner ids to ask for the second answer, in order.

## 4. The rule

Four outcomes, in `decide.mjs`:

| Decision | When |
|---|---|
| `NO_DATA` | The first miner returned no number |
| `NO_PAY` | The first number does not breach the trigger (no second purchase), or, with `always`, both numbers agree and neither breaches |
| `DISPUTED` | There is no second answer when one is needed, or the two differ by more than the tolerance, or they fall on opposite sides of the threshold |
| `PAY` | Both miners breach the trigger and agree within the tolerance |

The core of it:

```js
export function decide(trigger, a, b) {
  const va = num(a, trigger.field);
  if (va === null) return { decision: "NO_DATA" };
  const vb = num(b, trigger.field);
  if (!breached(va, trigger) && !trigger.always) return { decision: "NO_PAY", values: [va] };
  if (vb === null) return { decision: "DISPUTED", values: [va] };
  if (gap(va, vb, trigger) > limit(trigger)) return { decision: "DISPUTED", values: [va, vb] };
  if (!breached(va, trigger) && !breached(vb, trigger)) return { decision: "NO_PAY", values: [va, vb] };
  if (!breached(va, trigger) || !breached(vb, trigger)) return { decision: "DISPUTED", values: [va, vb] };
  return { decision: "PAY", values: [va, vb] };
}
```

(The file spells out the gap and the reasons; this is its shape.)

The rule is a pure function, so it is tested without the network: `node --test`.

Note what `NO_PAY` costs: one cent. The second answer is only bought when money is about to move.

## 5. Ask a different miner on purpose

`POST /engine/v1/ask/{minerId}` sends the request to one named miner. The settle loop (`settle.mjs`) skips the miner that gave the first answer and takes the first corroborator that replies:

```js
for (const id of cover.corroborators.filter((id) => String(id) !== String(first.body.miner_id))) {
  const second = await askMiner(id, cover.intent, cover.params);
  if (second.ok) { b = second.body.result; break; }
}
```

**Different id is not the same as different source.** Miners 71083, 74183 and 1900999013 all returned 42,706.575305 for the block above, and all three belong to one operator. Two of them agreeing proves nothing. Before listing a corroborator, look at `GET /api/miners/{id}`: check the operator address and the `base_url`, and pick miners that read different upstream data.

## 6. Keep the evidence

Each decision is one line in `decisions.jsonl`: the cover, the trigger, the decision and reason, the total cost, and for every answer the miner id, the result, `signal_hash`, `receipt_hash` and `tx_hash`. Anyone can check them:

```
curl https://devnode.telegraphprotocol.com/engine/v1/signal/<signal_hash>     # the stored answer
```

and the `tx_hash` is a Sepolia transaction.

## 7. Run it

```
node --env-file=.env settle.mjs covers/hashprice-txlens.json     # named primary, floor 45,000: PAY
node --env-file=.env settle.mjs covers/hashprice.json            # network picks the first miner, second answer always bought
node --env-file=.env settle.mjs covers/heat-longreach.json       # 27.9 C against 38 C: NO_PAY
node --env-file=.env settle.mjs covers/heat-longreach.json 25    # same cover, threshold 25: PAY
node --env-file=.env settle.mjs covers/port-helsinki.json        # 965 hours against 0.06: DISPUTED
node --env-file=.env settle.mjs covers/depeg-usdc.json           # USDC at 0.9996 against 0.98: NO_PAY, two answers
node --env-file=.env settle.mjs covers/fx-eur.json               # a dollar buys 0.90 euros against 0.95: NO_PAY, two answers
```

For a page and a loop that checks open covers on a timer: `node --env-file=.env server.mjs`, then open `http://localhost:8787`. The same page is live at https://tripwire.129.121.144.223.sslip.io, where it shows each stage of a paid request as it happens.

## What to do when miners disagree

`DISPUTED` is a result, not a failure. In our runs it stopped a wrong payout on the port-delay cover twice (1,426 hours against 5.6, and later 965 hours against 0.06, with a 48-hour trigger). Do not average the two and do not retry until they agree. Record both values, pay nothing, and hand the record to a person.

## The limit of this rule

By default the second answer is bought only on a breach, so the rule guards against paying wrongly, not against refusing wrongly. We hit this: the routed miner said 46,871, that is not under 45,000, and the cover got `NO_PAY` although the block's real value is 42,706. Three ways to close the gap:

- Set `"always": true` in the trigger. The second answer is then bought on every check, and two answers on opposite sides of the threshold give `DISPUTED`. A quiet check then costs two cents.

- Set `primary` to a miner you have checked against the source yourself, as `hashprice-txlens.json` does.
- Fix the supply side: a miner that answers for the block asked (see `gauge/`), and evaluation that scores the wrong one down (see `measure/`).
