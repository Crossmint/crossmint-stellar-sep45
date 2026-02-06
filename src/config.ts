/**
 * Environment configuration loading and validation.
 * Keypairs are derived deterministically from seed strings,
 * so no private keys need to be stored.
 */

import "@std/dotenv/load";
import { Keypair } from "@stellar/stellar-sdk";
import { keypairFromSeed } from "./keys.ts";

export type Config = {
  readonly crossmintApiKey: string;
  readonly crossmintBaseUrl: string;
  readonly bridgeKeypair: Keypair;
  readonly moneygramDomain: string;
  readonly usdcIssuer: string;
  readonly clientDomain: string;
  readonly clientSigningKeypair: Keypair | undefined;
  readonly stellarNetwork: "testnet" | "mainnet";
};

const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Error: ${name} environment variable is required`);
    Deno.exit(1);
  }
  return value;
};

export const loadConfig = async (): Promise<Config> => {
  const network = Deno.env.get("STELLAR_NETWORK") ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    console.error(
      `Error: STELLAR_NETWORK must be "testnet" or "mainnet", got "${network}"`,
    );
    Deno.exit(1);
  }

  const bridgeSeed = requireEnv("BRIDGE_SEED");
  const bridgeKeypair = await keypairFromSeed(bridgeSeed);

  const clientSigningSeed = Deno.env.get("CLIENT_SIGNING_SEED");
  const clientSigningKeypair = clientSigningSeed
    ? await keypairFromSeed(clientSigningSeed)
    : undefined;

  return {
    crossmintApiKey: requireEnv("CROSSMINT_API_KEY"),
    crossmintBaseUrl: requireEnv("CROSSMINT_BASE_URL"),
    bridgeKeypair,
    moneygramDomain: requireEnv("MONEYGRAM_DOMAIN"),
    usdcIssuer: requireEnv("USDC_ISSUER"),
    clientDomain: requireEnv("CLIENT_DOMAIN"),
    clientSigningKeypair,
    stellarNetwork: network,
  };
};
