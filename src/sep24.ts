/**
 * SEP-24 Interactive deposit and withdrawal flows.
 * Uses Crossmint smart wallet (C... address) as the account.
 * Withdrawal payments are sent via the Crossmint Transactions API.
 */

import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";
import {
  createTransaction,
  pollCrossmintTransaction,
} from "./crossmint.ts";
import { fetchToml } from "./toml.ts";
import type { Config } from "./config.ts";

export type InteractiveResponse = {
  readonly type: string;
  readonly url: string;
  readonly id: string;
};

export type Sep24Transaction = {
  readonly id: string;
  readonly status: string;
  readonly kind: string;
  readonly amount_in?: string;
  readonly amount_out?: string;
  readonly amount_fee?: string;
  readonly withdraw_anchor_account?: string;
  readonly withdraw_memo?: string;
  readonly withdraw_memo_type?: string;
  readonly more_info_url?: string;
  readonly started_at?: string;
  readonly completed_at?: string;
  readonly message?: string;
};

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 300000;
const USDC_DECIMALS = 7;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert a human-readable amount (e.g. "10.5") to base units (stroops).
 * Stellar USDC uses 7 decimal places.
 */
const toBaseUnits = (amount: string): string => {
  const [whole, frac = ""] = amount.split(".");
  const padded = frac.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  const raw = BigInt(whole + padded);
  return raw.toString();
};

let cachedTransferServerUrl: string | undefined;

const getTransferServerUrl = async (config: Config): Promise<string> => {
  if (cachedTransferServerUrl) {
    return cachedTransferServerUrl;
  }
  const toml = await fetchToml(config.anchorDomain);
  if (!toml.TRANSFER_SERVER_SEP0024) {
    throw new Error("TRANSFER_SERVER_SEP0024 not found in anchor TOML");
  }
  cachedTransferServerUrl = toml.TRANSFER_SERVER_SEP0024;
  return cachedTransferServerUrl;
};

export const initiateDeposit = async (
  config: Config,
  token: string,
  walletAddress: string,
  amount?: string,
): Promise<InteractiveResponse> => {
  const transferServer = await getTransferServerUrl(config);
  const url = `${transferServer}/transactions/deposit/interactive`;

  log("Initiating SEP-24 deposit...");

  const body: Record<string, string> = {
    asset_code: "USDC",
    account: walletAddress,
  };

  if (amount) {
    body.amount = amount;
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const respBody = await response.text();
    logError(`Deposit initiation failed: ${response.status}`, respBody);
    throw new Error(`SEP-24 deposit failed: ${response.status}`);
  }

  const data = (await response.json()) as InteractiveResponse;
  log("Deposit initiated. Transaction ID:", data.id);
  log("Interactive URL:", data.url.replace(/ /g, "%20"));
  return data;
};

export const initiateWithdrawal = async (
  config: Config,
  token: string,
  walletAddress: string,
  amount?: string,
): Promise<InteractiveResponse> => {
  const transferServer = await getTransferServerUrl(config);
  const url = `${transferServer}/transactions/withdraw/interactive`;

  log("Initiating SEP-24 withdrawal...");

  const body: Record<string, string> = {
    asset_code: "USDC",
    account: walletAddress,
  };

  if (amount) {
    body.amount = amount;
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const respBody = await response.text();
    logError(`Withdrawal initiation failed: ${response.status}`, respBody);
    throw new Error(`SEP-24 withdrawal failed: ${response.status}`);
  }

  const data = (await response.json()) as InteractiveResponse;
  log("Withdrawal initiated. Transaction ID:", data.id);
  log("Interactive URL:", data.url.replace(/ /g, "%20"));
  return data;
};

export const getTransaction = async (
  config: Config,
  token: string,
  id: string,
): Promise<Sep24Transaction> => {
  const transferServer = await getTransferServerUrl(config);
  const url = `${transferServer}/transaction?id=${encodeURIComponent(id)}`;

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Transaction query failed: ${response.status}`, body);
    throw new Error(`SEP-24 getTransaction failed: ${response.status}`);
  }

  const data = (await response.json()) as { transaction: Sep24Transaction };
  return data.transaction;
};

export const pollTransaction = async (
  config: Config,
  token: string,
  id: string,
  targetStatus: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Sep24Transaction> => {
  log(
    `Polling transaction ${id} until status: ${targetStatus} (timeout: ${timeoutMs}ms)`,
  );

  const startTime = Date.now();
  let lastStatus = "";

  while (Date.now() - startTime < timeoutMs) {
    const txn = await getTransaction(config, token, id);

    if (txn.status !== lastStatus) {
      log(`Transaction ${id} status: ${txn.status}`);
      lastStatus = txn.status;
    }

    if (txn.status === targetStatus) {
      log(`Transaction ${id} reached target status: ${targetStatus}`);
      return txn;
    }

    if (txn.status === "error" || txn.status === "expired") {
      logError(
        `Transaction ${id} reached terminal status: ${txn.status}`,
        txn.message ?? "",
      );
      throw new Error(
        `Transaction ${id} failed with status: ${txn.status}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Polling timed out after ${timeoutMs}ms for transaction ${id}`,
  );
};

/**
 * Send USDC to the anchor via the Crossmint Transactions API.
 * Creates a contract-call transaction on the USDC SAC contract.
 */
export const handleWithdrawalPayment = async (
  config: Config,
  walletAddress: string,
  transaction: Sep24Transaction,
): Promise<string> => {
  if (!transaction.withdraw_anchor_account) {
    throw new Error(
      "Transaction does not include withdraw_anchor_account",
    );
  }

  if (!transaction.amount_in) {
    throw new Error("Transaction does not include amount_in");
  }

  const amount = toBaseUnits(transaction.amount_in);
  log(
    `Sending ${transaction.amount_in} USDC (${amount} stroops) to anchor: ${transaction.withdraw_anchor_account}`,
  );

  const memo = transaction.withdraw_memo
    ? {
      type: (transaction.withdraw_memo_type === "id" ? "id" : "text") as
        | "text"
        | "id",
      value: transaction.withdraw_memo,
    }
    : undefined;

  const txn = await createTransaction(config, walletAddress, {
    contractId: config.usdcContractId,
    method: "transfer",
    args: {
      from: walletAddress,
      to: transaction.withdraw_anchor_account,
      amount,
    },
    memo,
  });

  const completed = await pollCrossmintTransaction(
    config,
    walletAddress,
    txn.id,
  );

  const txId = completed.onChain?.txId ?? txn.id;
  log("Withdrawal payment sent. Tx:", txId);
  return txId;
};
