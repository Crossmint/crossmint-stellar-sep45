# SEP-45 Postman Testing Flow

Step-by-step Postman flow for testing SEP-45 auth-entry signatures with
external-wallet (non-custodial) signers.

All endpoints use the v2025 API prefix: `/api/2025-06-09/`

---

## Important: Entry Format

The SEP-45 challenge returns `authorizationEntries` as an XDR-encoded **array**
(4-byte count prefix + N entries). The Crossmint signatures API expects a
**single** `SorobanAuthorizationEntry` as base64 XDR. You must decode the array
and extract the unsigned entry before sending it.

---

## Step 1: Create Wallet

```
POST {BASE_URL}/wallets
x-api-key: {API_KEY}
Content-Type: application/json

{
  "chainType": "stellar",
  "type": "smart",
  "config": {
    "adminSigner": { "type": "external-wallet", "address": "G...yourPublicKey" }
  }
}
```

Response (201):

```json
{
  "address": "C...contractAddress",
  "config": {
    "adminSigner": {
      "type": "external-wallet",
      "address": "G...yourPublicKey",
      "locator": "external-wallet:G...yourPublicKey"
    }
  }
}
```

## Step 2: Get SEP-45 Challenge

### 2a. Discover the auth endpoint

```
GET https://testanchor.stellar.org/.well-known/stellar.toml
```

Extract `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` from the TOML response.

For testanchor:
`WEB_AUTH_FOR_CONTRACTS_ENDPOINT = "https://testanchor.stellar.org/sep45/auth"`

### 2b. Request a challenge

```
GET https://testanchor.stellar.org/sep45/auth?account={{walletAddress}}&home_domain=testanchor.stellar.org
```

Response:

```json
{
  "authorizationEntries": "<base64 XDR array of SorobanAuthorizationEntry>",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

### 2c. Extract the unsigned entry (Postman post-response script)

```js
const StellarSdk = pm.require("npm:stellar-sdk");
const jsXdr = pm.require("npm:@stellar/js-xdr");
const { xdr } = StellarSdk;
const { XdrReader } = jsXdr;

const json = pm.response.json();
const raw = Buffer.from(json.authorizationEntries, "base64");
const reader = new XdrReader(raw);
const count = reader.readUInt32BE();

const entries = [];
for (let i = 0; i < count; i++) {
  entries.push(xdr.SorobanAuthorizationEntry.read(reader));
}

// Find the unsigned entry (sorobanCredentialsAddress with scvVoid signature)
entries.forEach((entry, i) => {
  const creds = entry.credentials();
  if (creds.switch().name !== "sorobanCredentialsAddress") return;
  const sig = creds.address().signature();
  const isUnsigned = sig.switch().name === "scvVoid" ||
    (sig.switch().name === "scvMap" &&
      (!sig.value() || sig.value().length === 0));
  if (isUnsigned) {
    pm.collectionVariables.set(
      "unsignedEntry",
      entry.toXDR().toString("base64"),
    );
    console.log("Saved unsigned entry " + i + " to {{unsignedEntry}}");
  }
});
```

## Step 3: Create Signature Request

```
POST {BASE_URL}/wallets/{{walletAddress}}/signatures
x-api-key: {API_KEY}
Content-Type: application/json

{
  "type": "auth-entry",
  "params": {
    "entry": "{{unsignedEntry}}"
  }
}
```

Response (201):

```json
{
  "id": "sig-uuid",
  "status": "awaiting-approval",
  "approvals": {
    "pending": [
      {
        "signer": { "locator": "external-wallet:G..." },
        "message": "<base64 preimage hash>"
      }
    ]
  }
}
```

## Step 4: Sign and Submit Approval

Sign the `message` (preimage hash) locally with your Ed25519 keypair:

```js
// Decode the base64 message (32-byte preimage hash)
const messageBytes = Buffer.from(pendingApproval.message, "base64");

// Ed25519-sign with the keypair's secret key
const signatureBytes = keypair.sign(messageBytes);

// Base64-encode the 64-byte signature
const signatureBase64 = Buffer.from(signatureBytes).toString("base64");
```

Submit the approval:

```
POST {BASE_URL}/wallets/{{walletAddress}}/signatures/{{signatureId}}/approvals
x-api-key: {API_KEY}
Content-Type: application/json

{
  "approvals": [
    {
      "signer": "external-wallet:G...",
      "signature": "<base64 Ed25519 signature>"
    }
  ]
}
```

## Step 5: Poll for Completion

```
GET {BASE_URL}/wallets/{{walletAddress}}/signatures/{{signatureId}}
x-api-key: {API_KEY}
```

Poll every ~2s until `status: "success"`:

```json
{
  "id": "sig-uuid",
  "status": "success",
  "outputSignature": "<base64 XDR of signed SorobanAuthorizationEntry>"
}
```

## Step 6: Submit to Anchor

Re-encode the signed entries array (with the `outputSignature` replacing the
unsigned entry) and POST to the anchor:

```
POST https://testanchor.stellar.org/sep45/auth
Content-Type: application/x-www-form-urlencoded

authorization_entries=<URL-encoded base64 XDR of signed entries array>
```

Response:

```json
{
  "token": "eyJ..."
}
```

---

## Notes

- **Counterfactual deployment**: The first signature request on a new wallet
  triggers on-chain deployment. This adds latency.
- **Server-side resolution**: The server automatically resolves
  `validUntilLedgerSeq` and `networkPassphrase`
- **Entry format**: `params.entry` expects a **single**
  `SorobanAuthorizationEntry` as base64 XDR, not the array from the challenge
- **home_domain required**: The SEP-45 challenge endpoint requires the
  `home_domain` query parameter

## Environment Variables

| Variable   | Example                                                  |
| ---------- | -------------------------------------------------------- |
| `BASE_URL` | `https://staging.crossmint.com/api/2025-06-09`           |
| `API_KEY`  | Your Crossmint server API key                            |
