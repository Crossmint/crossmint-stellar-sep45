# MoneyGram x Crossmint Stellar Integration POC

## Project Status: Working E2E

This POC is **fully functional** on MoneyGram's Stellar sandbox. SEP-10 auth,
SEP-24 deposit, and SEP-24 withdrawal all work end-to-end. SEP-45 contract
account auth is implemented and tested against the SDF reference anchor.

### What works today

- SEP-10 auth with MoneyGram (`extstellar.moneygram.com`) and SDF test anchor
- SEP-24 deposit (cash to USDC) with MoneyGram
- SEP-24 withdrawal (USDC to cash) with MoneyGram
- Crossmint smart wallet creation (`C...` addresses)
- Bridge account setup, funding, USDC trustline
- TOML server deployed on Vercel (`crossmint-moneygram-ramp.vercel.app`)
- Deterministic keypair generation from seed strings
- SEP-45 challenge flow against `testanchor.stellar.org`

### Next steps

- **SEP-45 signing**: Crossmint to add Stellar support to their Signatures API.
  `signEntryWithCrossmint` in `src/sep45.ts` is stubbed and documents the
  expected API calls. Once available, the bridge account is no longer needed.
- **USDC relay to C... addresses**: Sending USDC from bridge to smart wallet
  requires Soroban Asset Contract (SAC) invocation, not yet implemented.

## Architecture

**Current: Bridge Account Pattern (Option B)**

```
User -> MoneyGram -> SEP-10 (bridge G... key signs) -> SEP-24 -> USDC to bridge -> relay to C... wallet
```

**Future: Direct SEP-45 (no bridge)**

```
User -> Anchor -> SEP-45 (Crossmint signs auth entry) -> SEP-24 -> USDC to C... wallet directly
```

The bridge exists because:

1. SEP-10 requires G... addresses; Crossmint wallets are C... contracts
2. Crossmint's Signatures API does not yet support Stellar wallets
3. MoneyGram sends USDC via classic payments (G... only)

SEP-45 solves #1 and #3 (uses Soroban auth entries for C... addresses). Once
Crossmint adds Stellar signing (#2), the bridge can be removed entirely.

## Tech Stack

- Runtime: Deno 2.x
- HTTP framework: Hono (TOML server only)
- Stellar SDK: `@stellar/stellar-sdk@^13` (npm, via `nodeModulesDir: "auto"`)
- XDR parsing: `@stellar/js-xdr@^3` (for SEP-45 auth entry arrays)
- Deployment: Vercel (TOML server)
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
  cli.ts           Entry point. Commands: wallet, setup, auth, sep45-auth, deposit, withdraw, status, balance
  config.ts        Env loading, Config type with bridgeKeypair, clientSigningKeypair, etc.
  logger.ts        Timestamped log/logError
  http.ts          fetchWithRetry with exponential backoff (3 retries, 1s base)
  keys.ts          Deterministic keypair: SHA-256(seed) -> Keypair.fromRawEd25519Seed()
  stellar.ts       Horizon: trustlines, payments, balances, friendbot funding
  crossmint.ts     Wallet CRUD (create, get, balances). Wallet type: stellar-smart-wallet
  sep10.ts         SEP-10 challenge-response auth (bridge keypair + client_domain signing)
  sep24.ts         SEP-24 deposit/withdraw/poll. Handles interactive URLs and payment submission
  sep45.ts         SEP-45 contract auth. TOML discovery, XDR decode/encode, Crossmint signing stub
scripts/
  generate-keys.ts Keypair generator
toml-server/
  src/index.ts     Hono app serving /.well-known/stellar.toml with CORS
  vercel.json      Vercel deployment config
docs/
  GETTING_STARTED.md    Step-by-step setup (Crossmint, Vercel, MoneyGram onboarding)
  ARCHITECTURE_DECISION.md  Why bridge account, investigation results
  CROSS_CHAIN.md        Extending to EVM/Solana
  TROUBLESHOOTING.md    Common issues and fixes
  images/               Screenshots (deposit flow, MoneyGram onboarding)
```

## Key Technical Details

### SEP-10 (src/sep10.ts)

Challenge-response auth with MoneyGram. Signs with bridge keypair +
client_domain keypair. Validates challenge: sequence=0, timebounds,
source=SIGNING_KEY. Saves JWT to `.auth-token`.

### SEP-24 (src/sep24.ts)

Interactive deposit/withdrawal. Returns URL for KYC webview. Polls transaction
status. For withdrawals, sends USDC with memo from anchor's response.

### SEP-45 (src/sep45.ts)

Contract account auth for C... addresses. Uses `XdrReader`/`XdrWriter` from
`@stellar/js-xdr` for variable-length XDR arrays (the SDK's `fromXDR` enforces
EOF which fails on arrays). POST uses `application/x-www-form-urlencoded` (test
anchor doesn't parse JSON). No retry on POST (nonces are single-use).

The `signEntryWithCrossmint` stub documents the exact API calls needed:

- `POST /wallets/{id}/signatures` (create signature)
- `POST /wallets/{id}/signatures/{id}/approvals` (approve)
- Docs: https://docs.crossmint.com/api-reference/wallets/create-signature

### Crossmint Wallets (src/crossmint.ts)

- Create: `POST /wallets` with `chainType: "stellar"`, `type: "smart"`,
  `config.adminSigner.type: "api-key"`
- Response includes `config.adminSigner.address` (G... public key)
- Wallet address is C... (Soroban contract)
- Idempotent creation via `x-idempotency-key` header

## MoneyGram Reference Data (Testnet)

- Anchor domain: `extstellar.moneygram.com`
- WEB_AUTH_ENDPOINT:
  `https://extstellar.moneygram.com/stellaradapterservice/auth`
- TRANSFER_SERVER_SEP0024:
  `https://extstellar.moneygram.com/stellaradapterservice/sep24`
- Anchor SIGNING_KEY: `GCSESAP5ILVM6CWIEGK2SDOCQU7PHVFYYT7JNKRDAQNVQWKD5YEE5ZJ4`
- USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- Network passphrase: `Test SDF Network ; September 2015`

## SDF Test Anchor (SEP-45)

- Domain: `testanchor.stellar.org`
- WEB_AUTH_FOR_CONTRACTS_ENDPOINT: `https://testanchor.stellar.org/sep45/auth`
- WEB_AUTH_CONTRACT_ID:
  `CD3LA6RKF5D2FN2R2L57MWXLBRSEWWENE74YBEFZSSGNJRJGICFGQXMX`
- Supports both SEP-10 and SEP-45
- Simplified KYC form (any test data works)

## TOML Server

- Deployed at: `crossmint-moneygram-ramp.vercel.app`
- Env vars on Vercel: `TOML_SIGNING_KEY` (G... from CLIENT_SIGNING_SEED),
  `TOML_ACCOUNTS` (bridge G... key, optional)
- MoneyGram has allowlisted this domain for sandbox access
