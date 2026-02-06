/**
 * Vercel Edge Function serving the Stellar TOML and health endpoints.
 * Uses the Edge Runtime which supports standard Web APIs.
 */

export const config = { runtime: "edge" };

const buildStellarToml = (): string => {
  const signingKey = process.env.TOML_SIGNING_KEY ?? "";
  const accounts = process.env.TOML_ACCOUNTS ?? "";
  const accountsArray = accounts ? `["${accounts}"]` : "[]";

  return `# Stellar TOML for MoneyGram x Crossmint integration

VERSION="2.0.0"

NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

ACCOUNTS=${accountsArray}

SIGNING_KEY="${signingKey}"

[DOCUMENTATION]
ORG_NAME="Crossmint MoneyGram Ramp"
`;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default function handler(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (path === "/.well-known/stellar.toml") {
    return new Response(buildStellarToml(), {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        ...corsHeaders,
      },
    });
  }

  if (path === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  }

  return new Response(JSON.stringify({ message: "Stellar TOML server" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
