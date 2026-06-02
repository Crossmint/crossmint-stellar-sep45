# Troubleshooting

Common issues and their solutions when working with Crossmint Stellar SEP-45.

## Module Not Found Errors

**Symptom**: Deno reports `Module not found` or `Cannot resolve module` when
running CLI commands.

**Fix**:

1. Run `deno install` to fetch all dependencies.
2. Ensure `"nodeModulesDir": "auto"` is set in `deno.json`. The
   `@stellar/stellar-sdk` package has native Node.js dependencies that require a
   `node_modules` directory.
3. If errors persist, delete `node_modules` and `deno.lock`, then `deno install`
   again.

## SEP-45 Authentication Failures

**Symptom**: The `auth` command fails with an error from the anchor's SEP-45
endpoint.

### Wallet not created

Run `deno task cli wallet` first to create a smart wallet. The C... address is
required for SEP-45 authentication.

### Network passphrase mismatch

Ensure your `STELLAR_NETWORK` setting matches the anchor's network. The SDF test
anchor uses testnet (`Test SDF Network ; September 2015`).

### Anchor does not support SEP-45

Not all anchors support SEP-45 (contract account auth). Check the anchor's
`stellar.toml` for `WEB_AUTH_FOR_CONTRACTS_ENDPOINT`. If it's missing, the
anchor only supports traditional G... account authentication.

### Anchor returns "Failed to simulate transaction" (500)

The SEP-45 challenge contains one authorization entry per signer. There are
always two: one for your contract account (`C...`) and one for the anchor's
`web_auth_domain_account` (the `SIGNING_KEY` in its `stellar.toml`). When you
use `client_domain` attribution there is a third, for the `SIGNING_KEY` in
_your_ `stellar.toml`.

When the anchor verifies your submission it simulates the `web_auth_verify` call
against Soroban, which checks the authorization of every entry. The two
`SIGNING_KEY` entries are classic `G...` accounts, so Soroban must load each one
from the ledger to verify its signature. If any of those `SIGNING_KEY` accounts
does not exist on the target network, the simulation fails and the anchor
returns:

```json
{ "error": "Failed to simulate transaction" }
```

This happens even when your challenge, your signatures, and your wallet contract
are all valid -- the classic accounts simply have to exist on-chain.

Check each `SIGNING_KEY` account (the anchor's, and your `client_domain` one if
used) on Horizon:

```bash
curl https://horizon-testnet.stellar.org/accounts/<SIGNING_KEY>
```

A 404 means it is not funded. On testnet, fund it with Friendbot:

```bash
curl "https://friendbot.stellar.org/?addr=<SIGNING_KEY>"
```

On mainnet there is no Friendbot, so the account must be created/funded
manually. To inspect exactly what a challenge contains (entries, signatures, the
invoked function and its arguments), decode it:

```bash
deno run --allow-net scripts/decode-challenge.ts <anchor-domain> <C-account>
```

## Signature Request Failures

**Symptom**: The Crossmint Signatures API returns errors during SEP-45 auth.

### Signer mismatch

The signer keypair (derived from `SIGNER_SEED`) must match the external-wallet
admin signer on the wallet. If you created a wallet with a different seed,
either use that seed or create a new wallet.

### First signature triggers deployment

The first signature request on a new wallet triggers on-chain contract
deployment. This adds latency (10-30 seconds). Subsequent requests are faster.

## Transaction Failures

**Symptom**: Withdrawal payment via Crossmint Transactions API fails.

### Insufficient USDC balance

The smart wallet must have enough USDC to cover the withdrawal amount. Check
balances with `deno task cli balance`.

### Invalid USDC contract ID

Ensure `USDC_CONTRACT_ID` in your `.env` matches the correct SAC contract for
your network:

- Testnet: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Mainnet: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`

## Transaction Polling Timeout

**Symptom**: The CLI reports "Polling timed out" during a deposit or withdrawal.

**Fix**:

1. The transaction is not lost. Check status manually:
   ```bash
   deno task cli status --id <transaction-id>
   ```
2. The KYC step requires manual user action in the anchor webview. Open the
   interactive URL to complete it.
3. Common SEP-24 transaction statuses:
   - `incomplete`: KYC not yet completed
   - `pending_user_transfer_start`: Anchor is waiting for USDC payment
   - `pending_anchor`: Anchor is processing
   - `completed`: Transaction finished successfully
   - `error`: Transaction failed (check the `message` field)

## SEP-24 Amount Limits

**Symptom**: A deposit or withdrawal is rejected with an error like
`amount is less than asset's minimum limit`.

Each anchor sets its own per-asset minimum and maximum. Query the anchor's
SEP-24 `/info` endpoint to see the current limits:

```bash
curl <TRANSFER_SERVER_SEP0024>/info
```

Pass an `--amount` within the asset's `min_amount`/`max_amount` range.

## SEP-24 Quote / "Server error" in the Interactive Flow

**Symptom**: The interactive deposit/withdraw webview shows
`API Error: Server
error`, and the quote request (e.g.
`POST /transactions/quote` or `/rampsservice/v3/transactions/quote`) returns
`500`.

This is usually an anchor-side test-data limitation, not a client problem. On
the MoneyGram sandbox, only specific agent locations have working test data;
picking an arbitrary location makes the quote endpoint fail. Use a known-good
sandbox location -- for MoneyGram deposits,
`2600 Rice Creek Rd, New Brighton, MN` ("CUB FOODS NEW BRIGHTON") works. If the
quote still 500s, share the request payload and response with the anchor team.

## SEP-24 Withdraw: "account does not exist" for Contract Accounts

**Symptom**: SEP-45 auth and SEP-24 deposit work for your `C...` contract
account, but the withdraw fails server-side with:

```
org.stellar.anchor.exception.SepValidationException: account <C-address> does not exist
```

This is an upstream Anchor Platform limitation, not a client issue. The withdraw
path validates the account with a classic (`G...`) account-existence check,
which a Soroban contract (`C...`) address can never satisfy -- even though the
same account just received a deposit. The deposit path is contract-aware; the
withdraw path (as of this writing) is not.

There is no client-side workaround. The fix is in the anchor / Anchor Platform:
make the withdraw account-existence check skip or adapt for `C...` addresses
(for example, verify the contract via Soroban RPC instead of a Horizon account
lookup). Track it with the anchor and the Anchor Platform repo
(`stellar/java-stellar-anchor-sdk`).

## Crossmint API Errors

### 401 Unauthorized

The `CROSSMINT_API_KEY` is invalid or expired. Verify it in the Crossmint
console. Ensure you are using a staging key if `CROSSMINT_BASE_URL` points to
`staging.crossmint.com`.

### 403 Forbidden

Your API key may not have the required permissions. Check the key's scope in the
Crossmint console — it needs Wallets, Signatures, and Transactions permissions.

### Wrong base URL

Ensure `CROSSMINT_BASE_URL` uses the correct API version:
`https://staging.crossmint.com/api/2025-06-09`

### Balances return "tokens is required"

The Crossmint balances endpoint requires a `tokens` query parameter (for example
`?tokens=usdc,xlm`). The CLI sends this automatically; if you call the API
directly, include it.

## Environment File Not Loaded

**Symptom**: All commands fail with "Error: <VARIABLE> environment variable is
required."

**Fix**:

1. Ensure `.env` exists in the project root (same directory as `deno.json`).
2. Copy from the template: `cp .env.example .env`
3. Fill in all required values.
4. Run commands from the project root directory.

## Deterministic Key Issues

**Symptom**: The generated keypair does not match expectations.

**Fix**:

1. The same seed always produces the same keypair:
   ```bash
   deno task generate-keys --seed "my-seed"
   ```
2. Seeds are case-sensitive and whitespace-sensitive.
3. Derivation: `SHA-256(seed) → 32 bytes → Keypair.fromRawEd25519Seed()`
