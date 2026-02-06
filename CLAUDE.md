# MoneyGram x Crossmint Stellar Integration POC

## Project Overview

Headless CLI proof-of-concept that integrates MoneyGram's on-ramp/off-ramp (cash-to-USDC, USDC-to-cash) using Crossmint Smart Wallets on Stellar. Built with Deno, deployed TOML server on Vercel.

## Critical Investigation Questions

Before building, three questions MUST be answered by investigating the crossmint-main and crossmint-sdk repos:

1. **Does Crossmint expose the underlying signer's G... public key for Stellar smart wallets?** The wallet address is a C... Soroban contract, but SEP-10 requires a G... Ed25519 address. If Crossmint exposes the signer's G... key, we may not need a separate bridge account.
2. **Can Crossmint's signing API sign arbitrary Stellar transactions?** SEP-10 authentication requires signing a challenge transaction (not submitting it to the network). Does Crossmint have an endpoint that accepts arbitrary XDR and returns a signature?
3. **Can MoneyGram's anchor send USDC to a C... Soroban contract address?** On Stellar, SAC USDC and classic USDC are the same asset. But MoneyGram's anchor may only support classic payment operations to G... addresses.

If questions 1 and 2 are YES: eliminate the bridge account entirely. The Crossmint smart wallet handles everything.
If either is NO: use the bridge account pattern (G... classic account as intermediary).

## Architecture

Two possible architectures depending on investigation results:

### Option A: Direct (no bridge account)
CLI -> Crossmint API (get G... signer key) -> SEP-10 auth (Crossmint signs challenge) -> SEP-24 flow -> USDC lands in C... wallet

### Option B: Bridge account pattern
CLI -> Bridge Account (G...) -> SEP-10 auth (local keypair signs) -> SEP-24 flow -> USDC lands in G... bridge -> relay to C... wallet

## Tech Stack

- Runtime: Deno 2.x
- HTTP framework: Hono (for TOML server)
- Stellar SDK: @stellar/stellar-sdk (npm, via nodeModulesDir: "auto")
- Deployment: Vercel (TOML server)
- Crossmint API: staging.crossmint.com/api/2025-06-09

## Code Style

- Arrow functions for ALL function definitions
- fetchWithRetry with exponential backoff (3 retries, 1000ms base) on ALL HTTP calls
- Timestamped logging via src/logger.ts
- No emojis anywhere in code or output
- No em dashes in comments or strings
- TypeScript strict mode
- @std/dotenv for env, @std/cli for arg parsing

## Skills

This project uses two Deno skills:
- jcurbelo/skills/deno-scripting: Deno scripting patterns
- jcurbelo/skills/deno-api-hono: Hono API patterns for Deno

Install with: npx skills add jcurbelo/skills/deno-scripting && npx skills add jcurbelo/skills/deno-api-hono

## Project Structure

crossmint-moneygram-ramp/
.claude/agents/          # Subagent definitions
.skills/                 # Installed skills (auto-generated)
src/
cli.ts                 # Entry point with parseArgs
config.ts              # Env loading and validation
logger.ts              # Timestamped log/logError
http.ts                # fetchWithRetry with backoff
stellar.ts             # Horizon ops, trustlines, payments
crossmint.ts           # Wallet CRUD, transfers, signing
sep10.ts               # SEP-10 challenge-response auth
sep24.ts               # SEP-24 deposit/withdraw/poll
scripts/
generate-keys.ts       # Keypair generator
toml-server/
src/index.ts           # Hono app serving stellar.toml
package.json
vercel.json
deno.json
.env.example
.env
.gitignore

## MoneyGram Reference Data (Testnet)

- Anchor domain: extstellar.moneygram.com
- WEB_AUTH_ENDPOINT: https://extstellar.moneygram.com/stellaradapterservice/auth
- TRANSFER_SERVER_SEP0024: https://extstellar.moneygram.com/stellaradapterservice/sep24
- Anchor SIGNING_KEY: GCSESAP5ILVM6CWIEGK2SDOCQU7PHVFYYT7JNKRDAQNVQWKD5YEE5ZJ4
- USDC issuer (testnet): GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
- Network passphrase: Test SDF Network ; September 2015

## Parallel Task Strategy

When using agent teams, these tasks can run in parallel:
- PARALLEL: Repo investigation (questions 1-3) can run simultaneously
- PARALLEL: TOML server + CLI scaffolding can be built simultaneously
- SEQUENTIAL: SEP-10 implementation depends on investigation results
- SEQUENTIAL: SEP-24 depends on SEP-10
- PARALLEL: Testing + documentation can run simultaneously after implementation