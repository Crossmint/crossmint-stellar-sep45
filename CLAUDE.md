# Crossmint Wallets MoneyGram Ramp

## Project Status

CLI proof-of-concept for on/off-ramp using **Crossmint Smart Wallets** on
Stellar. Uses SEP-45 (contract account auth) and SEP-24 (interactive
deposit/withdrawal). No bridge account or proxy address needed.

### What works

- SEP-45 auth with SDF test anchor (`testanchor.stellar.org`)
- SEP-24 deposit (cash to USDC) -- USDC goes directly to smart wallet
- SEP-24 withdrawal (USDC to cash) -- payment via Crossmint Transactions API
- Crossmint smart wallet creation (C... addresses, external-wallet signer)
- Crossmint Signatures API for SEP-45 auth entry signing
- Deterministic keypair generation from seed strings

## Architecture

```
User -> Anchor -> SEP-45 (Crossmint signs auth entry) -> SEP-24 -> USDC to/from C... wallet
```

The smart wallet (C... address) is both the authenticated identity (SEP-45) and
the USDC holder. Withdrawal payments use the Crossmint Transactions API to call
`transfer` on the USDC Soroban Asset Contract (SAC).

## Tech Stack

- Runtime: Deno 2.x
- HTTP framework: Hono (TOML server only)
- Stellar SDK: `@stellar/stellar-sdk@^13` (npm, via `nodeModulesDir: "auto"`)
- XDR parsing: `@stellar/js-xdr@^3` (for SEP-45 auth entry arrays)
- Crossmint API: `staging.crossmint.com/api/2025-06-09`

## Code Style

- Arrow functions for ALL function definitions
- `fetchWithRetry` with exponential backoff on ALL HTTP calls (except SEP-45
  POST which uses single-use nonces)
- Timestamped logging via `src/logger.ts`
- No emojis anywhere in code or output
- No em dashes in comments or strings
- TypeScript strict mode
- `@std/dotenv` for env, `@std/cli` for arg parsing

## Project Structure

```
src/
  cli.ts           Entry point. Commands: wallet, auth, deposit, withdraw, status, balance
  config.ts        Env loading. Config type with signerKeypair, usdcContractId
  logger.ts        Timestamped log/logError
  http.ts          fetchWithRetry with exponential backoff (3 retries, 1s base)
  keys.ts          Deterministic keypair: SHA-256(seed) -> Keypair.fromRawEd25519Seed()
  crossmint.ts     Wallet CRUD + Transactions API (create, get, balances, transactions)
  sep45.ts         SEP-45 contract auth. TOML discovery, XDR decode/encode, Crossmint signing
  sep24.ts         SEP-24 deposit/withdraw/poll. Uses Crossmint Transactions API for payments
scripts/
  generate-keys.ts Keypair generator
toml-server/
  src/index.ts     Hono app serving /.well-known/stellar.toml with CORS
  vercel.json      Vercel deployment config
docs/
  GETTING_STARTED.md    Step-by-step setup
  SEP45_POSTMAN_FLOWS.md  Postman testing for SEP-45 (external-wallet flow)
  TROUBLESHOOTING.md    Common issues and fixes
  images/               Screenshots
```

## Key Technical Details

### SEP-45 (src/sep45.ts)

Contract account auth for C... addresses. Uses `XdrReader`/`XdrWriter` from
`@stellar/js-xdr` for variable-length XDR arrays (the SDK's `fromXDR` enforces
EOF which fails on arrays). POST uses `application/x-www-form-urlencoded` (test
anchor doesn't parse JSON). No retry on POST (nonces are single-use).

Signing flow:
1. `POST /wallets/{addr}/signatures` with `type: "auth-entry"` -- creates request
2. Get pending approval message (preimage hash)
3. Ed25519-sign locally with signer keypair
4. `POST /wallets/{addr}/signatures/{id}/approvals` -- submit signature
5. Poll until `status: "success"` -- get `outputSignature`

### SEP-24 (src/sep24.ts)

Interactive deposit/withdrawal. Returns URL for KYC webview. Polls transaction
status. For withdrawals, sends USDC via Crossmint Transactions API (contract-call
on USDC SAC with `transfer` method).

### Crossmint Wallets (src/crossmint.ts)

- Create: `POST /wallets` with `chainType: "stellar"`, `type: "smart"`,
  `config.adminSigner: { type: "external-wallet", address: "G..." }`
- Wallet address is C... (Soroban contract)
- Idempotent creation via `x-idempotency-key` header
- Transactions: `POST /wallets/{addr}/transactions` with contract-call params

## SDF Test Anchor

- Domain: `testanchor.stellar.org`
- WEB_AUTH_FOR_CONTRACTS_ENDPOINT: `https://testanchor.stellar.org/sep45/auth`
- Simplified KYC form (any test data works)
- Supports SEP-45 contract account auth

## USDC Config (Testnet)

- USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- USDC SAC contract: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Decimals: 7 (amounts in stroops)
