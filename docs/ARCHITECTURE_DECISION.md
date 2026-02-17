# Architecture Decision: Option B (Bridge Account Pattern)

**Date**: 2026-02-06 **Status**: Accepted **Decision**: Use a local Ed25519
bridge account as intermediary between MoneyGram and Crossmint smart wallets.

## References

- [SEP-10: Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) -
  Challenge-response auth for Stellar anchors
- [SEP-24: Interactive Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md) -
  Anchor deposit/withdrawal protocol
- [SEP-45: Contract Account Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md) -
  Draft spec for Soroban contract auth (not yet supported by MoneyGram)
- [SEP-1: stellar.toml](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md) -
  Service discovery via TOML files
- [Crossmint Wallets API](https://docs.crossmint.com/api-reference/wallets/create-wallet) -
  Smart wallet creation and management
- [MoneyGram Access Ramps Integration Guide](https://developer.moneygram.com/moneygram-developer/docs/integrate-moneygram-ramps) -
  MoneyGram on/off-ramp integration
- [MoneyGram Stellar Developer Guide](https://developer.moneygram.com/moneygram-developer/docs/stellar-developers-guide) -
  Stellar-specific integration details

## Investigation Summary

Three critical questions were investigated across the crossmint-main and
crossmint-sdk repositories, the SEP-10/SEP-24 specifications, and MoneyGram's
anchor configuration.

## Question 1: Does Crossmint expose the signer's G... public key?

**Answer: YES**

The admin signer's G... (Ed25519) address is stored and exposed in the wallet
API response.

- **Wallet response path**: `config.adminSigner.address` contains the G...
  public key
- **API call**: `GET /2025-06-09/wallets/{walletLocator}` returns:
  ```json
  {
    "address": "C...contractAddress",
    "config": {
      "adminSigner": {
        "type": "api-key",
        "address": "G...ed25519PublicKey"
      }
    }
  }
  ```
- **Evidence**:
  `crossbit-main/libraries/products/wallets/v2/src/dto-v2025/stellar-wallets.dto.ts`
  (lines 80-97)

However, knowing the G... key is not sufficient alone -- we also need the
ability to sign with it (see Q2).

## Question 2: Can Crossmint sign arbitrary Stellar transactions (XDR)?

**Answer: NO**

Crossmint's API cannot sign raw XDR without submitting to the network.

- **signMessage**: Explicitly not implemented for Stellar
  (`"signMessage method not implemented for stellar signer"`)
  - Source:
    `crossmint-sdk/packages/wallets/src/signers/non-custodial/ncs-stellar-signer.ts`
    (line 9-11)
- **Signatures endpoint**: Only supports EVM types (`message` and `typed-data`
  with EIP-191/EIP-712)
  - Source:
    `crossbit-main/libraries/products/wallets/v2/src/dto-v2025/signatures.dto.ts`
- **Transaction endpoint**: Always submits to the network -- no "sign and
  return" mode exists
- **Internal capability**: Ed25519 signing exists in Fireblocks/TEE
  infrastructure but is not exposed as a standalone API

This means we cannot use Crossmint to sign SEP-10 challenge transactions.

## Question 3: Can MoneyGram send USDC to C... contract addresses?

**Answer: Likely NO (classic payments) / Spec allows it (SEP-24)**

Two separate findings:

1. **SEP-10 authentication**: Does NOT accept C... addresses at all. Only G...
   and M... addresses are supported per the
   [SEP-10 spec](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md).
   [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
   (contract account auth) is in DRAFT status and MoneyGram does not implement
   it.
   - MoneyGram's TOML has no `WEB_AUTH_FOR_CONTRACTS_ENDPOINT`

2. **SEP-24 deposits**: The
   [SEP-24 spec](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
   explicitly accepts C... addresses in the `account` field. However,
   MoneyGram's actual deposit implementation likely uses classic `payment`
   operations which can only target G... addresses. Classic payment operations
   cannot target Soroban contract (C...) addresses.

3. **Crossmint's detection**: Monitors incoming transfers via Goldsky webhooks
   for SAC contract events, not classic payments. No proxy/relay mechanism
   exists between G... and C... addresses.

## Decision

**Option B: Bridge Account Pattern** is required because:

1. SEP-10 requires G... address -- C... addresses are not accepted
2. Crossmint cannot sign SEP-10 challenge transactions (no arbitrary XDR
   signing)
3. MoneyGram likely sends USDC via classic payments to G... addresses only

## Architecture Flow

```
[User CLI]
    |
    v
[Bridge Account (G... Ed25519 keypair)]
    |-- SEP-10: Sign challenge with local bridge keypair
    |-- SEP-24 Deposit: MoneyGram sends USDC to bridge G... address
    |-- Relay: Bridge sends USDC to C... smart wallet via SAC transfer
    |
    v
[Crossmint Smart Wallet (C... Soroban contract)]
    |-- Holds USDC
    |-- SEP-24 Withdraw: Bridge sends USDC from smart wallet to anchor
```

### Deposit Flow (Cash to USDC)

1. CLI creates Crossmint smart wallet (C... address)
2. CLI uses bridge account (G...) for SEP-10 auth with MoneyGram
3. CLI initiates SEP-24 deposit, specifying bridge G... as destination
4. User completes KYC in MoneyGram webview, deposits cash at store
5. MoneyGram sends USDC to bridge G... account
6. CLI relays USDC from bridge to C... smart wallet

### Withdrawal Flow (USDC to Cash)

1. CLI authenticates with MoneyGram via SEP-10 (bridge keypair)
2. CLI initiates SEP-24 withdrawal
3. Anchor provides its G... account + memo for USDC payment
4. CLI sends USDC from bridge account to anchor (with memo)
5. User picks up cash at MoneyGram location

### Client Domain Verification

- TOML server deployed at CLIENT_DOMAIN serves `SIGNING_KEY`
- SEP-10 challenge includes ManageData op for client_domain
- CLIENT_SIGNING_KEY signs the challenge alongside bridge keypair
- This proves the wallet belongs to our application

## Keypairs Required

Keypairs are derived deterministically from seed strings using SHA-256 hashing +
`Keypair.fromRawEd25519Seed()`. No private keys need to be stored. The same seed
always produces the same keypair.

Use `deno task generate-keys --seed <seed>` to preview the G... public key for
any seed.

| Seed                | Derived Keypair Purpose                                       | Storage                          |
| ------------------- | ------------------------------------------------------------- | -------------------------------- |
| BRIDGE_SEED         | Bridge keypair (G.../S...) for SEP-10 auth, receive/send USDC | .env                             |
| CLIENT_SIGNING_SEED | Client domain keypair (G.../S...) for client_domain in SEP-10 | .env + public key in TOML server |
| CROSSMINT_API_KEY   | Crossmint wallet management (not a seed, just an API key)     | .env                             |

## Crossmint Endpoints Used

| Endpoint                          | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `POST /wallets`                   | Create Stellar smart wallet                         |
| `GET /wallets/{locator}`          | Retrieve wallet details (C... address, G... signer) |
| `GET /wallets/{locator}/balances` | Check USDC balance on smart wallet                  |

## MoneyGram Endpoints Used

| Endpoint                                        | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `GET /.well-known/stellar.toml`                 | Discover anchor endpoints and signing key |
| `GET /auth`                                     | Get SEP-10 challenge transaction          |
| `POST /auth`                                    | Submit signed challenge, receive JWT      |
| `POST /sep24/transactions/deposit/interactive`  | Initiate deposit                          |
| `POST /sep24/transactions/withdraw/interactive` | Initiate withdrawal                       |
| `GET /sep24/transaction`                        | Poll transaction status                   |

## Fallback: SDF Test Anchor

If MoneyGram sandbox is not accessible, use `testanchor.stellar.org`:

- Supports full SEP-10 + SEP-24
- Also supports SEP-45 for future C... address testing
- SIGNING_KEY: `GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR`
- Same testnet USDC issuer

## Future: Eliminating the Bridge Account

The bridge account can be eliminated when:

1. Crossmint adds a "sign raw XDR" or "sign arbitrary bytes" API for Stellar
   ([Crossmint docs](https://docs.crossmint.com/api-reference/wallets/create-wallet)),
   AND
2. MoneyGram implements
   [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
   (contract account authentication), AND
3. MoneyGram's deposit system supports SAC transfers to C... addresses

At that point, the architecture shifts to Option A where the Crossmint smart
wallet handles everything directly.
