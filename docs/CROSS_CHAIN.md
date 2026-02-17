# Cross-Chain Expansion

This document describes how to extend the MoneyGram bridge account pattern to
other blockchain networks using Crossmint's chain-agnostic wallet API.

## Overview

The current POC operates exclusively on Stellar, using a bridge account (G...
Ed25519 keypair) to interface with MoneyGram's
[SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)/[SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
anchor protocol. While the anchor protocol is Stellar-specific, the wallet
management layer provided by
[Crossmint](https://docs.crossmint.com/api-reference/wallets/create-wallet) is
chain-agnostic. This creates a natural separation point for multi-chain
expansion.

**Stellar-specific components** (cannot be reused across chains):

- SEP-10 challenge-response authentication
- SEP-24 interactive deposit/withdrawal flows
- Stellar trustlines and classic payment operations
- Bridge account keypair (Ed25519)

**Chain-agnostic components** (reusable via Crossmint API):

- Wallet creation (`POST /wallets`)
- Wallet retrieval (`GET /wallets/{locator}`)
- Balance queries (`GET /wallets/{locator}/balances`)
- Cross-wallet transfers

## Crossmint's Multi-Chain Wallet API

Crossmint supports creating wallets on multiple chains from a single API. The
wallet type parameter determines the target chain:

| Chain          | `chainType` | `type`  | Address Format          |
| -------------- | ----------- | ------- | ----------------------- |
| Stellar        | `stellar`   | `smart` | C... (Soroban contract) |
| Ethereum / EVM | `evm`       | `smart` | 0x...                   |
| Solana         | `solana`    | `smart` | Base58                  |

The API surface is identical across chains:

```
POST   /wallets                        Create wallet (specify chainType + type in body)
GET    /wallets/{locator}              Retrieve wallet details
GET    /wallets/{locator}/balances     Query token balances
POST   /wallets/{locator}/transfers   Transfer tokens
```

A single Crossmint API key can manage wallets across all supported chains. The
same user locator (e.g., `email:user@example.com`) can have wallets on multiple
chains simultaneously.

## Expanding to EVM Chains

### What changes

1. **Wallet creation**: Change `chainType` from `"stellar"` to `"evm"`
2. **On-ramp destination**: Instead of relaying USDC from the Stellar bridge
   account to a C... address, the flow would deposit USDC into an EVM wallet
   address (0x...)
3. **Off-ramp source**: Withdraw USDC from the EVM wallet, bridge to Stellar
   USDC, then send to the MoneyGram anchor

### What stays the same

- The MoneyGram interaction still happens on Stellar via SEP-10/SEP-24
- The bridge account still handles the anchor protocol
- Crossmint API calls for wallet management use the same endpoints

### EVM flow (deposit)

```
User deposits cash at MoneyGram
  -> MoneyGram sends USDC to bridge G... account (Stellar)
  -> CLI detects deposit completion
  -> CLI bridges Stellar USDC to EVM USDC (via Circle CCTP or a DEX bridge)
  -> USDC arrives in Crossmint EVM smart wallet (0x...)
```

### EVM flow (withdrawal)

```
User requests withdrawal
  -> CLI bridges EVM USDC to Stellar USDC
  -> Stellar USDC lands in bridge G... account
  -> CLI sends USDC to MoneyGram anchor via SEP-24
  -> User picks up cash at MoneyGram
```

### Bridge mechanism

Moving USDC between Stellar and EVM requires a cross-chain bridge. Options
include:

- **[Circle CCTP](https://www.circle.com/en/cross-chain-transfer-protocol)
  (Cross-Chain Transfer Protocol)**: Native USDC bridge operated by Circle.
  Supports Ethereum, Avalanche, Arbitrum, and other EVM chains. Does not
  currently support Stellar directly, so an intermediate chain hop may be
  needed.
- **Stellar/Soroban DEX bridges**: As the Soroban ecosystem matures, bridge
  protocols may support direct Stellar-to-EVM transfers.
- **Centralized exchange relay**: Deposit Stellar USDC to an exchange, withdraw
  as EVM USDC. Simple but introduces counterparty risk and KYC requirements.

## Expanding to Solana

### What changes

1. **Wallet creation**: Change `chainType` from `"stellar"` to `"solana"`
2. **USDC variant**: Solana uses SPL USDC (native to Solana), not Stellar
   classic USDC
3. **Cross-chain bridge**: Need a Stellar-to-Solana USDC bridge

### What stays the same

- MoneyGram interaction still happens entirely on Stellar
- Bridge account and SEP-10/SEP-24 flow are unchanged
- Crossmint wallet API calls are identical (different wallet type)

### Solana flow (deposit)

```
User deposits cash at MoneyGram
  -> MoneyGram sends USDC to bridge G... account (Stellar)
  -> CLI detects deposit completion
  -> CLI bridges Stellar USDC to Solana USDC (via Wormhole or Allbridge)
  -> USDC arrives in Crossmint Solana smart wallet
```

### Bridge mechanism

- **Wormhole**: Supports Stellar-to-Solana token transfers. The Wormhole portal
  can wrap Stellar USDC as a Wormhole-wrapped token on Solana.
- **Allbridge**: Another cross-chain bridge that supports both Stellar and
  Solana.
- **Circle CCTP**: Supports Solana natively. If Stellar support is added, this
  becomes the preferred path for native USDC transfers.

## Architecture for Multi-Chain

A generalized architecture would look like:

```
Stellar Layer (anchor protocol)
================================
Bridge Account (G...)
  |-- SEP-10 auth
  |-- SEP-24 deposit/withdraw
  |-- USDC receive/send
        |
        v
Cross-Chain Bridge
  |-- Circle CCTP
  |-- Wormhole
  |-- Allbridge
        |
        v
Target Chain Layer
================================
Crossmint Smart Wallet
  |-- EVM (0x...)
  |-- Solana (Base58)
  |-- Stellar (C...)
```

### Implementation approach

1. **Abstract the wallet layer**: The `crossmint.ts` module already uses a
   generic API. Add a `chain` parameter to wallet creation and let Crossmint
   handle the rest.

2. **Add a bridge module**: Create `src/bridge.ts` that handles cross-chain USDC
   transfers. This module would:
   - Accept source chain, destination chain, amount, and addresses
   - Select the appropriate bridge protocol
   - Execute the transfer and wait for confirmation

3. **Extend the CLI**: Add a `--chain` flag to deposit/withdraw commands:
   ```bash
   deno task cli deposit --amount 100 --chain evm
   deno task cli deposit --amount 100 --chain solana
   deno task cli deposit --amount 100 --chain stellar  # default, no bridge needed
   ```

## Future: Eliminating the Bridge Account

The bridge account exists because Crossmint cannot currently sign arbitrary
Stellar XDR. When Crossmint adds this capability, the architecture simplifies
significantly:

1. **Crossmint signs
   [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
   challenges directly** using the admin signer's Ed25519 key
2. **MoneyGram sends USDC to the smart wallet** (requires MoneyGram to support
   C... addresses or
   [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md))
3. **No bridge account needed** for Stellar-native flows

For cross-chain flows, the bridge account may still be useful as an intermediate
staging area, even after Crossmint adds arbitrary signing. The bridge provides a
clean separation between the anchor protocol (Stellar-specific) and the
destination chain.

### Timeline dependencies

| Capability                                                                                                | Status                    | Impact                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| Crossmint arbitrary XDR signing for Stellar                                                               | Not available             | Blocks bridge elimination ([docs](https://docs.crossmint.com/api-reference/wallets/create-wallet)) |
| MoneyGram [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md) support | SEP-45 is draft           | Blocks direct C... address deposits                                                                |
| [Circle CCTP](https://www.circle.com/en/cross-chain-transfer-protocol) Stellar support                    | Not available             | Would simplify cross-chain USDC transfers                                                          |
| Crossmint cross-chain transfer API                                                                        | Available for some chains | Could abstract bridge complexity                                                                   |

## Summary

The bridge account pattern is inherently composable with multi-chain expansion
because:

1. The MoneyGram anchor interaction is isolated in the Stellar layer
2. Crossmint's wallet API is chain-agnostic by design
3. The only new component needed per chain is a cross-chain bridge module
4. Wallet creation, balance queries, and transfers use the same Crossmint API
   regardless of chain
