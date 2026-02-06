/**
 * Timestamped logging utilities.
 * All output is prefixed with ISO 8601 timestamps.
 */

const timestamp = (): string => new Date().toISOString();

export const log = (message: string, ...args: unknown[]): void => {
  const parts = [message, ...args.map((a) =>
    typeof a === "object" ? JSON.stringify(a) : String(a)
  )];
  console.log(`[${timestamp()}] ${parts.join(" ")}`);
};

export const logError = (message: string, ...args: unknown[]): void => {
  const parts = [message, ...args.map((a) =>
    typeof a === "object" ? JSON.stringify(a) : String(a)
  )];
  console.error(`[${timestamp()}] ERROR: ${parts.join(" ")}`);
};
