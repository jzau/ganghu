import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

export function createSecretToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(value: string) {
  return createHash("sha256").update(`${env.SESSION_SECRET}:${value}`).digest("hex");
}

export function verifyPlainText(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function credentialKey() {
  return createHash("sha256").update(env.TOKING_CREDENTIAL_SECRET).digest();
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptCredential(value: string) {
  const [ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (!ivValue || !tagValue || !ciphertextValue || extra) throw new Error("Invalid encrypted credential");
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
