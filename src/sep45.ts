/**
 * SEP-45 Web Authentication for Stellar contract accounts (C... addresses).
 * Handles TOML discovery, Soroban authorization entry signing, and JWT retrieval.
 * Uses external-wallet signer: creates signature request, signs locally, submits approval.
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md
 */

import { authorizeEntry, rpc, StrKey, xdr } from "@stellar/stellar-sdk";
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

type SignerInfo = {
  readonly type: string;
  readonly address: string;
  readonly locator: string;
};

type SignatureResponse = {
  readonly id: string;
  readonly status: string;
  readonly outputSignature?: string;
  readonly error?: unknown;
  readonly approvals?: {
    readonly pending?: ReadonlyArray<{
      readonly signer: SignerInfo;
      readonly message: string;
    }>;
    readonly submitted?: ReadonlyArray<unknown>;
  };
};

const SOROBAN_TESTNET_URL = "https://soroban-testnet.stellar.org";
const SOROBAN_MAINNET_URL = "https://soroban.stellar.org";

const getSorobanServerUrl = (config: Config): string =>
  config.stellarNetwork === "testnet"
    ? SOROBAN_TESTNET_URL
    : SOROBAN_MAINNET_URL;

/**
 * Decode a base64 XDR variable-length array of SorobanAuthorizationEntry.
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

const fetchChallenge = async (
  authEndpoint: string,
  contractAddress: string,
  homeDomain: string,
  clientDomain?: string,
): Promise<Sep45ChallengeResponse> => {
  const params = new URLSearchParams({
    account: contractAddress,
    home_domain: homeDomain,
  });
  if (clientDomain) {
    params.set("client_domain", clientDomain);
  }

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
 * Sign all Soroban authorization entries using the Crossmint Signatures API
 * with an external-wallet signer. Sends all entries in a single request.
 *
 * Flow:
 * 1. POST signature request with all entries -> status: "awaiting-approval"
 * 2. Get the pending preimage hash from approvals.pending[0].message
 * 3. Ed25519-sign the hash locally with our keypair
 * 4. POST the approval with the signature
 * 5. Poll until status: "success" -> get signed entries back
 */
const signEntriesWithCrossmint = async (
  config: Config,
  walletAddress: string,
  authorizationEntriesXdr: string,
): Promise<xdr.SorobanAuthorizationEntry[]> => {
  const apiHeaders = {
    "x-api-key": config.crossmintApiKey,
    "Content-Type": "application/json",
  };

  // 1. Create signature request with all entries
  const createUrl =
    `${config.crossmintBaseUrl}/wallets/${walletAddress}/signatures`;
  const createRes = await fetchWithRetry(createUrl, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      type: "auth-entries",
      params: { authorizationEntries: authorizationEntriesXdr },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Signature creation failed: ${createRes.status} ${body}`);
  }

  const sigReq = (await createRes.json()) as SignatureResponse;
  log(`Signature request created: ${sigReq.id}, status: ${sigReq.status}`);

  // 2. Get the pending approval -- may need to poll if not immediately available
  const getUrl =
    `${config.crossmintBaseUrl}/wallets/${walletAddress}/signatures/${sigReq.id}`;
  let pending = sigReq.approvals?.pending?.[0];

  if (!pending) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetchWithRetry(getUrl, {
      method: "GET",
      headers: { "x-api-key": config.crossmintApiKey },
    });
    const pollData = (await pollRes.json()) as SignatureResponse;
    pending = pollData.approvals?.pending?.[0];
  }

  if (!pending) {
    throw new Error("No pending approval found in signature request");
  }

  const signerLocator = pending.signer.locator;
  log(`Pending approval for signer: ${signerLocator}`);
  log(
    `Message to sign (preimage hash): ${pending.message.substring(0, 20)}...`,
  );

  // 3. Sign the preimage hash locally with our Ed25519 keypair
  const messageBytes = Buffer.from(pending.message, "base64");
  const signatureBytes = config.signerKeypair.sign(messageBytes);
  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");
  log("Signed preimage hash locally with Ed25519 keypair");

  // 4. Submit the approval
  const approvalUrl =
    `${config.crossmintBaseUrl}/wallets/${walletAddress}/signatures/${sigReq.id}/approvals`;
  const approvalRes = await fetchWithRetry(approvalUrl, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({
      approvals: [{
        signer: signerLocator,
        signature: signatureBase64,
      }],
    }),
  });

  if (!approvalRes.ok) {
    const body = await approvalRes.text();
    throw new Error(
      `Approval submission failed: ${approvalRes.status} ${body}`,
    );
  }

  log("Approval submitted, polling for completion...");

  // 5. Poll until success
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetchWithRetry(getUrl, {
      method: "GET",
      headers: { "x-api-key": config.crossmintApiKey },
    });

    if (!statusRes.ok) {
      throw new Error(`Signature poll failed: ${statusRes.status}`);
    }

    const sig = (await statusRes.json()) as SignatureResponse;
    log(`Signature ${sigReq.id} status: ${sig.status}`);

    if (sig.status === "failed") {
      throw new Error(`Signature failed: ${JSON.stringify(sig.error)}`);
    }
    if (sig.status === "success") {
      const outputXdr = sig.outputSignature;
      if (!outputXdr) {
        throw new Error("Signature succeeded but no outputSignature returned");
      }
      return decodeAuthEntries(outputXdr);
    }
  }
};

const submitSignedEntries = async (
  authEndpoint: string,
  signedEntriesXdr: string,
): Promise<string> => {
  log("Submitting signed SEP-45 entries to:", authEndpoint);

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
 * Sign the client_domain authorization entry locally with the client-domain
 * keypair. The anchor adds this entry when a client_domain is supplied; its
 * address is the SIGNING_KEY published in that domain's stellar.toml.
 */
const signClientDomainEntry = async (
  config: Config,
  entries: xdr.SorobanAuthorizationEntry[],
  networkPassphrase: string,
): Promise<xdr.SorobanAuthorizationEntry[]> => {
  const keypair = config.clientDomainKeypair!;
  const publicKey = keypair.publicKey();

  const sorobanServer = new rpc.Server(getSorobanServerUrl(config));
  const latestLedger = await sorobanServer.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + 100;
  log(
    `Signing client_domain entry for ${publicKey} (valid until ledger ${validUntilLedgerSeq})`,
  );

  const result: xdr.SorobanAuthorizationEntry[] = [];
  let signed = false;
  for (const entry of entries) {
    if (
      !signed && getEntryAddress(entry) === publicKey && isUnsignedEntry(entry)
    ) {
      result.push(
        await authorizeEntry(
          entry,
          keypair,
          validUntilLedgerSeq,
          networkPassphrase,
        ),
      );
      signed = true;
    } else {
      result.push(entry);
    }
  }

  if (!signed) {
    throw new Error(
      `client_domain is set but the challenge has no unsigned entry for ${publicKey}. Confirm the anchor allowlisted the domain and its stellar.toml SIGNING_KEY matches.`,
    );
  }
  return result;
};

/**
 * Full SEP-45 authentication flow.
 *
 * SEP-45 authenticates the C... contract address directly. Crossmint signs the
 * wallet entry; when client_domain attribution is configured, that extra entry
 * is signed locally with the client-domain keypair first.
 */
export const authenticateSep45 = async (
  config: Config,
  walletAddress: string,
  anchorDomain: string,
): Promise<string> => {
  const { authEndpoint } = await fetchSep45Toml(anchorDomain);

  const challenge = await fetchChallenge(
    authEndpoint,
    walletAddress,
    anchorDomain,
    config.clientDomain,
  );
  log("SEP-45 challenge received. Network:", challenge.networkPassphrase);

  let entries = decodeAuthEntries(challenge.authorizationEntries);
  log(`Challenge contains ${entries.length} authorization entries:`);
  logEntries(entries);

  if (config.clientDomain && config.clientDomainKeypair) {
    entries = await signClientDomainEntry(
      config,
      entries,
      challenge.networkPassphrase,
    );
  }

  log("Signing wallet authorization entry via Crossmint...");
  const signedEntries = await signEntriesWithCrossmint(
    config,
    walletAddress,
    encodeAuthEntries(entries),
  );
  log(`Received ${signedEntries.length} signed entries from Crossmint`);

  const signedXdr = encodeAuthEntries(signedEntries);
  const token = await submitSignedEntries(authEndpoint, signedXdr);

  log("SEP-45 authentication successful.");
  return token;
};
