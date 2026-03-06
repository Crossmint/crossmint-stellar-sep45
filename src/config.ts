/**
 * Environment configuration loading and validation.
 * Signer keypair is derived deterministically from SIGNER_SEED.
 */

import "@std/dotenv/load";
import { Keypair } from "@stellar/stellar-sdk";
import { keypairFromSeed } from "./keys.ts";

export type Config = {
  readonly crossmintApiKey: string;
  readonly crossmintBaseUrl: string;
  readonly anchorDomain: string;
  readonly usdcIssuer: string;
  readonly usdcContractId: string;
  readonly stellarNetwork: "testnet" | "mainnet";
  readonly signerKeypair: Keypair;
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

  const signerSeed = requireEnv("SIGNER_SEED");
  const signerKeypair = await keypairFromSeed(signerSeed);

  return {
    crossmintApiKey: requireEnv("CROSSMINT_API_KEY"),
    crossmintBaseUrl: requireEnv("CROSSMINT_BASE_URL"),
    anchorDomain: Deno.env.get("ANCHOR_DOMAIN") ?? "testanchor.stellar.org",
    usdcIssuer: requireEnv("USDC_ISSUER"),
    usdcContractId: requireEnv("USDC_CONTRACT_ID"),
    stellarNetwork: network,
    signerKeypair,
  };
};
