// One paid request from the command line.
//   node --env-file=.env ask.mjs INTENT '{"param":"value"}' [minerId]
import { ask, askMiner, account, spentUsd } from "./telegraph.mjs";

const [intent = "CRYPTO_PRICE_USD", params = '{"symbol":"BTC"}', minerId] = process.argv.slice(2);
console.error("wallet", account.address);
const r = minerId ? await askMiner(minerId, intent, JSON.parse(params)) : await ask(intent, JSON.parse(params));
console.log(JSON.stringify(r, null, 2));
console.error(`status ${r.status}, spent $${spentUsd()}`);
