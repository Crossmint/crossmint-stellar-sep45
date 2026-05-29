# Stellar TOML host

A minimal, Vercel-deployable host for a `stellar.toml`
([SEP-1](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)).
It serves `/.well-known/stellar.toml` built entirely from environment variables.

## Why you need this

Some anchors (e.g. MoneyGram) require **`client_domain` attribution**: the
anchor must cryptographically verify which wallet provider is behind a SEP-10 /
SEP-45 session, separately from the end user's account. To do that it fetches
_your_ `stellar.toml`, reads the `SIGNING_KEY`, and includes a challenge entry
that must be signed by that key. Your backend holds the matching secret.

So this host's only job is to publish your `SIGNING_KEY` at a domain you
control.

## Generate a signing key

Any Stellar Ed25519 keypair works. From the repo root:

```bash
deno task generate-keys --seed "my-client-domain-signer"
```

Put the **public** key (`G...`) in `TOML_SIGNING_KEY`; keep the secret in your
signing backend.

## Deploy to Vercel

1. New Vercel project with **Root Directory** set to `toml-server/`.
2. Add environment variables (see [.env.example](.env.example)):
   - `TOML_SIGNING_KEY` (required)
   - `TOML_NETWORK_PASSPHRASE`, `TOML_ACCOUNTS`, `TOML_ORG_NAME` (optional)
3. Deploy. Your file is then served at:

   ```
   https://<your-domain>/.well-known/stellar.toml
   ```

## Verify

```bash
curl https://<your-domain>/.well-known/stellar.toml
```

Then pass `<your-domain>` as `client_domain` on the SEP-45 challenge request.
