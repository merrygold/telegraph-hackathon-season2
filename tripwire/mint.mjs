// Mint 10 test USDC to the wallet. Needs a little Sepolia ETH for gas.
//   node --env-file=.env mint.mjs
import { createWalletClient, http, parseAbi, publicActions } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const abi = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = createWalletClient({ account, chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") }).extend(publicActions);

const hash = await client.writeContract({ address: USDC, abi, functionName: "mint", args: [account.address, 10_000_000n] });
await client.waitForTransactionReceipt({ hash });
const bal = await client.readContract({ address: USDC, abi, functionName: "balanceOf", args: [account.address] });
console.log("tx", hash, "balance", Number(bal) / 1e6, "USDC");
