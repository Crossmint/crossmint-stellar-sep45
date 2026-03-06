/**
 * Stellar TOML discovery.
 * Fetches and parses stellar.toml from anchor domains.
 */

import { fetchWithRetry } from "./http.ts";
import { log, logError } from "./logger.ts";

export type TomlData = {
  readonly WEB_AUTH_ENDPOINT: string;
  readonly WEB_AUTH_FOR_CONTRACTS_ENDPOINT: string;
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
    WEB_AUTH_FOR_CONTRACTS_ENDPOINT: parseTomlValue(
      text,
      "WEB_AUTH_FOR_CONTRACTS_ENDPOINT",
    ),
    TRANSFER_SERVER_SEP0024: parseTomlValue(text, "TRANSFER_SERVER_SEP0024"),
    SIGNING_KEY: parseTomlValue(text, "SIGNING_KEY"),
    NETWORK_PASSPHRASE: parseTomlValue(text, "NETWORK_PASSPHRASE"),
  };

  log("TOML data:", JSON.stringify(data));
  return data;
};
