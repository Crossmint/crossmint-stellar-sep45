# Crossmint Wallets — MoneyGram Ramp (SEP-45 + SEP-24)

CLI proof-of-concept for on/off-ramp using **Crossmint Smart Wallets** on Stellar.
Authenticates the smart wallet's C... contract address directly via **SEP-45**.
Deposit and withdrawal payments flow through the **Crossmint Transactions API** — no
bridge account or proxy address needed.

Built with Deno 2.x.

## How It Works

```
  1. Create Wallet           2. SEP-45 Auth              3. SEP-24 Deposit/Withdraw
  ==================         ==============              ==========================

  Crossmint API              Anchor sends Soroban        Deposit: anchor sends USDC
  creates smart wallet       auth challenge              directly to C... wallet
  (C... address) with        → sign via Crossmint        Withdraw: Crossmint Transactions
  external-wallet signer     Signatures API              API sends USDC to anchor
                             → get JWT for SEP-24
```

**No bridge account needed.** The smart wallet (C... address) is both the
authenticated identity (SEP-45) and the USDC holder. Withdrawal payments are
sent via the Crossmint Transactions API using a `transfer` call on the USDC
Soroban Asset Contract (SAC).

## Prerequisites

- [Deno 2.x](https://deno.land/)
- A [Crossmint](https://www.crossmint.com/) API key (staging or production)

## Quick Start

### 1. Install dependencies

```bash
deno install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Crossmint API key and signer seed
```

### 3. Create a wallet and authenticate

```bash
# Create a Crossmint smart wallet
deno task cli wallet

# Authenticate with anchor via SEP-45
deno task cli auth

# Check balances
deno task cli balance
```

### 4. Deposit or withdraw

```bash
# Deposit cash → USDC (MoneyGram sends USDC to your wallet)
deno task cli deposit --amount 10

# Withdraw USDC → cash (wallet sends USDC to anchor via Crossmint API)
deno task cli withdraw --amount 10
```

## CLI Commands

All commands: `deno task cli <command> [options]`

| Command    | Description                                        |
| ---------- | -------------------------------------------------- |
| `wallet`   | Create or retrieve Crossmint smart wallet          |
| `auth`     | Authenticate with anchor using SEP-45              |
| `deposit`  | Initiate cash-to-USDC deposit (SEP-24)             |
| `withdraw` | Initiate USDC-to-cash withdrawal (SEP-24)          |
| `status`   | Check transaction status                           |
| `balance`  | Check wallet balances                              |

### Options

- `--key` — Idempotency key for wallet creation
- `--locator` — Wallet locator for retrieval
- `--amount` — Amount for deposit/withdraw
- `--id` — Transaction ID for status check

## Environment Variables

| Variable           | Required | Description                                                         |
| ------------------ | -------- | ------------------------------------------------------------------- |
| `CROSSMINT_API_KEY`  | Yes      | Crossmint API key                                                 |
| `CROSSMINT_BASE_URL` | Yes      | API base URL (e.g., `https://staging.crossmint.com/api/2025-06-09`) |
| `SIGNER_SEED`        | Yes      | Seed for deterministic Ed25519 keypair (external-wallet signer)   |
| `USDC_ISSUER`        | Yes      | USDC asset issuer on Stellar                                      |
| `USDC_CONTRACT_ID`   | Yes      | USDC SAC (Soroban Asset Contract) address                         |
| `ANCHOR_DOMAIN`      | No       | Anchor domain (default: `testanchor.stellar.org`)                 |
| `STELLAR_NETWORK`    | No       | `testnet` (default) or `mainnet`                                  |

## How SEP-45 Works

1. **TOML discovery** — Fetch `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` from anchor's stellar.toml
2. **Challenge** — `GET /sep45/auth?account={C_ADDRESS}&home_domain={DOMAIN}`
3. **Decode** — Response contains `authorizationEntries` as XDR array
4. **Sign** — Send unsigned entry to Crossmint Signatures API (`POST /wallets/{addr}/signatures`), sign the preimage hash locally with Ed25519 keypair, submit approval
5. **Poll** — Wait for `status: "success"` with `outputSignature`
6. **Submit** — Re-encode signed entries, POST back to anchor → receive JWT

## How Withdrawals Work

1. **Initiate** — `POST` to anchor's SEP-24 withdrawal endpoint with the C... wallet address
2. **KYC** — User completes KYC via anchor's interactive URL
3. **Poll** — Wait for anchor status `pending_user_transfer_start`
4. **Send USDC** — Call Crossmint Transactions API: `POST /wallets/{C_addr}/transactions` with a `transfer` contract-call on the USDC SAC contract
5. **Complete** — Anchor detects payment, completes withdrawal, user picks up cash at MoneyGram

## Project Structure

```
src/
  cli.ts              CLI entry point
  config.ts           Environment loading
  logger.ts           Timestamped logging
  http.ts             HTTP client with retry
  keys.ts             Deterministic keypair derivation
  toml.ts             Stellar TOML discovery
  crossmint.ts        Crossmint Wallet + Transactions API
  sep45.ts            SEP-45 authentication (C... addresses)
  sep24.ts            SEP-24 deposit/withdrawal
```

## Stellar Protocol References

- [SEP-45: Contract Account Auth](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
- [SEP-24: Interactive Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
- [SEP-1: stellar.toml](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
