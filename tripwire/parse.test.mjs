// node --test
import test from "node:test";
import assert from "node:assert/strict";
import { parseCover } from "./parse.mjs";

test("parseCover", () => {
  const heat = parseCover("Heat stress cover for Wirra Station. The insurer pays AUD 50,000 if the air temperature at Longreach, Queensland, Australia rises above 38 degrees Celsius.").cover;
  assert.equal(heat.intent, "WEATHER_CHECK_TEMPERATURE");
  assert.deepEqual(heat.params, { location: "Longreach, Queensland, Australia" });
  assert.deepEqual(heat.trigger, { field: "temperature_c", op: ">", threshold: 38, abs_tolerance: 1 });

  // The place may also close the sentence, as in the page's own headline.
  const tail = parseCover("Pays if air temperature is above 38°C at Longreach, Queensland, Australia.").cover;
  assert.deepEqual(tail.params, { location: "Longreach, Queensland, Australia" });
  assert.equal(tail.trigger.threshold, 38);

  const hash = parseCover("Revenue floor for a Bitcoin mining site: pays out if hashprice at block 975340 is below 45,000 sats per PH/s per day.").cover;
  assert.deepEqual(hash.params, { block_height: 975340 });
  assert.deepEqual(hash.trigger, { field: "hashprice_sats_per_ph_day", op: "<", threshold: 45000, tolerance: 0.02 });
  assert.equal(parseCover("Pays if Bitcoin hashprice falls below 42000 sats per PH/s per day.").cover.params.block_height, "$BTC_TIP");

  const port = parseCover("Cargo delay cover. Pays the consignee if the average waiting time at the Port of Helsinki is more than 48 hours.").cover;
  assert.deepEqual(port.params, { port: "Helsinki" });
  assert.equal(port.trigger.op, ">");
  assert.equal(port.trigger.threshold, 48);

  const peg = parseCover("Depeg cover for a treasury. Pays if the price of USDC falls below 0.98 US dollars.").cover;
  assert.deepEqual([peg.intent, peg.params.symbol, peg.trigger.op, peg.trigger.threshold], ["CRYPTO_PRICE_USD", "USDC", "<", 0.98]);
  const btc = parseCover("Revenue floor for a Bitcoin miner. Pays if the price of BTC falls below 60,000 US dollars.").cover;
  assert.deepEqual([btc.intent, btc.params.symbol, btc.trigger.threshold, btc.trigger.tolerance, btc.mission], ["CRYPTO_PRICE_USD", "BTC", 60000, 0.01, undefined]);
  assert.equal(parseCover("Pays if the price of USDT falls below 0.97 US dollars.").cover.trigger.abs_tolerance, 0.005); // stablecoins keep the tight absolute limit
  assert.match(parseCover("Pays if the price of BTC falls below 60,000 euros.").error, /unit/);
  const fx = parseCover("Currency cover for a European importer. Pays if one US dollar buys more than 0.95 euros.").cover;
  assert.deepEqual([fx.intent, fx.params.currency, fx.trigger.op, fx.trigger.threshold], ["FX_NOW_EUR", "EUR", ">", 0.95]);
  assert.match(parseCover("Pays if one US dollar buys more than 150 yen this quarter.").error, /unit/);

  // Wording that must not start a watch.
  assert.match(parseCover("We will pay you if things go badly at the farm this year.").error, /no trigger/);
  assert.match(parseCover("Pays if the temperature at Longreach is unpleasant for cattle.").error, /threshold/);
  assert.match(parseCover("Pays if the temperature at Longreach is above 30 degrees or below 5 degrees.").error, /threshold/);
  assert.match(parseCover("Pays if the temperature at Longreach rises above 38 hours.").error, /unit/);
  assert.match(parseCover("Pays if the temperature rises above 38 degrees Celsius somewhere.").error, /location/);
  assert.match(parseCover("short").error, /paste/);
});
