# Tripwire Measure

Evaluator entry for `MINING_HASHPRICE_VERIFY`: a truth source, a comparator module, and a benchmark on real paid answers.

## What is here

| Part | File | State |
|---|---|---|
| Truth source | `truth/hashprice-gauge.yaml` | Written and pointing at the live Gauge. `hashprice-truth.jsonl` was uploaded to the network's evaluation pool on 16 November and admitted (one row; the pool needs five independent contributors before a snapshot, so it is not yet eligible). `node --env-file=../tripwire/.env upload.mjs MINING_HASHPRICE_VERIFY_GENERAL hashprice-truth.jsonl` is a dry run; add `--send` to upload. |
| Comparator | `comparator/src/lib.rs`, built to `tripwire_measure.wasm` (1,967 bytes) | Built and checked against the reference rule |
| Runnable endpoint | `runnable.mjs` | Live at https://measure.129.121.144.223.sslip.io. Runs the same `.wasm` file and serves it for download. |
| Benchmark | `benchmark.mjs`, result in `benchmark.md` | Run on 17 paid answers from 7 miners. Gauge's own answers are left out, because Gauge supplies the truth |
| Upload tool | `upload.mjs` | Signs and posts material. Dry run by default. |

## Why this family

The family has no champion module: three comparators are registered and all are stuck waiting for material, so the node falls back to a generic scorer. Meanwhile the miner with the most routed traffic is 9.7% off. Tripwire pays out on this number, so it is the family where a wrong answer costs the most. Why they are stuck (bounty issue #171, open): the node classes the bare family name `MINING_HASHPRICE_VERIFY` as judgment, while the intent `MINING_HASHPRICE_VERIFY_GENERAL` is deterministic. On 11 November only six families are deterministic at both levels, and each already has a champion. So we expect our registration to wait at the same stage until that is fixed; the truth source and the benchmark do not depend on it. (The pool holds 426 rows from 3 contributors. Row contents are private, so we cannot say whether any of them is a working truth source.)

## What the benchmark shows

`benchmark.md` scores each paid miner answer against the truth source with the comparator (RelTol, 50 bps assumed).

Baseline: the family has no champion, so today's ranking comes from the node's generic fallback. We let the network choose the miner 8 times. It chose a miner our measurement scores 0 on 4 of them (three answers 9.7% off, one with no number).

- Four miners score 10,000 on every block.
- ChainSight (the top-routed miner) scores 0: it answered 46,870 for a block whose value is 42,706.575305.
- Two miners returned no number at all and score 0.

So the measurement separates the miners that answer for the block asked from those that do not.

## Check it yourself

```
npm install
npm run build        # needs Rust with the wasm32-unknown-unknown target
npm run check        # 12,444 cases against the reference rule, two identical runs, 0 imports, prints the keccak256 hash
node runnable.mjs    # http://localhost:8789/runnable
curl -X POST localhost:8789/runnable -d '{"batch":[{"ground_truth_value":1000,"miner_value":1005,"spec":[1,10]}]}'
```

The benchmark needs Gauge: `GAUGE_URL=https://gauge.129.121.144.223.sslip.io node benchmark.mjs > benchmark.md`.

## The rule the comparator implements

From the Telegraph docs. Scores are basis points, 0 to 10,000.

| Code | Name | Error |
|---|---|---|
| 0 | Exact | 10,000 if equal, else 0 |
| 1 | AbsTol | `|miner - truth|` |
| 2 | RelTol | `|miner - truth| x 10000 / max(|truth|, 1)`, truncated |
| 3 | PassFail | Same as Exact |

For codes 1 and 2 the score is `10000 x (2 x tolerance - error) / (2 x tolerance)` with integer division, 0 once the error reaches twice the tolerance. A tolerance of 0 or less scores only an exact match. Unknown codes behave as Exact. All arithmetic is 128-bit, so values at 1e18 do not overflow.

One reading we had to choose: with RelTol and a tolerance of 0 or less, a miner value that differs from the truth by less than one basis point scores 0 here (not equal, so not an exact match).
