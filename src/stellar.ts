/**
 * Stellar Horizon operations for the bridge account.
 * Handles trustlines, payments, balance queries, and testnet funding.
 */

import {
  Asset,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";
import type { Config } from "./config.ts";

const FRIENDBOT_URL = "https://friendbot.stellar.org";
const BASE_FEE = "100";
const TRANSACTION_TIMEOUT = 180;

export const getServer = (config: Config): Horizon.Server => {
  const url = config.stellarNetwork === "testnet"
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org";
  return new Horizon.Server(url);
};

const getNetworkPassphrase = (config: Config): string =>
  config.stellarNetwork === "testnet" ? Networks.TESTNET : Networks.PUBLIC;

const getUsdcAsset = (config: Config): Asset =>
  new Asset("USDC", config.usdcIssuer);

export const fundTestnetAccount = async (
  publicKey: string,
): Promise<void> => {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;
  log("Funding testnet account via Friendbot:", publicKey);

  const response = await fetchWithRetry(url, { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    logError(`Friendbot funding failed: ${response.status}`, body);
    throw new Error(`Friendbot funding failed: ${response.status}`);
  }

  log("Testnet account funded successfully");
};

export const setupTrustline = async (config: Config): Promise<void> => {
  if (!config.bridgeKeypair) {
    throw new Error("BRIDGE_SEED is required for trustline setup");
  }
  const server = getServer(config);
  const keypair = config.bridgeKeypair;
  const publicKey = keypair.publicKey();
  const usdc = getUsdcAsset(config);

  log("Setting up USDC trustline for bridge account:", publicKey);

  const account = await server.loadAccount(publicKey);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(config),
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(TRANSACTION_TIMEOUT)
    .build();

  transaction.sign(keypair);

  const result = await server.submitTransaction(transaction);
  log("Trustline created. Transaction hash:", result.hash);
};

export type AccountBalance = {
  readonly asset: string;
  readonly balance: string;
};

export const getAccountBalances = async (
  config: Config,
  publicKey: string,
): Promise<AccountBalance[]> => {
  const server = getServer(config);
  log("Fetching balances for:", publicKey);

  const account = await server.loadAccount(publicKey);
  const balances: AccountBalance[] = account.balances.map(
    (b: Horizon.HorizonApi.BalanceLine) => {
      if (b.asset_type === "native") {
        return { asset: "XLM", balance: b.balance };
      }
      const line = b as Horizon.HorizonApi.BalanceLineAsset;
      return {
        asset: `${line.asset_code}:${line.asset_issuer}`,
        balance: line.balance,
      };
    },
  );

  log("Balances:", JSON.stringify(balances));
  return balances;
};

export const sendPayment = async (
  config: Config,
  destination: string,
  amount: string,
  memo?: string,
  memoType?: "text" | "id",
): Promise<string> => {
  if (!config.bridgeKeypair) {
    throw new Error("BRIDGE_SEED is required for sending payments");
  }
  const server = getServer(config);
  const keypair = config.bridgeKeypair;
  const publicKey = keypair.publicKey();
  const usdc = getUsdcAsset(config);

  log(
    `Sending ${amount} USDC from ${publicKey} to ${destination}`,
  );

  const account = await server.loadAccount(publicKey);
  let builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(config),
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: usdc,
        amount,
      }),
    )
    .setTimeout(TRANSACTION_TIMEOUT);

  if (memo && memoType === "id") {
    builder = builder.addMemo(new Memo("id", memo));
  } else if (memo) {
    builder = builder.addMemo(new Memo("text", memo));
  }

  const transaction = builder.build();
  transaction.sign(keypair);

  const result = await server.submitTransaction(transaction);
  log("Payment sent. Transaction hash:", result.hash);
  return result.hash;
};

export const relayToSmartWallet = async (
  config: Config,
  smartWalletAddress: string,
  amount: string,
): Promise<string> => {
  // TODO: For C... Soroban contract addresses, a SAC (Soroban Asset Contract)
  // transfer invocation is required because classic payment operations cannot
  // target C... addresses. This simplified version assumes a G... intermediate
  // address or that the smart wallet can receive classic payments.
  // A full SAC transfer would use contract.call("transfer", from, to, amount)
  // on the USDC SAC contract.
  log(
    `Relaying ${amount} USDC to smart wallet: ${smartWalletAddress}`,
  );

  if (smartWalletAddress.startsWith("C")) {
    logError(
      "Direct SAC transfer to C... addresses is not yet implemented.",
      "Use a G... intermediary or implement Soroban contract invocation.",
    );
    throw new Error(
      "SAC transfer to C... contract addresses requires Soroban invocation (not yet implemented)",
    );
  }

  return await sendPayment(config, smartWalletAddress, amount);
};
