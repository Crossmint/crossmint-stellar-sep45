# Getting Started

Step-by-step guide to set up the Crossmint Wallets MoneyGram Ramp.

## Prerequisites

- [Deno 2.x](https://deno.land/) installed
- A [Crossmint](https://www.crossmint.com/) staging API key

## Step 1: Create a Crossmint Project

1. Go to [Crossmint Staging Console](https://staging.crossmint.com/console)
2. Sign up or log in
3. Create a new project
4. Navigate to **API Keys** and create a **server-side** API key
5. Ensure the key has permissions for:
   - Wallets: Create, Read
   - Wallet Balances: Read
   - Wallet Signatures: Create, Read
   - Wallet Transactions: Create, Read
6. Copy the API key — this is your `CROSSMINT_API_KEY`

The base URL for staging is: `https://staging.crossmint.com/api/2025-06-09`

## Step 2: Clone and Install

```bash
git clone git@github.com:Crossmint/crossmint-moneygram-ramp.git
cd crossmint-moneygram-ramp
deno install
```

## Step 3: Generate a Signer Keypair

Generate a deterministic Ed25519 keypair that will be the external-wallet signer
for your Crossmint smart wallet.

```bash
deno task generate-keys --seed "my-signer-seed"
# Note the G... public key output
```

Choose a memorable, unique seed string. The same seed always produces the same
keypair. See [src/keys.ts](../src/keys.ts) for the derivation process (SHA-256 +
Ed25519).

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
# From Step 1
CROSSMINT_API_KEY="sk_staging_..."
CROSSMINT_BASE_URL="https://staging.crossmint.com/api/2025-06-09"

# From Step 3 (the seed string, NOT the key)
SIGNER_SEED="my-signer-seed"

# Anchor domain
ANCHOR_DOMAIN="testanchor.stellar.org"

# USDC config
USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC_CONTRACT_ID="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"

# Network
STELLAR_NETWORK="testnet"
```

## Step 5: Create a Crossmint Smart Wallet

```bash
# Create a new wallet (use --key for idempotent creation)
deno task cli wallet --key "my-user-wallet"

# Or retrieve an existing wallet
deno task cli wallet --locator "email:user@example.com"
```

The wallet is a Stellar smart wallet (C... contract address) with your signer
keypair as the external-wallet admin. The `--key` flag ensures idempotent
creation.

## Step 6: Authenticate with the Anchor

```bash
deno task cli auth
```

This performs SEP-45 authentication:

1. Fetches the anchor's `stellar.toml` to discover the SEP-45 endpoint
2. Requests a Soroban authorization challenge for the C... wallet address
3. Signs the challenge via the Crossmint Signatures API (external-wallet signer)
4. Submits the signed entries to receive a JWT

The JWT is saved to `.auth-token` for subsequent commands.

## Step 7: Deposit and Withdraw

### Deposit (Cash to USDC)

```bash
deno task cli deposit --amount 10
```

1. Initiates an interactive SEP-24 deposit
2. Prints a URL for KYC completion
3. After KYC + cash deposit, USDC is sent to the smart wallet
4. CLI polls for completion automatically

### Withdraw (USDC to Cash)

```bash
deno task cli withdraw --amount 10
```

1. Initiates an interactive SEP-24 withdrawal
2. Prints a URL for KYC completion
3. When the anchor is ready, the CLI sends USDC to the anchor via the Crossmint
   Transactions API
4. User receives a reference code to pick up cash

### Check Status

```bash
deno task cli status --id <transaction-id>
```

### Check Balances

```bash
deno task cli balance
```

## Troubleshooting

See [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and fixes.
