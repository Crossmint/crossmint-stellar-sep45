/**
 * Diagnostic: fetch a SEP-45 challenge from an anchor and decode the
 * authorization entries so two anchors can be compared structurally.
 *
 * Usage: deno run --allow-net scripts/decode-challenge.ts <domain> <account>
 */

import { scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
import jsXdrLib from "@stellar/js-xdr";
import { Buffer } from "node:buffer";

const { XdrReader } = jsXdrLib;

const domain = Deno.args[0];
const account = Deno.args[1];

const jsonReplacer = (_k: string, v: unknown): unknown => {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) {
    return `<bytes:${Buffer.from(v).toString("base64")}>`;
  }
  return v;
};

const scAddrToStr = (a: xdr.ScAddress): string => {
  switch (a.switch().name) {
    case "scAddressTypeContract":
      return StrKey.encodeContract(a.contractId());
    case "scAddressTypeAccount":
      return StrKey.encodeEd25519PublicKey(a.accountId().ed25519());
    default:
      return a.switch().name;
  }
};

const tomlText =
  await (await fetch(`https://${domain}/.well-known/stellar.toml`))
    .text();
const endpoint =
  tomlText.match(/^WEB_AUTH_FOR_CONTRACTS_ENDPOINT\s*=\s*"([^"]*)"/m)?.[1] ??
    "";
const url = `${endpoint}?account=${account}&home_domain=${domain}`;
console.log("Challenge URL:", url);

const res = await fetch(url);
const json = await res.json() as {
  authorizationEntries: string;
  networkPassphrase: string;
};
console.log("networkPassphrase:", json.networkPassphrase);

const buf = Buffer.from(json.authorizationEntries, "base64");
const reader = new XdrReader(buf);
const count = reader.readUInt32BE();
console.log("entry count:", count);

for (let i = 0; i < count; i++) {
  const e = xdr.SorobanAuthorizationEntry.read(reader);
  const creds = e.credentials();
  console.log(`\n=== Entry ${i} ===`);
  console.log("credentials:", creds.switch().name);
  if (creds.switch().name === "sorobanCredentialsAddress") {
    const ac = creds.address();
    console.log("  address:", scAddrToStr(ac.address()));
    console.log("  nonce:", ac.nonce().toString());
    console.log("  sigExpirationLedger:", ac.signatureExpirationLedger());
    const sig = ac.signature();
    console.log("  signature switch:", sig.switch().name);
    try {
      console.log(
        "  signature native:",
        JSON.stringify(scValToNative(sig), jsonReplacer),
      );
    } catch (err) {
      console.log("  signature native: <decode error>", String(err));
    }
  }
  const root = e.rootInvocation();
  const fn = root.function();
  console.log("rootInvocation.function:", fn.switch().name);
  if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
    const cf = fn.contractFn();
    console.log("  contract:", scAddrToStr(cf.contractAddress()));
    console.log("  functionName:", cf.functionName().toString());
    cf.args().forEach((arg, j) => {
      try {
        console.log(
          `  arg[${j}]:`,
          JSON.stringify(scValToNative(arg), jsonReplacer),
        );
      } catch (err) {
        console.log(`  arg[${j}]: <decode error>`, String(err));
      }
    });
  }
  console.log("  subInvocations:", root.subInvocations().length);
}
