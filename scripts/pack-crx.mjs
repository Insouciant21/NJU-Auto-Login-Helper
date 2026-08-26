// pack-crx.mjs — Create a CRX3 file from a ZIP + PEM key
//
// Usage: node scripts/pack-crx.mjs <extension.zip> <key.pem> <output.crx>
//
// CRX3 format (little-endian):
//   4 bytes  magic "Cr24"
//   4 bytes  version (uint32 LE) = 3
//   4 bytes  header length (uint32 LE)
//   N bytes  protobuf CrxFileHeader
//   ...      ZIP of extension files

import { readFileSync, writeFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, sign, constants } from "node:crypto";

// ── CLI args ─────────────────────────────────────────────────────────
const [,, zipPath, keyPath, outPath] = process.argv;
if (!zipPath || !keyPath || !outPath) {
  console.error("Usage: node scripts/pack-crx.mjs <ext.zip> <key.pem> <output.crx>");
  process.exit(1);
}

// ── Load key ─────────────────────────────────────────────────────────
const pem = readFileSync(keyPath, "utf-8");
const privateKey = createPrivateKey({ key: pem, format: "pem" });
const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });

// ── Read the ZIP ─────────────────────────────────────────────────────
const zipData = readFileSync(zipPath);

// ── Build and sign SignedData ────────────────────────────────────────
// CRX3 identifies a developer-key package with the first 16 bytes of the
// SHA-256 hash of its DER-encoded public key.
const crxId = createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
const signedHeaderData = pbBytes(1, crxId);
const signedHeaderSize = Buffer.alloc(4);
signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);

// Chromium verifies the context, signed-header size, signed header, and the
// complete ZIP archive as one RSA-SHA256 payload.
const signedBytes = Buffer.concat([
  Buffer.from("CRX3 SignedData\0", "utf-8"),
  signedHeaderSize,
  signedHeaderData,
  zipData,
]);
const signatureBytes = sign("RSA-SHA256", signedBytes, {
  key: privateKey,
  padding: constants.RSA_PKCS1_PADDING,
});

// ── Build CrxFileHeader protobuf ─────────────────────────────────────
//   repeated AsymmetricKeyProof sha256_with_rsa = 2;
//     bytes public_key  = 1;
//     bytes signature   = 2;
//   bytes signed_header_data = 10000;
const keyProof = Buffer.concat([
  pbBytes(1, publicKeyDer),
  pbBytes(2, signatureBytes),
]);
const crxHeader = Buffer.concat([
  pbBytes(2, keyProof),          // sha256_with_rsa
  pbBytes(10000, signedHeaderData), // signed_header_data
]);

// ── Write CRX3 file ──────────────────────────────────────────────────
const magic = Buffer.from("Cr24", "ascii");
const ver = Buffer.alloc(4);  ver.writeUInt32LE(3, 0);
const hdrLen = Buffer.alloc(4); hdrLen.writeUInt32LE(crxHeader.length, 0);

const crx = Buffer.concat([magic, ver, hdrLen, crxHeader, zipData]);
writeFileSync(outPath, crx);
console.log("CRX written: %s (%s KB)", outPath, (crx.length / 1024).toFixed(1));

// ── Protobuf helper ──────────────────────────────────────────────────
// Encode a length-delimited bytes field: tag | len | payload
function pbBytes(fieldNum, data) {
  const tag = varint((fieldNum << 3) | 2);     // wire type 2
  const len = varint(data.length);
  return Buffer.concat([tag, len, data]);
}

// Encode a uint32 as a protobuf varint
function varint(n) {
  const buf = [];
  while (n > 0x7f) { buf.push(0x80 | (n & 0x7f)); n >>>= 7; }
  buf.push(n);
  return Buffer.from(buf);
}
