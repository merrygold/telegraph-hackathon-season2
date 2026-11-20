// Signs and uploads evaluation material to a Telegraph node's evaluation pool.
//   node --env-file=../tripwire/.env upload.mjs INTENT file.jsonl           dry run: prints what would be sent
//   node --env-file=../tripwire/.env upload.mjs INTENT file.jsonl --send    uploads (this changes the live pool)
//   node upload.mjs --truth truth/x.yaml > x.jsonl                          wraps a truth-source YAML as one row
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const CHAIN_ID = 11155111;
const [a, b, flag] = process.argv.slice(2);

if (a === "--truth") {
  const source = readFileSync(b, "utf8");
  if (/GAUGE_DOMAIN/.test(source)) throw new Error("set the real domain in the YAML first");
  process.stdout.write(JSON.stringify({ label_kind: "truth_source", source }) + "\n");
} else {
  if (!a || !b) throw new Error("usage: upload.mjs INTENT file.jsonl [--send]");
  const body = readFileSync(b); // exact bytes: the signature covers their hash
  const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
  const nonce = randomBytes(16).toString("hex");
  const message = ["Telegraph eval-pool submission v1", `intent_id: ${a}`, `body_sha256: ${createHash("sha256").update(body).digest("hex")}`, `nonce: ${nonce}`, `chain_id: ${CHAIN_ID}`].join("\n");
  const signature = await account.signMessage({ message });
  const url = `${NODE}/api/evalpool/submissions?intent_id=${a}&submitter=${account.address}`;
  const rows = body.toString().trim().split("\n");
  rows.forEach((r, i) => { try { JSON.parse(r); } catch { throw new Error(`row ${i + 1} is not JSON`); } });
  console.log(`${rows.length} row(s) for ${a} from ${account.address}`);
  if (flag !== "--send") {
    console.log(`dry run, nothing sent. Would POST to ${url}\nfirst row: ${rows[0].slice(0, 300)}`);
  } else {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-ndjson", "X-Evalpool-Signature": signature, "X-Evalpool-Nonce": nonce }, body });
    console.log(r.status, await r.text());
  }
}
