import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
