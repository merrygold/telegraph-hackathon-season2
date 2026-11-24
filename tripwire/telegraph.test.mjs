// node --test   (offline: only the escrow message builder, no network, nothing signed or sent)
import test from "node:test";
import assert from "node:assert/strict";
process.env.EVM_PRIVATE_KEY ??= "0x" + "22".repeat(32); // telegraph.mjs builds an account on import; nothing is signed here
const { escrowAuthorization } = await import("./telegraph.mjs");

const TEMPLATE = "Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask/78222\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}";

test("escrow authorization fills the template verbatim and reads the amount off it", () => {
  const addr = "0x5A7457D50a0bC554d83c810DeA7394cA62411880";
  const { authorization, message } = escrowAuthorization(TEMPLATE, "0x72a70e949362670bf8bcead24efc5b8f950aa08b", addr, 1_000_000);
  assert.equal(authorization.from, addr.toLowerCase()); // the node compares lowercased addresses
  assert.equal(authorization.to, "0x72a70e949362670bf8bcead24efc5b8f950aa08b");
  assert.equal(authorization.value, "10000"); // the reliable figure: the template's Amount line
  assert.equal(authorization.validAfter, "999995"); // now - 5
  assert.equal(authorization.validBefore, "1000100"); // now + 100: window stays under the 2-minute cap
  assert.ok(authorization.nonce.length >= 8);
  assert.ok(!/\{[a-zA-Z]+\}/.test(message)); // every placeholder filled
  assert.match(message, /Wallet: 0x5a7457d50/); // the signed bytes carry the lowercased wallet
  assert.match(message, /Amount: 10000 uUSDC/); // the message keeps the node's exact wording
});
