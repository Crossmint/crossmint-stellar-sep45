/**
 * Generate a deterministic Stellar Ed25519 keypair from a seed string.
 * The same seed always produces the same keypair.
 *
 * Usage:
 *   deno task generate-keys --seed "my-bridge-account"
 *   deno task generate-keys --seed "my-client-domain"
 */

import { parseArgs } from "@std/cli/parse-args";
import { keypairFromSeed } from "../src/keys.ts";

const main = async (): Promise<void> => {
  const args = parseArgs(Deno.args, {
    string: ["seed"],
  });

  if (!args.seed) {
    console.error("Error: --seed is required");
    console.error("Usage: deno task generate-keys --seed <seed-string>");
    Deno.exit(1);
  }

  const keypair = await keypairFromSeed(args.seed);

  console.log("Stellar Keypair (Deterministic)");
  console.log("=".repeat(60));
  console.log(`Seed:        ${args.seed}`);
  console.log(`Public Key:  ${keypair.publicKey()}`);
  console.log(`Secret Key:  ${keypair.secret()}`);
  console.log("=".repeat(60));
  console.log("Same seed will always produce the same keypair.");
};

main();
