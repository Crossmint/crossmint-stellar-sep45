/**
 * Stellar TOML host (SEP-1) as a Vercel Edge Function.
 *
 * Serves /.well-known/stellar.toml built entirely from environment variables.
 * Used for SEP-10 / SEP-45 `client_domain` attribution: an anchor fetches this
 * file to read your `SIGNING_KEY` and verify that this domain is the wallet
 * provider behind the session. Your backend holds the matching secret key.
 */

export const config = { runtime: "edge" };

const buildStellarToml = (): string => {
  const signingKey = process.env.TOML_SIGNING_KEY ?? "";
  const networkPassphrase = process.env.TOML_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015";
  const accounts = process.env.TOML_ACCOUNTS ?? "";
  const orgName = process.env.TOML_ORG_NAME ?? "";

  const accountsArray = accounts
    ? `[${accounts.split(",").map((a) => `"${a.trim()}"`).join(", ")}]`
    : "[]";

  return [
    `VERSION="2.0.0"`,
    `NETWORK_PASSPHRASE="${networkPassphrase}"`,
    `ACCOUNTS=${accountsArray}`,
    `SIGNING_KEY="${signingKey}"`,
    ``,
    `[DOCUMENTATION]`,
    `ORG_NAME="${orgName}"`,
    ``,
  ].join("\n");
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default function handler(req: Request): Response {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/.well-known/stellar.toml") {
    return new Response(buildStellarToml(), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Encoding": "identity",
        ...corsHeaders,
      },
    });
  }

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
