#!/usr/bin/env node
// Co-signs and submits a multi-party Soroban transaction (e.g. attest_with_risc0,
// which requires both `wallet.require_auth()` and `data.attestor.require_auth()`).
//
// This exists because the Stellar CLI's `tx sign` only appends the classic
// transaction-envelope signature (the source account's), not a second party's
// Soroban authorization-entry signature. A real attestor service needs exactly
// this capability — it co-signs a wallet-initiated attestation — so this is
// meant to be reusable, not a one-off script.
//
// Usage: node scripts/cosign-attest.mjs <unsigned_tx_xdr_file> <source_alias> <cosigner_alias>
// `source_alias` pays the fee and signs the outer envelope; both aliases must
// resolve via `stellar keys secret <alias>` (read into memory only, never printed).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  Keypair,
  TransactionBuilder,
  Networks,
  rpc,
  xdr,
  authorizeEntry,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

function secretFor(alias) {
  return execFileSync("stellar", ["keys", "secret", alias], {
    encoding: "utf8",
  }).trim();
}

async function main() {
  const [xdrPath, sourceAlias, cosignerAlias] = process.argv.slice(2);
  if (!xdrPath || !sourceAlias || !cosignerAlias) {
    console.error(
      "usage: cosign-attest.mjs <unsigned_tx_xdr_file> <source_alias> <cosigner_alias>",
    );
    process.exit(1);
  }

  const sourceKp = Keypair.fromSecret(secretFor(sourceAlias));
  const cosignerKp = Keypair.fromSecret(secretFor(cosignerAlias));
  const server = new rpc.Server(RPC_URL);

  const unsignedXdr = readFileSync(xdrPath, "utf8").trim();
  const envelope = xdr.TransactionEnvelope.fromXDR(unsignedXdr, "base64");
  const invokeOp = envelope
    .v1()
    .tx()
    .operations()[0]
    .body()
    .invokeHostFunctionOp();

  const latestLedger = await server.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + 100;

  // The CLI's --build-only tx carries no auth entries; a recording-mode
  // simulation discovers which require_auth() calls the invocation makes and
  // returns the unsigned entries to satisfy them.
  const recordingTx = TransactionBuilder.fromXDR(
    envelope.toXDR("base64"),
    NETWORK_PASSPHRASE,
  );
  const recordingSim = await server.simulateTransaction(recordingTx);
  if (rpc.Api.isSimulationError(recordingSim)) {
    throw new Error(`recording simulation failed: ${recordingSim.error}`);
  }
  const discovered = recordingSim.result?.auth ?? [];
  console.error(`recording sim discovered ${discovered.length} auth entr(y/ies)`);

  // Sign each address-credentialed entry with whichever party it names.
  const signedEntries = [];
  for (const entry of discovered) {
    const credType = entry.credentials().switch().name;
    if (credType !== "sorobanCredentialsAddress") {
      console.error(`  ${credType}: covered by the envelope signature`);
      signedEntries.push(entry);
      continue;
    }
    const scAddr = entry.credentials().address().address();
    const entryAccountHex = scAddr.accountId().ed25519().toString("hex");
    const signer =
      entryAccountHex === cosignerKp.rawPublicKey().toString("hex")
        ? cosignerKp
        : sourceKp;
    console.error(
      `  address entry for ${entryAccountHex.slice(0, 16)}… signed by ${signer.publicKey()} (validUntil ${validUntilLedgerSeq})`,
    );
    signedEntries.push(
      await authorizeEntry(
        entry,
        signer,
        validUntilLedgerSeq,
        NETWORK_PASSPHRASE,
      ),
    );
  }
  invokeOp.auth(signedEntries);

  // The CLI's --build-only tx has no timebounds; the SDK's builder requires them.
  envelope.v1().tx().cond(
    xdr.Preconditions.precondTime(
      new xdr.TimeBounds({
        minTime: xdr.TimePoint.fromString("0"),
        maxTime: xdr.TimePoint.fromString(
          String(Math.floor(Date.now() / 1000) + 300),
        ),
      }),
    ),
  );

  // Re-simulate with the signed auth in place so footprint/resource fee cover
  // the now-authorized invocation, then assemble (assembleTransaction keeps
  // existing auth — it only injects simulation auth when the op has none).
  const tx = TransactionBuilder.fromXDR(
    envelope.toXDR("base64"),
    NETWORK_PASSPHRASE,
  );
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${sim.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(sourceKp);

  const sendResult = await server.sendTransaction(prepared);
  console.log("submitted:", sendResult.hash, sendResult.status);
  if (sendResult.status === "ERROR") {
    console.error(JSON.stringify(sendResult.errorResult, null, 2));
    process.exit(1);
  }

  let got = await server.getTransaction(sendResult.hash);
  while (got.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    got = await server.getTransaction(sendResult.hash);
  }
  console.log("final status:", got.status);
  if (got.status !== "SUCCESS") {
    console.error(JSON.stringify(got, null, 2));
    process.exit(1);
  }
  console.log(`https://stellar.expert/explorer/testnet/tx/${sendResult.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
