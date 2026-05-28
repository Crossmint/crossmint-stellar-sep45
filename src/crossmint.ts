/**
 * Crossmint Smart Wallet management for Stellar.
 * Creates wallets, retrieves wallets, checks balances, and sends transactions.
 */

import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";
import type { Config } from "./config.ts";

export type CrossmintWallet = {
  readonly address: string;
  readonly type: string;
  readonly config?: {
    readonly adminSigner?: {
      readonly type: string;
      readonly address: string;
      readonly locator: string;
    };
  };
};

export type CrossmintBalance = {
  readonly symbol: string;
  readonly name: string;
  readonly amount: string;
};

export type CrossmintTransaction = {
  readonly id: string;
  readonly status: string;
  readonly onChain?: {
    readonly txId?: string;
  };
  readonly error?: unknown;
};

const buildHeaders = (config: Config): Record<string, string> => ({
  "x-api-key": config.crossmintApiKey,
  "Content-Type": "application/json",
});

/**
 * Create a Stellar smart wallet with the signer keypair as external-wallet admin.
 * Idempotent: passing the same idempotencyKey returns the existing wallet.
 */
export const createWallet = async (
  config: Config,
  idempotencyKey?: string,
): Promise<CrossmintWallet> => {
  const url = `${config.crossmintBaseUrl}/wallets`;
  const signerAddress = config.signerKeypair.publicKey();
  log("Creating Crossmint Stellar smart wallet...");
  log("External signer (G...):", signerAddress);

  const headers: Record<string, string> = buildHeaders(config);
  if (idempotencyKey) {
    headers["x-idempotency-key"] = idempotencyKey;
    log("Using idempotency key:", idempotencyKey);
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chainType: "stellar",
      type: "smart",
      config: {
        adminSigner: { type: "external-wallet", address: signerAddress },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Failed to create wallet: ${response.status}`, body);
    throw new Error(`Crossmint createWallet failed: ${response.status}`);
  }

  const wallet = (await response.json()) as CrossmintWallet;
  const wasCreated = response.status === 201;
  log(
    wasCreated ? "Wallet created:" : "Existing wallet returned:",
    wallet.address,
  );
  return wallet;
};

export const getWallet = async (
  config: Config,
  locator: string,
): Promise<CrossmintWallet> => {
  const url = `${config.crossmintBaseUrl}/wallets/${
    encodeURIComponent(locator)
  }`;
  log("Fetching wallet:", locator);

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: buildHeaders(config),
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Failed to get wallet: ${response.status}`, body);
    throw new Error(`Crossmint getWallet failed: ${response.status}`);
  }

  const wallet = (await response.json()) as CrossmintWallet;
  log("Wallet retrieved:", wallet.address);
  return wallet;
};

export const getBalances = async (
  config: Config,
  locator: string,
): Promise<CrossmintBalance[]> => {
  const url = `${config.crossmintBaseUrl}/wallets/${
    encodeURIComponent(locator)
  }/balances?tokens=usdc,xlm`;
  log("Fetching wallet balances:", locator);

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: buildHeaders(config),
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Failed to get balances: ${response.status}`, body);
    throw new Error(`Crossmint getBalances failed: ${response.status}`);
  }

  const balances = (await response.json()) as CrossmintBalance[];
  log("Balances retrieved:", JSON.stringify(balances));
  return balances;
};

/**
 * Create a Stellar smart wallet transaction via the Crossmint API.
 * Used for sending USDC to anchor during SEP-24 withdrawals.
 */
export const createTransaction = async (
  config: Config,
  walletAddress: string,
  params: {
    contractId: string;
    method: string;
    args: Record<string, string>;
    memo?: { type: "text" | "id"; value: string };
  },
): Promise<CrossmintTransaction> => {
  const url =
    `${config.crossmintBaseUrl}/wallets/${walletAddress}/transactions`;
  log("Creating Stellar transaction via Crossmint...");

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      params: {
        transaction: {
          type: "contract-call",
          ...params,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Transaction creation failed: ${response.status}`, body);
    throw new Error(`Crossmint createTransaction failed: ${response.status}`);
  }

  const txn = (await response.json()) as CrossmintTransaction;
  log("Transaction created:", txn.id, "status:", txn.status);
  return txn;
};

export const getCrossmintTransaction = async (
  config: Config,
  walletAddress: string,
  transactionId: string,
): Promise<CrossmintTransaction> => {
  const url =
    `${config.crossmintBaseUrl}/wallets/${walletAddress}/transactions/${transactionId}`;

  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: { "x-api-key": config.crossmintApiKey },
  });

  if (!response.ok) {
    throw new Error(
      `Crossmint getTransaction failed: ${response.status}`,
    );
  }

  return (await response.json()) as CrossmintTransaction;
};

/**
 * Poll a Crossmint transaction until it reaches "success" status.
 */
export const pollCrossmintTransaction = async (
  config: Config,
  walletAddress: string,
  transactionId: string,
  timeoutMs = 120000,
): Promise<CrossmintTransaction> => {
  log(`Polling Crossmint transaction ${transactionId}...`);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const txn = await getCrossmintTransaction(
      config,
      walletAddress,
      transactionId,
    );
    log(`Transaction ${transactionId} status: ${txn.status}`);

    if (txn.status === "success") {
      return txn;
    }
    if (txn.status === "failed") {
      throw new Error(
        `Transaction failed: ${JSON.stringify(txn.error)}`,
      );
    }
  }

  throw new Error(
    `Polling timed out after ${timeoutMs}ms for transaction ${transactionId}`,
  );
};
