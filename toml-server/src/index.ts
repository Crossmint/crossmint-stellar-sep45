/**
 * Hono app serving the Stellar TOML file at /.well-known/stellar.toml.
 * Deployed to Vercel for client_domain authentication in SEP-10.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

// CORS is required by the Stellar protocol for TOML discovery
app.use("/*", cors());

const signingKey = Deno.env.get("TOML_SIGNING_KEY") ?? "";
const accounts = Deno.env.get("TOML_ACCOUNTS") ?? "";

const buildStellarToml = (): string => {
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

app.get("/.well-known/stellar.toml", (c) => {
  return c.text(buildStellarToml(), 200, {
    "Content-Type": "text/plain",
    "Access-Control-Allow-Origin": "*",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/", (c) => {
  return c.json({ message: "Stellar TOML server" });
});

const port = Number(Deno.env.get("PORT") ?? 8000);

Deno.serve({ port }, app.fetch);
