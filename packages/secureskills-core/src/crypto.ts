import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { createCipheriv, createDecipheriv } from "node:crypto";

import type { BundleManifest, WrappedKeyMetadata } from "./types.ts";
import { stableStringify } from "./json.ts";

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const AES_256_KEY_BYTES = 32;

export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

export function generateMasterKey(): Buffer {
  return randomBytes(AES_256_KEY_BYTES);
}

export function manifestSignaturePayload(manifest: BundleManifest): Buffer {
  return Buffer.from(stableStringify(manifest), "utf8");
}

export function manifestSha256(manifest: BundleManifest): string {
  return createHash("sha256").update(manifestSignaturePayload(manifest)).digest("hex");
}

export function signManifest(manifest: BundleManifest, privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, manifestSignaturePayload(manifest), privateKey);
  return signature.toString("base64");
}

export function verifyManifestSignature(
  manifest: BundleManifest,
  signatureBase64: string,
  publicKeyPem: string,
): boolean {
  const publicKey = createPublicKey(publicKeyPem);
  return verify(null, manifestSignaturePayload(manifest), publicKey, Buffer.from(signatureBase64, "base64"));
}

export function encryptBytes(plaintext: Buffer, key: Buffer, aad: string): Buffer {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

export function decryptBytes(payload: Buffer, key: Buffer, aad: string): Buffer {
  if (payload.length < GCM_NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error("Encrypted payload is truncated");
  }

  const nonce = payload.subarray(0, GCM_NONCE_BYTES);
  const tag = payload.subarray(payload.length - GCM_TAG_BYTES);
  const ciphertext = payload.subarray(GCM_NONCE_BYTES, payload.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function wrapContentKey(contentKey: Buffer, masterKey: Buffer): WrappedKeyMetadata {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  cipher.setAAD(Buffer.from("secureskills:bundle-key", "utf8"));
  const wrappedKey = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    wrappedKey: wrappedKey.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function unwrapContentKey(metadata: WrappedKeyMetadata, masterKey: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(metadata.nonce, "base64"));
  decipher.setAAD(Buffer.from("secureskills:bundle-key", "utf8"));
  decipher.setAuthTag(Buffer.from(metadata.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(metadata.wrappedKey, "base64")),
    decipher.final(),
  ]);
}
