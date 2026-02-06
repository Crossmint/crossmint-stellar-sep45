/**
 * SEP-10 Web Authentication for Stellar anchors.
 * Handles TOML discovery and challenge-response signing with the bridge keypair.
 */

import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";
import type { Config } from "./config.ts";

export type TomlData = {
  readonly WEB_AUTH_ENDPOINT: string;
  readonly TRANSFER_SERVER_SEP0024: string;
  readonly SIGNING_KEY: string;
  readonly NETWORK_PASSPHRASE: string;
};

const parseTomlValue = (toml: string, key: string): string => {
  const regex = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m");
  const match = toml.match(regex);
  return match ? match[1] : "";
};

export const fetchToml = async (domain: string): Promise<TomlData> => {
  const url = `https://${domain}/.well-known/stellar.toml`;
  log("Fetching TOML from:", url);

  const response = await fetchWithRetry(url, { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    logError(`Failed to fetch TOML: ${response.status}`, body);
    throw new Error(`TOML fetch failed: ${response.status}`);
  }

  const text = await response.text();
  const data: TomlData = {
    WEB_AUTH_ENDPOINT: parseTomlValue(text, "WEB_AUTH_ENDPOINT"),
    TRANSFER_SERVER_SEP0024: parseTomlValue(text, "TRANSFER_SERVER_SEP0024"),
    SIGNING_KEY: parseTomlValue(text, "SIGNING_KEY"),
    NETWORK_PASSPHRASE: parseTomlValue(text, "NETWORK_PASSPHRASE"),
  };

  log("TOML data:", JSON.stringify(data));
  return data;
};

export const authenticate = async (config: Config): Promise<string> => {
  const bridgeKeypair = config.bridgeKeypair;
  const bridgePublicKey = bridgeKeypair.publicKey();

  // Step 1: Fetch TOML from anchor domain
  const toml = await fetchToml(config.moneygramDomain);

  if (!toml.WEB_AUTH_ENDPOINT) {
    throw new Error("WEB_AUTH_ENDPOINT not found in anchor TOML");
  }

  // Step 2: Request challenge from the anchor
  const challengeParams = new URLSearchParams({
    account: bridgePublicKey,
    home_domain: config.moneygramDomain,
  });

  if (config.clientDomain) {
    challengeParams.set("client_domain", config.clientDomain);
  }

  const challengeUrl =
    `${toml.WEB_AUTH_ENDPOINT}?${challengeParams.toString()}`;
  log("Requesting SEP-10 challenge:", challengeUrl);

  const challengeResponse = await fetchWithRetry(challengeUrl, {
    method: "GET",
  });

  if (!challengeResponse.ok) {
    const body = await challengeResponse.text();
    logError(
      `SEP-10 challenge request failed: ${challengeResponse.status}`,
      body,
    );
    throw new Error(
      `SEP-10 challenge failed: ${challengeResponse.status}`,
    );
  }

  const challengeData = (await challengeResponse.json()) as {
    transaction: string;
    network_passphrase: string;
  };

  log(
    "Challenge received. Network passphrase:",
    challengeData.network_passphrase,
  );

  // Step 3: Decode and validate the challenge XDR per SEP-10
  const networkPassphrase = challengeData.network_passphrase;
  const decoded = TransactionBuilder.fromXDR(
    challengeData.transaction,
    networkPassphrase,
  );

  // SEP-10 challenges are always regular Transactions, never FeeBumpTransactions
  if (decoded instanceof FeeBumpTransaction) {
    throw new Error("SEP-10 challenge must be a regular Transaction, not a FeeBumpTransaction");
  }
  const transaction = decoded;

  // Validate sequence number is 0 (proves this is a challenge, not a real tx)
  if (transaction.sequence !== "0") {
    throw new Error("SEP-10 challenge must have sequence number 0");
  }

  // Validate timebounds are present and current
  const timeBounds = transaction.timeBounds;
  if (!timeBounds) {
    throw new Error("SEP-10 challenge must have timebounds");
  }
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(timeBounds.minTime) || now > Number(timeBounds.maxTime)) {
    throw new Error(
      "SEP-10 challenge timebounds have expired or are not yet valid",
    );
  }

  // Validate source account matches anchor's SIGNING_KEY
  if (transaction.source !== toml.SIGNING_KEY) {
    throw new Error(
      `SEP-10 challenge source account ${transaction.source} does not match anchor SIGNING_KEY ${toml.SIGNING_KEY}`,
    );
  }

  log("SEP-10 challenge validated: sequence=0, timebounds valid, source matches anchor");

  // Sign with the bridge keypair
  transaction.sign(bridgeKeypair);
  log("Challenge signed with bridge keypair:", bridgePublicKey);

  // Sign with client_domain signing keypair if provided
  if (config.clientSigningKeypair) {
    transaction.sign(config.clientSigningKeypair);
    log(
      "Challenge also signed with client_domain key:",
      config.clientSigningKeypair.publicKey(),
    );
  }

  const signedXdr = transaction.toXDR();

  // Step 4: Submit signed challenge to get JWT
  log("Submitting signed challenge to:", toml.WEB_AUTH_ENDPOINT);

  const tokenResponse = await fetchWithRetry(toml.WEB_AUTH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXdr }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    logError(`SEP-10 token request failed: ${tokenResponse.status}`, body);
    throw new Error(
      `SEP-10 authentication failed: ${tokenResponse.status}`,
    );
  }

  const tokenData = (await tokenResponse.json()) as { token: string };

  if (!tokenData.token) {
    throw new Error("SEP-10 authentication did not return a token");
  }

  log("SEP-10 authentication successful. Token received.");
  return tokenData.token;
};
