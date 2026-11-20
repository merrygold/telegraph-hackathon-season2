// Paid requests to Telegraph over x402, with a spending cap and a ledger.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";

const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const NETWORK = "eip155:11155111"; // Ethereum Sepolia
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // test USDC, 6 decimals
const MAX_PER_REQUEST = 100_000n; // $0.10
const BUDGET = BigInt(process.env.BUDGET_UUSDC ?? 2_000_000); // $2.00 per day
const LEDGER = new URL("./ledger.jsonl", import.meta.url);

export const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);

// The x402 client calls fetch twice per paid request: bare (answered 402), then with the signed payment.
// Each request reports those moments to its own listener, so two settlements at once cannot mix.
const stage = new AsyncLocalStorage();
const traced = async (...args) => {
  const s = stage.getStore();
  if (s && s.calls++) s.on("signed");
  const r = await fetch(...args);
  if (r.status === 402 && s?.calls === 1) s.on("price");
  return r;
};

const pay = wrapFetchWithPaymentFromConfig(traced, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  spendControls: {
    allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: String(MAX_PER_REQUEST) }],
  },
});

let spent = 0n; // ponytail: per-process counter, sum the ledger if the cap must survive restarts
export const BUDGET_USD = Number(BUDGET) / 1e6;
export const spentUsd = () => Number(spent) / 1e6;
export const resetSpent = () => { spent = 0n; };

const b64json = (s) => (s ? JSON.parse(Buffer.from(s, "base64").toString()) : null);

// Returns { ok, status, body, receipt, cost_usd }. Never throws on a non-200.
async function post(path, payload, on = () => {}) {
  if (spent + MAX_PER_REQUEST > BUDGET) throw new Error(`budget exhausted: spent $${spentUsd()}`);
  const r = await stage.run({ on, calls: 0 }, () => pay(NODE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  const receipt = b64json(r.headers.get("x-telegraph-receipt"));
  const cost_usd = Number(body.cost_usd ?? 0);
  // Count the worst case when a paid call fails, so the cap can only be too strict.
  spent += r.ok ? BigInt(Math.round(cost_usd * 1e6)) : r.status === 402 ? 0n : MAX_PER_REQUEST;
  const entry = { at: new Date().toISOString(), path, payload, status: r.status, cost_usd, receipt, body };
  appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
  return { ok: r.ok, status: r.status, body, receipt, cost_usd };
}

export const ask = (intent, params, on) => post("/engine/v1/ask", { intent, params }, on);
export const askMiner = (minerId, intent, params, on) => post(`/engine/v1/ask/${minerId}`, { intent, params }, on);
// Sends a cover's payout in test USDC and returns the transaction hash. Recorded in the ledger like every other spend.
export const PAYOUT_MAX_USD = 1;
export async function transfer(to, usd) {
  if (!(usd > 0 && usd <= PAYOUT_MAX_USD)) throw new Error("payout must be above 0 and at most " + PAYOUT_MAX_USD + " test USDC");
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com") });
  const tx_hash = await wallet.writeContract({ address: USDC, abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]), functionName: "transfer", args: [to, BigInt(Math.round(usd * 1e6))] });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), path: "payout", payload: { to, usd }, tx_hash }) + "\n");
  return tx_hash;
}
export const ledger = () =>
  existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
