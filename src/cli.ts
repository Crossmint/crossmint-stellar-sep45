/**
 * CLI entry point — Crossmint Smart Wallets + SEP-45 auth + SEP-24 deposit/withdraw.
 * Uses the Crossmint Transactions API for withdrawal payments.
 */

import { parseArgs } from "@std/cli/parse-args";
import { log, logError } from "./logger.ts";
import { loadConfig } from "./config.ts";
import { createWallet, getBalances, getWallet } from "./crossmint.ts";
import { authenticateSep45 } from "./sep45.ts";
import {
  getTransaction,
  handleWithdrawalPayment,
  initiateDeposit,
  initiateWithdrawal,
  pollTransaction,
} from "./sep24.ts";

const AUTH_TOKEN_FILE = ".auth-token";
const WALLET_FILE = ".wallet-address";

const COMMANDS = [
  "wallet",
  "auth",
  "deposit",
  "withdraw",
  "status",
  "balance",
] as const;
type Command = (typeof COMMANDS)[number];

const printUsage = (): void => {
  console.log(`
Usage: deno task cli <command> [options]

Commands:
  wallet     Create or retrieve Crossmint smart wallet
  auth       Authenticate with anchor using SEP-45 (contract accounts)
  deposit    Initiate a cash-to-USDC deposit (SEP-24)
  withdraw   Initiate a USDC-to-cash withdrawal (SEP-24)
  status     Check transaction status
  balance    Check account balances

Options:
  --help       Show this help message
  --amount     Amount for deposit/withdraw
  --id         Transaction ID for status check
  --locator    Wallet locator (email:user@example.com or address) for wallet command
  --key        Idempotency key for wallet creation (reuse to get the same wallet)
`);
};

const readAuthToken = async (): Promise<string> => {
  try {
    const token = await Deno.readTextFile(AUTH_TOKEN_FILE);
    return token.trim();
  } catch {
    throw new Error("No auth token found. Run 'deno task cli auth' first.");
  }
};

const writeAuthToken = async (token: string): Promise<void> => {
  await Deno.writeTextFile(AUTH_TOKEN_FILE, token);
  log("Auth token saved to", AUTH_TOKEN_FILE);
};

const readWalletAddress = async (): Promise<string> => {
  try {
    const addr = await Deno.readTextFile(WALLET_FILE);
    return addr.trim();
  } catch {
    throw new Error(
      "No wallet address found. Run 'deno task cli wallet' first.",
    );
  }
};

const writeWalletAddress = async (address: string): Promise<void> => {
  await Deno.writeTextFile(WALLET_FILE, address);
  log("Wallet address saved to", WALLET_FILE);
};

const handleWallet = async (
  args: ReturnType<typeof parseArgs>,
): Promise<void> => {
  const config = await loadConfig();
  const locator = args.locator as string | undefined;

  if (locator) {
    const wallet = await getWallet(config, locator);
    console.log("Wallet address (C...):", wallet.address);
    if (wallet.config?.adminSigner) {
      console.log("Admin signer (G...):", wallet.config.adminSigner.address);
    }
    await writeWalletAddress(wallet.address);
  } else {
    const idempotencyKey = args.key as string | undefined;
    const wallet = await createWallet(config, idempotencyKey);
    console.log("Wallet address (C...):", wallet.address);
    if (wallet.config?.adminSigner) {
      console.log("Admin signer (G...):", wallet.config.adminSigner.address);
    }
    await writeWalletAddress(wallet.address);
  }
};

const handleAuth = async (): Promise<void> => {
  const config = await loadConfig();
  console.log("Signer (G...):", config.signerKeypair.publicKey());

  // Get or create wallet
  let walletAddress: string;
  try {
    walletAddress = await readWalletAddress();
    log("Using saved wallet:", walletAddress);
  } catch {
    log("No saved wallet found, creating one...");
    const wallet = await createWallet(config);
    walletAddress = wallet.address;
    console.log("Wallet address (C...):", walletAddress);
    if (wallet.config?.adminSigner) {
      console.log("Admin signer (G...):", wallet.config.adminSigner.address);
    }
    await writeWalletAddress(walletAddress);
  }

  log(`Starting SEP-45 authentication with ${config.anchorDomain}...`);

  const token = await authenticateSep45(
    config,
    walletAddress,
    config.anchorDomain,
  );

  await writeAuthToken(token);
  const preview = token.length > 50 ? `${token.substring(0, 50)}...` : token;
  console.log("SEP-45 authentication successful.");
  console.log("Token:", preview);
};

const handleDeposit = async (
  args: ReturnType<typeof parseArgs>,
): Promise<void> => {
  const config = await loadConfig();
  const token = await readAuthToken();
  const walletAddress = await readWalletAddress();
  const amount = args.amount as string | undefined;

  const result = await initiateDeposit(config, token, walletAddress, amount);
  const encodedUrl = result.url.replace(/ /g, "%20");
  console.log("Deposit initiated.");
  console.log("Transaction ID:", result.id);
  console.log("Open this URL to complete KYC:", encodedUrl);

  log("Polling for status updates...");
  try {
    const txn = await pollTransaction(config, token, result.id, "completed");
    console.log("Deposit completed. Final status:", txn.status);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logError("Polling stopped:", msg);
    console.log(
      "Check status manually with: deno task cli status --id",
      result.id,
    );
  }
};

const handleWithdraw = async (
  args: ReturnType<typeof parseArgs>,
): Promise<void> => {
  const config = await loadConfig();
  const token = await readAuthToken();
  const walletAddress = await readWalletAddress();
  const amount = args.amount as string | undefined;

  const result = await initiateWithdrawal(config, token, walletAddress, amount);
  const encodedUrl = result.url.replace(/ /g, "%20");
  console.log("Withdrawal initiated.");
  console.log("Transaction ID:", result.id);
  console.log("Open this URL to complete KYC:", encodedUrl);

  log("Polling until anchor is ready to receive payment...");
  const txn = await pollTransaction(
    config,
    token,
    result.id,
    "pending_user_transfer_start",
    900000,
  );

  log("Anchor is ready. Sending USDC to anchor via Crossmint...");
  const txId = await handleWithdrawalPayment(config, walletAddress, txn);
  console.log("Payment sent to anchor. Tx:", txId);

  log("Polling until withdrawal is completed...");
  try {
    const finalTxn = await pollTransaction(
      config,
      token,
      result.id,
      "completed",
    );
    console.log("Withdrawal completed. Final status:", finalTxn.status);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logError("Polling stopped:", msg);
    console.log(
      "Check status manually with: deno task cli status --id",
      result.id,
    );
  }
};

const handleStatus = async (
  args: ReturnType<typeof parseArgs>,
): Promise<void> => {
  const config = await loadConfig();
  const token = await readAuthToken();
  const id = args.id as string | undefined;

  if (!id) {
    throw new Error("Transaction ID is required. Use --id <transaction-id>");
  }

  const txn = await getTransaction(config, token, id);
  console.log("Transaction details:");
  console.log(JSON.stringify(txn, null, 2));
};

const handleBalance = async (): Promise<void> => {
  const config = await loadConfig();

  console.log("Crossmint wallet balances:");
  try {
    const walletAddress = await readWalletAddress();
    const walletBalances = await getBalances(config, walletAddress);
    for (const b of walletBalances) {
      console.log(`  ${b.symbol}: ${b.amount}`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logError("Could not fetch Crossmint balances:", msg);
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(Deno.args, {
    string: ["amount", "id", "locator", "key"],
    boolean: ["help"],
    default: {
      help: false,
    },
  });

  if (args.help || args._.length === 0) {
    printUsage();
    Deno.exit(0);
  }

  const command = String(args._[0]) as Command;

  if (!COMMANDS.includes(command)) {
    logError(`Unknown command: ${command}`);
    printUsage();
    Deno.exit(1);
  }

  log(`Running command: ${command}`);

  try {
    switch (command) {
      case "wallet":
        await handleWallet(args);
        break;
      case "auth":
        await handleAuth();
        break;
      case "deposit":
        await handleDeposit(args);
        break;
      case "withdraw":
        await handleWithdraw(args);
        break;
      case "status":
        await handleStatus(args);
        break;
      case "balance":
        await handleBalance();
        break;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Command "${command}" failed: ${message}`);
    Deno.exit(1);
  }
};

main();
