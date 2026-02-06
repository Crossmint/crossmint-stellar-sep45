# Troubleshooting

Common issues and their solutions when working with the MoneyGram x Crossmint Stellar integration.

For setup instructions, see [Getting Started](GETTING_STARTED.md). For architecture context, see [Architecture Decision](ARCHITECTURE_DECISION.md).

## Module Not Found Errors

**Symptom**: Deno reports `Module not found` or `Cannot resolve module` when running CLI commands.

**Cause**: Dependencies have not been installed, or the import map in `deno.json` is out of sync.

**Fix**:

1. Run `deno install` to fetch all dependencies.
2. Verify that `deno.json` includes the correct import entries (e.g., `@stellar/stellar-sdk`, `@std/dotenv`, `@std/cli`, `hono`).
3. Ensure `"nodeModulesDir": "auto"` is set in `deno.json`. The `@stellar/stellar-sdk` package has native Node.js dependencies that require a `node_modules` directory.
4. If errors persist, delete the `node_modules` folder and `deno.lock` file, then run `deno install` again.

```bash
rm -rf node_modules deno.lock
deno install
```

## Friendbot Rate Limiting

**Symptom**: The `setup` command fails with a 429 or 5xx error from Friendbot.

**Cause**: Stellar's Friendbot has rate limits. It may also return errors if the account has already been funded.

**Fix**:

1. Wait a few minutes and retry. The `fetchWithRetry` utility handles transient 5xx errors automatically with exponential backoff, but persistent rate limiting requires manual waiting.
2. If the account was already funded, the error is safe to ignore. Run `deno task cli balance` to confirm the bridge account has XLM.
3. Friendbot only works on testnet. On mainnet, you must fund the account through other means (exchange withdrawal, another funded account, etc.).

## SEP-10 Authentication Failures

**Symptom**: The `auth` command fails with an error from the anchor's WEB_AUTH_ENDPOINT.

**Possible causes and fixes**:

### Bridge account not funded
The anchor may reject the challenge if the account does not exist on the Stellar network. Run `deno task cli setup` first to fund the account and create the USDC trustline.

### USDC trustline missing
Some anchors verify that the account has a USDC trustline before issuing a JWT. Run `deno task cli setup` to ensure the trustline exists.

### client_domain TOML not accessible
If `CLIENT_DOMAIN` is set, the anchor fetches `https://<CLIENT_DOMAIN>/.well-known/stellar.toml` (per [SEP-1](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)) to verify the client_domain signing key. Ensure:
- The TOML server is deployed and accessible at the configured domain
- The `TOML_SIGNING_KEY` environment variable on the server matches the public key derived from `CLIENT_SIGNING_SEED`
- CORS headers are present (the Hono app includes `cors()` middleware)

Test TOML accessibility:
```bash
curl -v https://<your-domain>/.well-known/stellar.toml
```

### Signing key mismatch
The `SIGNING_KEY` in your TOML must match the public key derived from `CLIENT_SIGNING_SEED`. Generate and verify:
```bash
deno task generate-keys --seed "<your-client-signing-seed>"
```
The output `Public Key` must match the `SIGNING_KEY` in your deployed stellar.toml.

### Network passphrase mismatch
Ensure your `STELLAR_NETWORK` setting matches the anchor's network. MoneyGram's sandbox uses testnet (`Test SDF Network ; September 2015`).

## TOML Server Issues

**Symptom**: The TOML server returns errors, the anchor cannot fetch the TOML, or the TOML content is incorrect.

### CORS headers missing
The Stellar protocol requires CORS headers on TOML responses. The Hono app includes `cors()` middleware, but verify the headers are present:
```bash
curl -I https://<your-domain>/.well-known/stellar.toml
```
Look for `Access-Control-Allow-Origin: *` in the response headers.

### SIGNING_KEY does not match CLIENT_SIGNING_SEED
The `TOML_SIGNING_KEY` environment variable on the Vercel deployment must be set to the G... public key derived from the same seed as `CLIENT_SIGNING_SEED` in your `.env`. If these do not match, SEP-10 client_domain verification will fail.

### Vercel deployment not updated
After changing environment variables on Vercel, redeploy the TOML server for changes to take effect. Vercel environment variables are injected at build/deploy time.

### Local testing
To test the TOML server locally before deploying:
```bash
TOML_SIGNING_KEY="G..." deno task toml-dev
curl http://localhost:8000/.well-known/stellar.toml
curl http://localhost:8000/health
```

## MoneyGram Sandbox Access

**Symptom**: Requests to MoneyGram's anchor endpoints return 401, 403, or connection errors.

**Cause**: MoneyGram's Stellar sandbox requires onboarding and allowlisting.

**Fix**:

1. Go through MoneyGram's partner onboarding process to get sandbox credentials.
2. Ensure your bridge account's G... public key is allowlisted with MoneyGram.
3. Verify the anchor domain is correct: `extstellar.moneygram.com` for the sandbox.

### Using the SDF Test Anchor as a fallback
If MoneyGram sandbox access is not yet available, you can test the SEP-10/SEP-24 flow against the SDF reference anchor:

1. Set `MONEYGRAM_DOMAIN=testanchor.stellar.org` in your `.env`
2. The SDF test anchor supports full [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) and [SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md) flows on testnet
3. Its signing key is `GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR`
4. It uses the same testnet USDC issuer

Note: The SDF test anchor also supports [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md) (contract account auth), which MoneyGram does not yet support.

## Account Not Found

**Symptom**: Stellar operations fail with "Account not found" or a 404 from Horizon.

**Cause**: The bridge account has not been created on the Stellar network. An account must be funded with at least 1 XLM to exist.

**Fix**:

1. On testnet, run `deno task cli setup` to fund the account via Friendbot.
2. On mainnet, send at least 1 XLM to the bridge account's G... public key from another funded account.
3. Verify the account exists:
   ```bash
   deno task cli balance
   ```

If the balance command also fails with "Account not found", the account has not been funded yet.

## Transaction Polling Timeout

**Symptom**: The CLI reports "Polling timed out" during a deposit or withdrawal.

**Cause**: The default polling timeout is 5 minutes (300,000ms). Some transactions, especially those requiring KYC completion, may take longer.

**Fix**:

1. The transaction is not lost. Use the transaction ID to check its status manually:
   ```bash
   deno task cli status --id <transaction-id>
   ```
2. If the transaction is still in progress (status: `pending_user_transfer_start`, `pending_anchor`, etc.), it is still being processed. The KYC step in particular requires manual user action in the MoneyGram webview.
3. For deposits, the interactive URL printed when the deposit was initiated can be reopened to complete KYC.
4. Common SEP-24 transaction statuses:
   - `incomplete`: KYC not yet completed
   - `pending_user_transfer_start`: Anchor is waiting for the user to send funds
   - `pending_anchor`: Anchor is processing
   - `completed`: Transaction finished successfully
   - `error`: Transaction failed (check the `message` field)
   - `expired`: Transaction timed out on the anchor side

## Deterministic Key Issues

**Symptom**: The generated keypair does not match what is expected, or different environments produce different keys.

**Cause**: Deterministic key generation is sensitive to the exact seed string.

**Fix**:

1. The same seed string always produces the same keypair. Verify this:
   ```bash
   deno task generate-keys --seed "my-seed"
   # Run again:
   deno task generate-keys --seed "my-seed"
   # Both outputs must be identical
   ```

2. Seeds are case-sensitive and whitespace-sensitive. `"my-seed"` and `"My-Seed"` produce different keypairs. `"my-seed "` (trailing space) is also different.

3. The derivation process is: `SHA-256(seed) -> 32 bytes -> Keypair.fromRawEd25519Seed()`. This is deterministic across all platforms that implement SHA-256 and Ed25519 correctly.

4. If keys do not match between environments, check:
   - The `.env` file does not have extra whitespace around the seed value
   - The seed string is not being modified by shell escaping (avoid special characters, or quote them properly)
   - Both environments are using the same version of `@stellar/stellar-sdk`

## Crossmint API Errors

**Symptom**: Wallet creation or balance queries fail with 401, 403, or 500 errors.

### 401 Unauthorized
The `CROSSMINT_API_KEY` is invalid or expired. Verify it in the Crossmint dashboard. Ensure you are using a staging key if `CROSSMINT_BASE_URL` points to `staging.crossmint.com`.

### 403 Forbidden
Your API key may not have permissions for Stellar wallet operations. Check the key's scope in the Crossmint dashboard.

### 500 Internal Server Error
The `fetchWithRetry` utility automatically retries on 5xx errors with exponential backoff (3 retries, starting at 1 second). If all retries fail, the error is a persistent server-side issue. Wait and try again later.

### Wrong base URL
Ensure `CROSSMINT_BASE_URL` uses the correct API version. The current version is `https://staging.crossmint.com/api/2025-06-09`. Using an outdated version path will result in 404 errors. See [Crossmint API docs](https://docs.crossmint.com/api-reference/wallets/create-wallet) for the latest version.

## SAC Transfer to C... Addresses Not Implemented

**Symptom**: Attempting to relay USDC to a C... smart wallet address fails with "SAC transfer to C... contract addresses requires Soroban invocation."

**Cause**: Classic Stellar payment operations cannot target Soroban contract (C...) addresses. A Soroban Asset Contract (SAC) invocation is required, which is not yet implemented in this POC.

**Fix**: This is a known limitation. For the current POC:
1. Use the Crossmint transfer API to move USDC between wallets
2. The relay step from bridge to smart wallet will be fully implemented when SAC transfer support is added

## Environment File Not Loaded

**Symptom**: All commands fail with "Error: <VARIABLE> environment variable is required."

**Cause**: The `.env` file is missing or not in the working directory.

**Fix**:

1. Ensure `.env` exists in the project root (same directory as `deno.json`).
2. Copy from the template if needed: `cp .env.example .env`
3. Fill in all required values. See the README for the full variable reference.
4. Run commands from the project root directory so that `@std/dotenv/load` can find the `.env` file.
