/**
 * HTTP client with exponential backoff retry logic.
 * Retries on 5xx status codes and network errors.
 */

import { log, logError } from "./logger.ts";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status: number): boolean => status >= 500;

export const fetchWithRetry = async (
  url: string,
  options?: RequestInit,
): Promise<Response> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
        log(
          `[Retry ${attempt}/${MAX_RETRIES}] ${
            options?.method ?? "GET"
          } ${url} returned ${response.status}. Waiting ${delayMs}ms...`,
        );
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
        logError(
          `[Retry ${attempt}/${MAX_RETRIES}] ${
            options?.method ?? "GET"
          } ${url} failed: ${lastError.message}. Waiting ${delayMs}ms...`,
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError ??
    new Error(`Request to ${url} failed after ${MAX_RETRIES} attempts`);
};
