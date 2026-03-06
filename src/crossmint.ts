/**
 * Crossmint Smart Wallet management for Stellar.
 * Creates wallets with external-wallet signers, retrieves wallets, checks balances.
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
  readonly token: string;
  readonly amount: string;
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
  }/balances`;
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
