// On-chain steps for Gauge (miner) and Tripwire Measure (comparator), on Ethereum Sepolia.
// Every step simulates first and only sends with --send.
//   node --env-file=.env register.mjs swap 8                         buy MACHINA with 8 test USDC (bonds)
//   node --env-file=.env register.mjs miner https://gauge.example.com/gauge.yaml
//   node --env-file=.env register.mjs wasm MINING_HASHPRICE_VERIFY https://measure.example.com
// Add --send to any of them to transact.
import { createWalletClient, http, parseAbi, publicActions, keccak256, sha256, maxUint256 } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const DIAMOND = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";
const MACHINA = "0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const ROUTER = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const abi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
  "function registerMiner(string,bytes32,address,uint256,string[]) returns (uint256)",
  "function registerWasm(bytes32,string,string,address,string) returns (uint256)",
]);

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = createWalletClient({ account, chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") }).extend(publicActions);
const args = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
const [step, a, b] = args;

// Simulate, print the result, and send only when asked.
async function call(address, functionName, fnArgs) {
  const { result, request } = await client.simulateContract({ account, address, abi, functionName, args: fnArgs });
  console.log(`${functionName}: simulation ok, returns ${result}`);
  if (!SEND) return console.log("dry run, nothing sent (add --send)");
  const hash = await client.writeContract(request);
  await client.waitForTransactionReceipt({ hash });
  console.log(`sent: https://sepolia.etherscan.io/tx/${hash}`);
}

async function allow(token, spender, amount) {
  if ((await client.readContract({ address: token, abi, functionName: "allowance", args: [account.address, spender] })) >= amount) return;
  if (!SEND) throw new Error(`needs an approval first; rerun with --send to approve and continue`);
  const hash = await client.writeContract({ address: token, abi, functionName: "approve", args: [spender, maxUint256] });
  await client.waitForTransactionReceipt({ hash });
  console.log(`approved: ${hash}`);
}

const fetchBytes = async (url) => {
  const r = await fetch(url, { redirect: "error" });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

const machina = async () => Number(await client.readContract({ address: MACHINA, abi, functionName: "balanceOf", args: [account.address] })) / 1e18;
console.log(`wallet ${account.address}, MACHINA ${await machina()}`);

if (step === "swap") {
  const amountIn = BigInt(Math.round(Number(a) * 1e6));
  await allow(USDC, ROUTER, amountIn);
  // ponytail: no minimum out; fine for test tokens, set amountOutMinimum for anything of value
  await call(ROUTER, "exactInputSingle", [{ tokenIn: USDC, tokenOut: MACHINA, fee: 3000, recipient: account.address, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }]);
} else if (step === "miner") {
  // Hash the bytes the node will download, not the local copy.
  const yaml = await fetchBytes(a);
  const text = new TextDecoder().decode(yaml);
  const intents = [...text.split("supported_intents:")[1].matchAll(/^\s*-\s*([A-Z0-9_]+)\s*$/gm)].map((m) => m[1]);
  console.log(`yaml ${a}\nsha256 ${sha256(yaml)}\nintents ${intents.join(", ")}`);
  await allow(MACHINA, DIAMOND, 10n ** 19n);
  await call(DIAMOND, "registerMiner", [a, sha256(yaml), account.address, 10_000n, intents]);
} else if (step === "wasm") {
  const base = b.replace(/\/$/, "");
  const wasm = await fetchBytes(`${base}/tripwire_measure.wasm`);
  console.log(`prefix ${a}\nkeccak256 ${keccak256(wasm)}`);
  await allow(MACHINA, DIAMOND, 2n * 10n ** 19n);
  await call(DIAMOND, "registerWasm", [keccak256(wasm), `${base}/tripwire_measure.wasm`, a, account.address, `${base}/runnable`]);
} else {
  console.log("steps: swap <usdc> | miner <yamlUrl> | wasm <PREFIX> <measureBaseUrl>");
}
