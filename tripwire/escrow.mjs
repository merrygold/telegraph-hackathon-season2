// The Telegraph escrow balance (docs.telegraphprotocol.com, "Pay from Escrow").
//   node --env-file=.env escrow.mjs status
//   node --env-file=.env escrow.mjs fund 0.50    # approve + deposit 0.50 test USDC into the Diamond: two on-chain sends
import { account } from "./telegraph.mjs";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";

const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // test USDC, 6 decimals
const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b"; // the node's ledger Diamond, the escrow payTo

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const usd = (n) => (Number(n) / 1e6).toFixed(2);

if (process.argv[2] === "status") {
  const [bal, allow] = await Promise.all([
    pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [account.address, DIAMOND] }),
  ]);
  const led = await (await fetch(`${NODE}/v1/ledger/account/${account.address}`)).json();
  console.log(`wallet        ${account.address}`);
  console.log(`USDC wallet   ${usd(bal)}   approved for the Diamond: ${usd(allow)}`);
  console.log(`escrow        deposited ${usd(led.deposited)}  credited ${usd(led.credited)}  charged ${usd(led.charged)}  unbilled ${usd(led.unbilled)}`);
  console.log(`escrow        balance ${usd(led.balance)}  available for asks ${usd(led.available)}`);
} else if (process.argv[2] === "fund") {
  const amount = Math.round(Number(process.argv[3]) * 1e6);
  if (!(amount > 0)) throw new Error("give an amount in USDC, e.g.: node --env-file=.env escrow.mjs fund 0.50");
  const h1 = await wallet.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [DIAMOND, amount] });
  console.log("approve tx:", h1);
  await pub.waitForTransactionReceipt({ hash: h1 });
  const h2 = await wallet.writeContract({ address: DIAMOND, abi: parseAbi(["function depositUSDC(uint256)"]), functionName: "depositUSDC", args: [amount] });
  console.log("deposit tx:", h2);
  await pub.waitForTransactionReceipt({ hash: h2 });
  console.log(`funded ${usd(amount)} test USDC into the Diamond escrow`);
} else {
  console.log("usage:\n  node --env-file=.env escrow.mjs status\n  node --env-file=.env escrow.mjs fund <usdc>   # two on-chain sends from the agent wallet");
}
