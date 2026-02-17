/**
 * SEP-45 Web Authentication for Stellar contract accounts (C... addresses).
 * Handles TOML discovery, Soroban authorization entry signing, and JWT retrieval.
 * This enables smart wallets to authenticate with anchors without a bridge account.
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md
 */

import { rpc, StrKey, xdr } from "@stellar/stellar-sdk";
import jsXdrLib from "@stellar/js-xdr";
import { Buffer } from "node:buffer";
import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";
import type { Config } from "./config.ts";

const { XdrReader, XdrWriter } = jsXdrLib;

type Sep45ChallengeResponse = {
  readonly authorizationEntries: string;
  readonly networkPassphrase: string;
};

const SOROBAN_TESTNET_URL = "https://soroban-testnet.stellar.org";
const SOROBAN_MAINNET_URL = "https://soroban.stellar.org";

const getSorobanServerUrl = (config: Config): string =>
  config.stellarNetwork === "testnet"
    ? SOROBAN_TESTNET_URL
    : SOROBAN_MAINNET_URL;

/**
 * Decode a base64 XDR variable-length array of SorobanAuthorizationEntry.
 * Uses XdrReader to parse entries sequentially without the EOF check
 * that fromXDR enforces (which fails on partial buffers).
 */
const decodeAuthEntries = (
  base64Xdr: string,
): xdr.SorobanAuthorizationEntry[] => {
  const buffer = Buffer.from(base64Xdr, "base64");
  const reader = new XdrReader(buffer);
  const count = reader.readUInt32BE();
  const entries: xdr.SorobanAuthorizationEntry[] = [];

  for (let i = 0; i < count; i++) {
    entries.push(xdr.SorobanAuthorizationEntry.read(reader));
  }

  return entries;
};

/**
 * Encode an array of SorobanAuthorizationEntry to base64 XDR.
 */
const encodeAuthEntries = (
  entries: xdr.SorobanAuthorizationEntry[],
): string => {
  const writer = new XdrWriter();
  writer.writeUInt32BE(entries.length);
  for (const entry of entries) {
    xdr.SorobanAuthorizationEntry.write(entry, writer);
  }
  return Buffer.from(writer.toArray()).toString("base64");
};

/**
 * Check if an authorization entry's signature is empty (needs signing).
 */
const isUnsignedEntry = (entry: xdr.SorobanAuthorizationEntry): boolean => {
  const creds = entry.credentials();
  if (
    creds.switch() !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress()
  ) {
    return false;
  }
  const addrCreds = creds.address();
  const sig = addrCreds.signature();
  return sig.switch() === xdr.ScValType.scvVoid() ||
    (sig.switch() === xdr.ScValType.scvMap() &&
      (sig.value() === null || (sig.value() as unknown[]).length === 0));
};

/**
 * Extract the address string from a SorobanAuthorizationEntry's credentials.
 */
const getEntryAddress = (
  entry: xdr.SorobanAuthorizationEntry,
): string | null => {
  const creds = entry.credentials();
  if (
    creds.switch() !==
      xdr.SorobanCredentialsType.sorobanCredentialsAddress()
  ) {
    return null;
  }
  const addr = creds.address().address();
  if (addr.switch() === xdr.ScAddressType.scAddressTypeContract()) {
    return StrKey.encodeContract(addr.contractId());
  }
  if (addr.switch() === xdr.ScAddressType.scAddressTypeAccount()) {
    return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
  }
  return null;
};

/**
 * Log details about each authorization entry for debugging.
 */
const logEntries = (entries: xdr.SorobanAuthorizationEntry[]): void => {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const creds = entry.credentials();
    const credType = creds.switch().name;
    const unsigned = isUnsignedEntry(entry);
    const addr = getEntryAddress(entry);
    log(
      `  Entry ${i}: credentials=${credType}, address=${
        addr ?? "n/a"
      }, needsSignature=${unsigned}`,
    );
  }
};

/**
 * Fetch SEP-45 TOML fields from an anchor domain.
 */
export const fetchSep45Toml = async (
  domain: string,
): Promise<{
  authEndpoint: string;
  contractId: string;
}> => {
  const url = `https://${domain}/.well-known/stellar.toml`;
  log("Fetching TOML for SEP-45:", url);

  const response = await fetchWithRetry(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`TOML fetch failed: ${response.status}`);
  }

  const text = await response.text();
  const parseValue = (key: string): string => {
    const regex = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m");
    const match = text.match(regex);
    return match ? match[1] : "";
  };

  const authEndpoint = parseValue("WEB_AUTH_FOR_CONTRACTS_ENDPOINT");
  const contractId = parseValue("WEB_AUTH_CONTRACT_ID");

  if (!authEndpoint) {
    throw new Error(
      "WEB_AUTH_FOR_CONTRACTS_ENDPOINT not found in anchor TOML. This anchor does not support SEP-45.",
    );
  }

  log("SEP-45 auth endpoint:", authEndpoint);
  log("SEP-45 contract ID:", contractId);
  return { authEndpoint, contractId };
};

/**
 * Fetch the SEP-45 challenge for a contract account.
 */
const fetchChallenge = async (
  authEndpoint: string,
  contractAddress: string,
  homeDomain: string,
): Promise<Sep45ChallengeResponse> => {
  const params = new URLSearchParams({
    account: contractAddress,
    home_domain: homeDomain,
  });

  const url = `${authEndpoint}?${params.toString()}`;
  log("Requesting SEP-45 challenge:", url);

  const response = await fetchWithRetry(url, { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    logError(`SEP-45 challenge failed: ${response.status}`, body);
    throw new Error(`SEP-45 challenge failed: ${response.status}`);
  }

  return (await response.json()) as Sep45ChallengeResponse;
};

/**
 * Sign a Soroban authorization entry using the Crossmint Signatures API.
 *
 * TODO: Crossmint to implement this.
 *
 * Crossmint needs to add Stellar support to their Signatures API:
 *   - POST /wallets/{walletLocator}/signatures  (create signature)
 *   - POST /wallets/{walletLocator}/signatures/{signatureId}/approvals  (approve)
 *
 * The entry needs to be signed by the wallet's admin signer (Ed25519 key that
 * Crossmint holds for api-key type signers). The signing process is:
 *   1. Serialize the entry's rootInvocation + nonce + network passphrase into
 *      a HashIdPreimage, SHA-256 hash it
 *   2. Ed25519-sign the 32-byte hash with the admin signer key
 *   3. Set the entry's credentials.address.signature to the resulting signature
 *
 * The Stellar SDK's `authorizeEntry(entry, signer, validUntilLedger, networkPassphrase)`
 * handles all of this when given a Keypair. Crossmint would need to either:
 *   a) Accept the raw entry XDR + ledger + network and return the signed entry, or
 *   b) Accept the 32-byte hash for raw Ed25519 signing (we construct the entry)
 *
 * Current status: the Signatures API returns
 *   "Signature type 'message' not supported for wallet type 'stellar-smart-wallet'"
 *
 * Docs:
 *   https://docs.crossmint.com/api-reference/wallets/create-signature
 *   https://docs.crossmint.com/api-reference/wallets/approve-signature
 */
const signEntryWithCrossmint = async (
  _config: Config,
  _walletAddress: string,
  entry: xdr.SorobanAuthorizationEntry,
  _validUntilLedgerSeq: number,
  _networkPassphrase: string,
): Promise<xdr.SorobanAuthorizationEntry> => {
  // TODO: Crossmint to implement Stellar signature support.
  //
  // Expected flow:
  //
  // 1. Create signature request:
  //    POST {baseUrl}/wallets/{walletAddress}/signatures
  //    Body: { type: "soroban-auth-entry", params: { entry: entryXdrBase64, validUntilLedgerSeq, networkPassphrase } }
  //
  // 2. Approve signature (for api-key signers, auto-approved):
  //    POST {baseUrl}/wallets/{walletAddress}/signatures/{signatureId}/approvals
  //
  // 3. Poll or receive the signed entry XDR back.
  //
  // 4. Return the signed SorobanAuthorizationEntry.

  log(
    "WARNING: Crossmint signing not yet available for Stellar wallets.",
  );
  log(
    "Returning unsigned entry. The anchor will reject this submission.",
  );
  return entry;
};

/**
 * Submit signed authorization entries to get a JWT.
 */
const submitSignedEntries = async (
  authEndpoint: string,
  signedEntriesXdr: string,
): Promise<string> => {
  log("Submitting signed SEP-45 entries to:", authEndpoint);

  // No retry: the challenge nonce is single-use, so retrying would fail
  const response = await fetch(authEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `authorization_entries=${encodeURIComponent(signedEntriesXdr)}`,
  });

  if (!response.ok) {
    const body = await response.text();
    logError(`SEP-45 token request failed: ${response.status}`, body);
    throw new Error(`SEP-45 authentication failed: ${response.status}`);
  }

  const data = (await response.json()) as { token: string };
  if (!data.token) {
    throw new Error("SEP-45 authentication did not return a token");
  }

  return data.token;
};

/**
 * Full SEP-45 authentication flow for a Crossmint smart wallet.
 *
 * Unlike SEP-10 (which requires a G... bridge account), SEP-45 authenticates
 * the C... contract address directly. The anchor sends Soroban authorization
 * entries that the wallet's admin signer must sign.
 *
 * Once Crossmint adds Stellar support to their Signatures API, this flow
 * will work end-to-end without any bridge account.
 */
export const authenticateSep45 = async (
  config: Config,
  walletAddress: string,
  anchorDomain: string,
): Promise<string> => {
  // Step 1: Discover SEP-45 endpoint from TOML
  const { authEndpoint } = await fetchSep45Toml(anchorDomain);

  // Step 2: Fetch challenge
  const challenge = await fetchChallenge(
    authEndpoint,
    walletAddress,
    anchorDomain,
  );
  log("SEP-45 challenge received. Network:", challenge.networkPassphrase);

  // Step 3: Decode authorization entries
  const entries = decodeAuthEntries(challenge.authorizationEntries);
  log(`Challenge contains ${entries.length} authorization entries:`);
  logEntries(entries);

  // Step 4: Get current ledger sequence for signature expiration
  const sorobanServer = new rpc.Server(getSorobanServerUrl(config));
  const latestLedger = await sorobanServer.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + 100;
  log(
    `Current ledger: ${latestLedger.sequence}, signature valid until: ${validUntilLedgerSeq}`,
  );

  // Step 5: Sign unsigned entries via Crossmint
  const signedEntries = await Promise.all(
    entries.map(async (entry) => {
      if (isUnsignedEntry(entry)) {
        log("Signing authorization entry via Crossmint...");
        return await signEntryWithCrossmint(
          config,
          walletAddress,
          entry,
          validUntilLedgerSeq,
          challenge.networkPassphrase,
        );
      }
      return entry;
    }),
  );

  // Step 6: Encode and submit
  const signedXdr = encodeAuthEntries(signedEntries);
  const token = await submitSignedEntries(authEndpoint, signedXdr);

  log("SEP-45 authentication successful.");
  return token;
};
