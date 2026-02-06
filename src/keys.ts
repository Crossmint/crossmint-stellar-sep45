/**
 * Deterministic Stellar keypair derivation from seeds.
 * Given the same seed string, always produces the same Ed25519 keypair.
 * This eliminates the need to store private keys. Only store the seed.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "node:buffer";

const hashSeed = async (seed: string): Promise<Uint8Array> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(seed);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
};

export const keypairFromSeed = async (seed: string): Promise<Keypair> => {
  const rawSeed = await hashSeed(seed);
  return Keypair.fromRawEd25519Seed(Buffer.from(rawSeed));
};
