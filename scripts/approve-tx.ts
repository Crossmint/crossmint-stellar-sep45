/**
 * One-off: approve (sign + submit) a pending Crossmint wallet transaction.
 *
 * The withdraw payment transaction is created by the CLI but left at
 * "awaiting-approval" because the transaction-approval step was never wired in
 * (the deposit path needs no outbound tx). This signs the pending approval with
 * the external-wallet keypair and submits it, mirroring sep45.ts.
 *
 * Usage:
 *   deno run --allow-ffi --allow-net --allow-read --allow-write --allow-env \
 *     scripts/approve-tx.ts <transactionId> [--dry-run]
 */
import { loadConfig } from "../src/config.ts";
import { fetchWithRetry } from "../src/http.ts";
import { log, logError } from "../src/logger.ts";
import { Buffer } from "node:buffer";

const txId = Deno.args[0];
const dryRun = Deno.args.includes("--dry-run");
if (!txId) {
  console.error("usage: approve-tx <transactionId> [--dry-run]");
  Deno.exit(1);
}

const config = await loadConfig();
const walletAddress = (await Deno.readTextFile(".wallet-address")).trim();
const base =
  `${config.crossmintBaseUrl}/wallets/${walletAddress}/transactions/${txId}`;

const getTx = async () => {
  const res = await fetchWithRetry(base, {
    headers: { "x-api-key": config.crossmintApiKey },
  });
  if (!res.ok) {
    logError(
      "Failed to fetch transaction:",
      `${res.status} ${await res.text()}`,
    );
    Deno.exit(1);
  }
  return await res.json();
};

let txn = await getTx();
log("Wallet:", walletAddress);
log("Transaction status:", txn.status);
log("Transaction params:", JSON.stringify(txn.params ?? txn.onChain ?? {}));

const pending = txn.approvals?.pending?.[0];
if (!pending) {
  log("No pending approval. approvals =", JSON.stringify(txn.approvals));
  Deno.exit(0);
}
log("Pending approval signer:", pending.signer?.locator);
log("Message to sign (b64, first 24):", String(pending.message).slice(0, 24));

if (dryRun) {
  log("--dry-run: not submitting. Re-run without --dry-run to approve.");
  Deno.exit(0);
}

const sig = config.signerKeypair.sign(Buffer.from(pending.message, "base64"));
const signatureBase64 = Buffer.from(sig).toString("base64");
log("Signed preimage locally with external-wallet keypair");

const approvalRes = await fetchWithRetry(`${base}/approvals`, {
  method: "POST",
  headers: {
    "x-api-key": config.crossmintApiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    approvals: [{ signer: pending.signer.locator, signature: signatureBase64 }],
  }),
});
if (!approvalRes.ok) {
  logError(
    "Approval failed:",
    `${approvalRes.status} ${await approvalRes.text()}`,
  );
  Deno.exit(1);
}
log("Approval submitted, polling for on-chain settlement...");

const start = Date.now();
while (Date.now() - start < 120000) {
  await new Promise((r) => setTimeout(r, 2000));
  txn = await getTx();
  log("Status:", txn.status);
  if (txn.status === "success") {
    log("SUCCESS. onChain:", JSON.stringify(txn.onChain));
    Deno.exit(0);
  }
  if (txn.status === "failed") {
    logError("FAILED:", JSON.stringify(txn.error));
    Deno.exit(1);
  }
}
logError("Timed out polling for settlement", "");
Deno.exit(1);
