/**
 * Crossmint Smart Wallet management for Stellar.
 * Creates and retrieves wallets, checks balances via Crossmint API.
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

export const createWallet = async (
  config: Config,
): Promise<CrossmintWallet> => {
  const url = `${config.crossmintBaseUrl}/wallets`;
  log("Creating Crossmint Stellar smart wallet...");

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      type: "stellar-smart-wallet",
      config: {
        adminSigner: { type: "api-key" },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`Failed to create wallet: ${response.status}`, body);
    throw new Error(`Crossmint createWallet failed: ${response.status}`);
  }

  const wallet = (await response.json()) as CrossmintWallet;
  log("Wallet created:", wallet.address);
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
