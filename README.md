# Crossmint Stellar Ramp — SEP-45 + SEP-24

CLI proof-of-concept for on/off-ramp using Crossmint Smart Wallets on Stellar.
Authenticates directly with the C... contract address via **SEP-45** (no bridge
account needed for auth). Built with Deno 2.x.

## Architecture

```
                      SEP-45 Authentication
                      =====================

  Crossmint creates         Anchor sends Soroban         Crossmint signs
  smart wallet (C...)        auth challenge               via Signatures API
        |                          |                          |
        v                          v                          v
  +-----------------+        +-------------+           +-----------------+
  |    Crossmint    | -----> |   Anchor    | --------> |    Crossmint    |
  |  Smart Wallet   |  GET   | (SEP-45)    |  POST     |  Signatures API |
  |  (C... address) |        +-------------+   sign    +-----------------+
  +-----------------+              |
                                   v
                              JWT token
                              (for SEP-24)
```

**No bridge account needed for authentication.** SEP-45 authenticates the C...
contract address directly using Soroban authorization entries.

## Prerequisites

- [Deno 2.x](https://deno.land/)
- A [Crossmint](https://www.crossmint.com/) staging API key with
  `allowFireblocks` addon enabled

## Quick Start

### 1. Install dependencies

```bash
deno install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Crossmint API key
```

### 3. Create a wallet and authenticate

```bash
# Create a Crossmint smart wallet
deno task cli wallet

# Authenticate with testanchor via SEP-45
deno task cli auth

# Check balances
deno task cli balance
```

## CLI Commands

All commands: `deno task cli <command> [options]`

| Command    | Description                               |
| ---------- | ----------------------------------------- |
| `wallet`   | Create or retrieve Crossmint smart wallet |
| `auth`     | Authenticate with anchor using SEP-45     |
| `deposit`  | Initiate cash-to-USDC deposit (SEP-24)    |
| `withdraw` | Initiate USDC-to-cash withdrawal (SEP-24) |
| `status`   | Check transaction status                  |
| `balance`  | Check wallet balances                     |

### Options

- `--key` — Idempotency key for wallet creation
- `--locator` — Wallet locator for retrieval
- `--amount` — Amount for deposit/withdraw
- `--id` — Transaction ID for status check

## Environment Variables

| Variable             | Required | Description                                                         |
| -------------------- | -------- | ------------------------------------------------------------------- |
| `CROSSMINT_API_KEY`  | Yes      | Crossmint staging API key                                           |
| `CROSSMINT_BASE_URL` | Yes      | API base URL (e.g., `https://staging.crossmint.com/api/2025-06-09`) |
| `USDC_ISSUER`        | Yes      | USDC asset issuer on Stellar                                        |
| `ANCHOR_DOMAIN`      | No       | Anchor domain (default: `testanchor.stellar.org`)                   |
| `STELLAR_NETWORK`    | No       | `testnet` (default) or `mainnet`                                    |
| `BRIDGE_SEED`        | No       | Bridge keypair seed (only for SEP-24 withdrawal payments)           |

## How SEP-45 Works

1. **TOML discovery** — Fetch `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` from anchor's
   stellar.toml
2. **Challenge** — `GET /sep45/auth?account={C_ADDRESS}&home_domain={DOMAIN}`
3. **Decode** — Response contains `authorizationEntries` as XDR array (4-byte
   count prefix + N entries)
4. **Sign** — Extract unsigned entry, send to Crossmint Signatures API
   (`POST /wallets/{addr}/signatures`)
5. **Poll** — Wait for `status: "success"` with `outputSignature`
6. **Submit** — Re-encode signed entries, POST back to anchor → receive JWT

## Project Structure

```
src/
  cli.ts              CLI entry point
  config.ts           Environment loading
  logger.ts           Timestamped logging
  http.ts             HTTP client with retry
  keys.ts             Deterministic keypair derivation
  toml.ts             Stellar TOML discovery
  crossmint.ts        Crossmint wallet API
  sep45.ts            SEP-45 authentication (C... addresses)
  sep24.ts            SEP-24 deposit/withdrawal
  stellar.ts          Stellar Horizon operations (optional, for bridge payments)
```

## Stellar Protocol References

- [SEP-45: Contract Account Auth](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
- [SEP-24: Interactive Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
- [SEP-1: stellar.toml](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
