# MoneyGram x Crossmint Stellar Integration POC

Headless CLI proof-of-concept that integrates MoneyGram's cash-to-USDC on-ramp
and USDC-to-cash off-ramp using Crossmint Smart Wallets on Stellar. Built with
Deno 2.x.

## Architecture

This POC uses the **Bridge Account Pattern** (Option B). A local Ed25519 keypair
acts as an intermediary between MoneyGram's anchor and the Crossmint smart
wallet. See [docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md) for
the full rationale.

```
                         Deposit (Cash to USDC)
                         ======================

  User deposits cash         MoneyGram sends USDC       CLI relays USDC
  at MoneyGram store         to bridge account           to smart wallet
        |                          |                          |
        v                          v                          v
  +-----------+    SEP-10    +-------------+   Payment   +-----------------+
  | MoneyGram | <----------> |   Bridge    | ----------> |    Crossmint    |
  |  Anchor   |    SEP-24    |   Account   |   (relay)   |  Smart Wallet   |
  +-----------+              |  (G... key) |             |  (C... address) |
                             +-------------+             +-----------------+
                                   ^
                                   |
                             +-------------+
                             |  TOML Server |  (client_domain verification)
                             | (Vercel)     |
                             +-------------+

                        Withdrawal (USDC to Cash)
                        =========================

  CLI sends USDC from        MoneyGram provides         User picks up cash
  bridge to anchor            reference code             at MoneyGram store
        |                          |                          |
        v                          v                          v
  +-----------------+        +-------------+           +-----------+
  |    Crossmint    |        |   Bridge    |  SEP-24   | MoneyGram |
  |  Smart Wallet   | -----> |   Account   | --------> |  Anchor   |
  |  (C... address) |        |  (G... key) |  Payment  +-----------+
  +-----------------+        +-------------+
```

**Why a bridge account?** Three constraints require it:

1. [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
   authentication only accepts G... (Ed25519) addresses, not C... (Soroban
   contract) addresses
2. Crossmint does not expose an API to sign arbitrary Stellar XDR (needed for
   SEP-10 challenges)
3. MoneyGram sends USDC via classic payment operations, which cannot target C...
   addresses

## Prerequisites

- [Deno 2.x](https://deno.land/) installed
- A [Crossmint](https://www.crossmint.com/) staging API key
- Access to MoneyGram's Stellar sandbox (requires onboarding)
- A deployed TOML server (Vercel recommended) for client_domain verification

## Quick Start

### 1. Install dependencies

```bash
deno install
```

### 2. Configure environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

### 3. Generate keypairs

Generate deterministic keypairs for the bridge account and client domain
signing:

```bash
deno task generate-keys --seed "my-bridge-account"
deno task generate-keys --seed "my-client-domain"
```

Set `BRIDGE_SEED` and `CLIENT_SIGNING_SEED` in `.env` to the seed strings you
chose. Put the public key from the client domain keypair into your TOML server's
`SIGNING_KEY`.

### 4. Set up the bridge account

Fund the bridge account on testnet and establish the USDC trustline:

```bash
deno task cli setup
```

### 5. Create a Crossmint smart wallet

```bash
# Use --key for idempotent creation (same key = same wallet)
deno task cli wallet --key "my-user-wallet"
```

### 6. Authenticate with MoneyGram

```bash
deno task cli auth
```

### 7. Deposit or withdraw

```bash
deno task cli deposit --amount 100
deno task cli withdraw --amount 50
```

## CLI Commands

All commands are run via `deno task cli <command> [options]`.

### wallet

Create a new Crossmint smart wallet or retrieve an existing one. Use `--key` for
idempotent creation (same key always returns the same wallet).

```bash
# Create a new wallet (idempotent with --key)
deno task cli wallet --key "my-user-wallet"

# Create a new wallet (no idempotency, creates a new wallet each time)
deno task cli wallet

# Retrieve an existing wallet by locator
deno task cli wallet --locator "email:user@example.com"
```

### setup

Fund the bridge account on testnet (via Friendbot) and establish a USDC
trustline.

```bash
deno task cli setup
```

### auth

Authenticate with the MoneyGram anchor using
[SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
challenge-response. The resulting JWT is saved to `.auth-token` for subsequent
commands.

```bash
deno task cli auth
```

### deposit

Initiate a cash-to-USDC deposit via
[SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md).
Opens an interactive URL for KYC completion. Polls for completion automatically.

```bash
deno task cli deposit --amount 100
```

### withdraw

Initiate a USDC-to-cash withdrawal via SEP-24. Opens an interactive URL for KYC.
When the anchor is ready, the CLI sends USDC from the bridge account to the
anchor.

```bash
deno task cli withdraw --amount 50
```

### status

Check the status of a SEP-24 transaction by ID.

```bash
deno task cli status --id <transaction-id>
```

### balance

Display balances for both the bridge account (on-chain) and the Crossmint smart
wallet.

```bash
deno task cli balance
```

## Environment Variables

| Variable              | Required | Description                                                                                        |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `CROSSMINT_API_KEY`   | Yes      | Crossmint staging API key                                                                          |
| `CROSSMINT_BASE_URL`  | Yes      | Crossmint API base URL (e.g., `https://staging.crossmint.com/api/2025-06-09`)                      |
| `BRIDGE_SEED`         | Yes      | Seed string for deterministic bridge keypair derivation                                            |
| `MONEYGRAM_DOMAIN`    | Yes      | MoneyGram anchor domain (e.g., `extstellar.moneygram.com`)                                         |
| `USDC_ISSUER`         | Yes      | USDC asset issuer on Stellar (testnet: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) |
| `CLIENT_DOMAIN`       | Yes      | Domain where your TOML server is deployed                                                          |
| `CLIENT_SIGNING_SEED` | No       | Seed string for client_domain signing keypair (public key must match TOML SIGNING_KEY)             |
| `STELLAR_NETWORK`     | No       | `testnet` (default) or `mainnet`                                                                   |

### TOML Server Variables

Set these on your Vercel deployment:

| Variable           | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `TOML_SIGNING_KEY` | The G... public key derived from `CLIENT_SIGNING_SEED`        |
| `TOML_ACCOUNTS`    | The bridge account G... public key (optional)                 |
| `PORT`             | Server port (default: `8000`, Vercel sets this automatically) |

## Deterministic Key Generation

This project uses deterministic keypair derivation instead of storing private
keys. Given a seed string, the process is:

1. The seed string is hashed with SHA-256 using the Web Crypto API
2. The 32-byte hash is used as a raw Ed25519 seed via
   `Keypair.fromRawEd25519Seed()`
3. The same seed always produces the same G.../S... keypair

This means you only need to store seed strings in your `.env` file. The keypairs
are derived at runtime. Use `deno task generate-keys --seed <seed>` to preview
the public key for any seed.

The implementation is in `src/keys.ts`.

## TOML Server

The TOML server is a Hono app deployed on Vercel that serves
`/.well-known/stellar.toml`. This is required for SEP-10 client_domain
verification.

### Local development

```bash
deno task toml-dev
curl http://localhost:8000/.well-known/stellar.toml
```

### Vercel deployment

The server is configured via `toml-server/vercel.json`. Deploy with the Vercel
CLI or connect the repository to Vercel.

## Deno Tasks

| Task                      | Description                                  |
| ------------------------- | -------------------------------------------- |
| `deno task cli`           | Run the main CLI                             |
| `deno task generate-keys` | Generate a deterministic keypair from a seed |
| `deno task check`         | Format check and type check all source files |
| `deno task lint`          | Run the Deno linter                          |
| `deno task test`          | Run tests                                    |
| `deno task toml-dev`      | Start the TOML server locally on port 8000   |

## Project Structure

```
crossmint-moneygram-ramp/
  src/
    cli.ts              CLI entry point with command dispatch
    config.ts           Environment loading and validation
    logger.ts           Timestamped logging
    http.ts             HTTP client with exponential backoff retry
    keys.ts             Deterministic keypair derivation (SHA-256 + Ed25519)
    stellar.ts          Stellar Horizon operations (trustlines, payments, balances)
    crossmint.ts        Crossmint wallet API (create, get, balances)
    sep10.ts            SEP-10 challenge-response authentication
    sep24.ts            SEP-24 interactive deposit/withdrawal flows
    sep45.ts            SEP-45 contract account authentication (C... addresses)
  scripts/
    generate-keys.ts    Keypair generation script
  toml-server/
    src/index.ts        Hono app serving stellar.toml
    vercel.json         Vercel deployment config
  deno.json             Deno config, tasks, and import map
  .env.example          Environment variable template
```

## Further Reading

- [Getting Started](docs/GETTING_STARTED.md) - Step-by-step setup guide
  (Crossmint, Vercel, MoneyGram onboarding)
- [Architecture Decision](docs/ARCHITECTURE_DECISION.md) - Why the bridge
  account pattern was chosen
- [Cross-Chain Expansion](docs/CROSS_CHAIN.md) - Extending the pattern to EVM
  and Solana
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and fixes

## Stellar Protocol References

- [SEP-1: stellar.toml](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md) -
  Service discovery
- [SEP-10: Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) -
  Challenge-response auth
- [SEP-24: Interactive Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md) -
  Anchor deposit/withdrawal
- [SEP-45: Contract Account Auth](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md) -
  Draft spec for Soroban wallets
- [MoneyGram Developer Docs](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps) -
  Integration guide
- [MoneyGram Cash-In Test Data](https://developer.moneygram.com/moneygram-developer/docs/on-ramp-cash-in-location-test-data) -
  Sandbox test locations
- [Crossmint API Docs](https://docs.crossmint.com/api-reference/wallets/create-wallet) -
  Wallet management API
